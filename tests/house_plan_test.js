// run: node tests/house_plan_test.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sdk = path.resolve(__dirname, '..')
const warnings = []
const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}, warn(...args) { warnings.push(args) }},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
let files = ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js',
	'house_plan.js']
for (let name of files) {
	// env SDK=dir loads dir/www/roof_skeleton.js instead (a changed copy).
	let file = path.join(name == 'roof_skeleton.js' && process.env.SDK || sdk,
		'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

// the thicknesses that the expected numbers below assume. The tests pin
// them: house_plan's defaults can change without breaking them.
const thicknesses = {
	int_wall_thickness: 80,
	ext_wall_thickness: 180,
	slab_thickness: 200,
	roof_thickness: 200,
}

// everything is in mm.
function house(t) {
	return ctx.house_plan({version: 1, ...thicknesses, ...t})
}

function floor(lines) {
	return house({floors: [{lines}]}).floors[0]
}

let n_checks = 0
function check(name, f) {
	try {
		f()
		n_checks++
	} catch (e) {
		console.error(name)
		throw e
	}
}

// resize snapping and limits -----------------------------------------------

check('a wall endpoint snaps to the wall\'s other end: the wall goes away',
	() => {
	let f = floor([
		[null, [0, 0], [3000, 0]],
		[null, [1000, 1000], [1000, 3000]],
	])
	let p = f.ps.find(p => p[0] == 1000 && p[1] == 3000)
	let r = f.start_resize_seg(p, 1000, 3000, 0, -1000, 0, -1)
	r.resize(0, -1900, 300)
	assert.equal(p[1], 1000)
	assert.equal(r.snap_a, 1000)
	r.stop()
	assert.equal(f.segs.length, 1)
	assert(!f.ps.find(p => p[0] == 1000))
	r = f.start_resize_seg(null, 5000, 5000, 0, 1000, 0, 1)
	r.resize(0, 1000, 300)
	r.resize(0, 100, 300)
	assert.equal(r.seg.m1, r.seg.m2)
	assert.equal(r.snap_a, 5000)
	r.stop()
	assert.equal(f.segs.length, 1)
})

// outlines after moving an exterior wall ------------------------------------

check('exterior wall outlines after moving a wall', () => {
	let y = 0
	let dy = 1000
	let f = house(ctx.house_test_plans.simple).floors[0]
	let s = f.segs.find(s => !s.is_v && s.axis == y && s.m1 == 2000)
	let r = f.start_move_seg(s)
	r.move(0, dy)
	r.stop()
	let connector = f.segs.find(s => s.is_v && s.axis == 2000
		&& s.m1 == Math.min(y, y+dy) && s.m2 == Math.max(y, y+dy))
	assert(connector)
	let r1 = f.start_move_seg(connector)
	for (let dx of [0, 400]) {
		r1.move(dx, 0)
		for (let c of f.comps)
			for (let cy of c.cycles)
				for (let i = 0; i < cy.edges.length; i++) {
					let a = cy.edges[i]
					let b = cy.edges[(i+1) % cy.edges.length]
					assert(a[0] == b[0] || a[1] == b[1],
						'diagonal outline: ' + a + ' to ' + b)
				}
	}
	r1.stop()
})

// edit history -------------------------------------------------------------

function geometry(f) {
	return JSON.stringify({
		ps: Array.from(f.ps, p => [p[0], p[1], p.id]),
		segs: Array.from(f.segs, s => [s[0].id, s[1].id, s.id]),
	})
}

check('a whole drag is one undo step with stable IDs', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	let s = f.segs.find(s => s.is_v && s.axis == 2000)
	let r = f.start_move_seg(s)
	for (let dx of [300, 400, 500])
		r.move(dx, 0)
	r.stop()
	let after = geometry(f)
	assert.notEqual(after, before)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), null)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
	assert.equal(f.house.redo(), null)
	assert.equal(f.ps_ids.get('cl').id, 'cl')
})

check('deletion undo restores rooms and connections', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	f.delete_seg(f.segs.find(s => s.is_v && s.axis == 2000))
	let after = geometry(f)
	assert.equal(f.comps[0].cycles.length, 2)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(f.comps[0].cycles.length, 3)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('cancelled wall movement restores temporary topology', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	let s = f.segs.find(s => !s.is_v && s.axis == 0 && s.m1 == 2000)
	let r = f.start_move_seg(s)
	r.move(0, 1000)
	r.cancel()
	assert.equal(geometry(f), before)
	assert.equal(f.comps[0].ps.length, f.ps.length)
	assert.equal(f.comps[0].segs.length, f.segs.length)
	assert.equal(f.house.undo(), null)
})

check('new edits discard redo history', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let r = f.start_move_seg(f.segs[0])
	r.move(0, 500)
	r.stop()
	assert(f.house.undo())
	r = f.start_move_seg(f.segs[0])
	r.move(0, 800)
	r.stop()
	assert.equal(f.house.redo(), null)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
})

check('house snapshots round-trip every floor and roof', () => {
	let h = house(ctx.house_test_plans.gable1)
	let saved = JSON.stringify(h.save_state())
	let h1 = house(JSON.parse(saved))
	assert.equal(JSON.stringify(h1.save_state()), saved)
	let state = h.save_state()
	state.floors[0].points[0][0] += 1000
	state.floors[2].roof.edge_points[0].x += 1000
	assert.equal(JSON.stringify(h.save_state()), saved)
})

check('house undo follows edits across floors and discards redo', () => {
	let h = house(ctx.house_test_plans.gable1)
	let before = JSON.stringify(h.save_state())
	h.floors[0].delete_seg(h.floors[0].segs[0])
	let first = JSON.stringify(h.save_state())
	h.floors[1].delete_seg(h.floors[1].segs[0])
	let second = JSON.stringify(h.save_state())
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), first)
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), before)
	assert(h.redo())
	assert(h.redo())
	assert.equal(JSON.stringify(h.save_state()), second)
	assert(h.undo())
	h.floors[2].delete_seg(h.floors[2].segs[0])
	assert.equal(h.redo(), null)
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), first)
	assert(h.redo())
})

// walls --------------------------------------------------------------------

function rect_lines(x, y, w, h) {
	return ['draw', x, y, w, h, -w, -h]
}

// the saved state of a tag object: 'open_room' or 'terrace'.
function tag_state(type, x, y) {
	return {type: type, x: x, y: y, rot: 0}
}

// convert a face of make_faces() to a poly2 of 2D points with holes, ccw
// outline: wall polys in (m, z) with is_v, axis, normal; horizontal polys in
// plan (x, y) with z, normal.
function face_poly(face) {
	let [x0, y0, z0] = face.rings[0][0]
	let is_flat = true
	let is_x = true
	for (let [x, y, z] of face.rings[0]) {
		is_flat = is_flat && z == z0
		is_x = is_x && x == x0
	}
	let rings2 = []
	for (let ring of face.rings) {
		let ring2 = []
		for (let [x, y, z] of ring)
			ring2.push(is_flat ? [x, y] : is_x ? [y, z] : [x, z])
		rings2.push(ring2)
	}
	let area = 0
	let outline = rings2[0]
	for (let i = 0; i < outline.length; i++) {
		let [m1, z1] = outline[i]
		let [m2, z2] = outline[(i+1) % outline.length]
		area += m1 * z2 - m2 * z1
	}
	// faces are ccw seen from outside in (x, y, z): ccw in (x, y) facing up,
	// in (y, z) facing +x, in (x, z) facing -y.
	let is_ccw = area > 0
	let poly = ctx.Math3D.poly2()
	poly.holes = []
	for (let ring2 of rings2) {
		if (poly.length)
			poly.holes.push(poly.length)
		if (!is_ccw)
			ring2.reverse()
		for (let p of ring2)
			poly.push(p)
	}
	if (is_flat) {
		poly.z = z0
		poly.normal = is_ccw ? 1 : -1
	} else {
		poly.is_v = is_x
		poly.axis = is_x ? x0 : y0
		poly.normal = (is_ccw == is_x) ? 1 : -1
	}
	return poly
}

// polys of the whole house, or of floors 0..floor cut at floor.
// cut at floor, default: the top floor. without floor's roof.
function house_polys(h, floor) {
	let faces = h.make_faces(floor ?? h.floors[h.floors.length-1], true)
	let wall_polys = []
	let horizontal_polys = []
	for (let face of faces) {
		let poly = face_poly(face)
		if (poly.z != null)
			horizontal_polys.push(poly)
		else
			wall_polys.push(poly)
	}
	return [wall_polys, horizontal_polys]
}

function wall_polys_at(h, is_v, axis, normal, floor) {
	let polys = []
	let [wall_polys] = house_polys(h, floor)
	for (let poly of wall_polys)
		if (poly.is_v == is_v && poly.axis == axis && poly.normal == normal)
			polys.push(poly)
	return polys
}

// points of loop [i1, i2) of a poly, starting from the lowest one.
function loop_points(poly, i1, i2) {
	let ps = []
	for (let i = i1; i < i2; i++)
		ps.push([...poly[i]])
	let min_i = 0
	for (let i = 1; i < ps.length; i++) {
		let [m, z] = ps[i]
		let [min_m, min_z] = ps[min_i]
		if (z < min_z || z == min_z && m < min_m)
			min_i = i
	}
	return [...ps.slice(min_i), ...ps.slice(0, min_i)]
}

function outline_points(poly) {
	return loop_points(poly, 0, poly.point_count_without_holes())
}

// cut at the top floor: without the roof.
check('exterior skin merges across T-junctions and slabs', () => {
	let h = house(ctx.house_test_plans.simple)
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1, h.floors[0])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 2500], [-140, 2500]])
	assert.deepEqual([...poly.holes], [])
})

// gable1 cut at its top floor: without the roof.
check('exterior skins of stacked floors merge into one polygon', () => {
	let h = house(ctx.house_test_plans.gable1)
	let [poly, ...rest] = wall_polys_at(h, true, -140, -1, h.floors[2])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [4140, 0], [4140, 7500], [-140, 7500]])
})

check('the gable wall rises to the roof underside', () => {
	let h = house(ctx.house_test_plans.gable1)
	let faces = h.make_faces(h.floors[2], false)
	let walls = faces.filter(face => face.tag == 'walls')
	let roofs = faces.filter(face => face.tag == 'roof')
	assert(roofs.length > 0)
	let [poly, ...rest] = walls.map(face_poly).filter(poly =>
		poly.is_v && poly.axis == -140 && poly.normal == -1)
	assert.equal(rest.length, 0)
	// 45 deg, 200 thick: the underside is 200*sqrt(2) below the top, which
	// starts at 7500 on the outer skin and peaks at the ridge, y = 2000.
	let d = 200 * Math.SQRT2
	let ps = outline_points(poly)
	let ps1 = [[-140, 0], [4140, 0], [4140, 7500 - d], [2000, 9640 - d],
		[-140, 7500 - d]]
	assert.equal(ps.length, ps1.length)
	for (let i = 0; i < ps.length; i++)
		for (let k = 0; k < 2; k++)
			assert(Math.abs(ps[i][k] - ps1[i][k]) <= .02, JSON.stringify(ps))
})

check('a gap between two floors makes a hole', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(0, 0, 2000, 4000), rect_lines(4000, 0, 2000, 4000)],
			objects: [tag_state('terrace', 3000, 2000)]},
		{lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 7500], [-140, 7500]])
	assert.equal(poly.hole_count(), 1)
	assert.deepEqual(loop_points(poly, poly.hole_i1(0), poly.hole_i2(0)),
		[[2140, 3700], [2140, 5000], [3860, 5000], [3860, 3700]]) // half-wall

})

// open rooms ----------------------------------------------------------------

function open_room_count(floor) {
	return floor.open_rooms.size
}

function open_room_house(upper_tags, island_lines) {
	let lines = [rect_lines(0, 0, 6000, 4000)]
	if (island_lines)
		lines.push(island_lines)
	return house({floors: [
		{lines: lines},
		{lines: lines, objects: upper_tags},
	]})
}

function is_on_ground(h, type, x, y) {
	return h.ground_objects.some(object =>
		object.type == type && object.x == x && object.y == y)
}

check('an open room merges its skins with the room below', () => {
	let h = open_room_house([tag_state('open_room', 1000, 2000)])
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = wall_polys_at(h, true, 40, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[40, 200], [3960, 200], [3960, 5000], [40, 5000]])
})

check('an island in an open room keeps a slab piece under it', () => {
	let h = open_room_house([tag_state('open_room', 1000, 2000)],
		rect_lines(2000, 1000, 1000, 1000))
	let [poly, ...rest] = wall_polys_at(h, true, 1960, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[960, 200], [2040, 200], [2040, 5000], [960, 5000]])
})

// the object's plan box centre: the reference that a move displaces.
function box_centre(h, floor, object) {
	let [x1, y1, x2, y2] = h.get_object_box(floor, object, [0, 0, 0, 0])
	return [(x1 + x2) / 2, (y1 + y2) / 2]
}

check('moving an open-room tag from the ground into a room opens it', () => {
	let h = open_room_house([])
	let floor = h.floors[1]
	let tag = h.ground_objects.find(object => object.type == 'open_room')
	let edit_no = h.edit_no
	let [x0, y0] = box_centre(h, floor, tag)
	let mover = floor.start_move_object(tag)
	mover.move(1000 - x0, 2000 - y0, 0)
	assert.equal(open_room_count(floor), 1)
	assert.equal(floor.objects[0], tag)
	mover.stop()
	assert.equal(wall_polys_at(h, true, 40, 1).length, 1)
	assert.equal(h.edit_no, edit_no + 1)
	assert(h.undo())
	assert.equal(floor.objects.length, 0)
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 2)
	assert(h.redo())
	assert.equal(open_room_count(floor), 1)
})

// horizontal faces ----------------------------------------------------------

function horizontal_polys_at(h, z, normal, floor) {
	let polys = []
	let [, horizontal_polys] = house_polys(h, floor)
	for (let poly of horizontal_polys)
		if (poly.z == z && poly.normal == normal)
			polys.push(poly)
	return polys
}

check('one floor has slab bottom, floor and wall tops', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)]}]})
	assert.equal(house_polys(h)[1].length, 3)
	let outline = [[-140, -140], [6140, -140], [6140, 4140], [-140, 4140]]
	let room = [[40, 40], [5960, 40], [5960, 3960], [40, 3960]]
	for (let [z, normal, ps, hole_n] of [
		[   0, -1, outline, 0],
		[ 200,  1, room, 0],
		[2500,  1, outline, 1],
	]) {
		let [poly, ...rest] = horizontal_polys_at(h, z, normal)
		assert.equal(rest.length, 0)
		assert.deepEqual(outline_points(poly), ps)
		assert.equal(poly.hole_count(), hole_n)
	}
})

check('a wall under an open room gets a slab', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000), ['draw', 3000, 0, 0, 4000]]},
		{lines: [rect_lines(0, 0, 6000, 4000)],
			objects: [tag_state('open_room', 1000, 2000)]},
	]})
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 2700, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[2960, 40], [3040, 40], [3040, 3960], [2960, 3960]])
	assert.equal(horizontal_polys_at(h, 2500, 1).length, 0)
	assert.equal(horizontal_polys_at(h, 2500, -1).length, 0)
})

check('a smaller upper floor leaves a terrace and a ceiling', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(0, 0, 3000, 4000)],
			objects: [tag_state('terrace', 4500, 2000)]},
	]})
	// slab 1 top: the upper room floor and the terrace.
	let [terrace, room, ...rest] = horizontal_polys_at(h, 2700, 1)
		.sort((poly1, poly2) => poly2[0][0] - poly1[0][0])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(terrace),
		[[3140, 40], [5960, 40], [5960, 3960], [3140, 3960]]) // in half-walls
	assert.deepEqual(outline_points(room),
		[[40, 40], [2960, 40], [2960, 3960], [40, 3960]])
	// slab 1 bottom: the ground floor ceiling.
	let [ceiling, ...rest1] = horizontal_polys_at(h, 2500, -1)
	assert.equal(rest1.length, 0)
	assert.deepEqual(outline_points(ceiling),
		[[40, 40], [5960, 40], [5960, 3960], [40, 3960]])
})

// terrace tags ----------------------------------------------------------------

function terrace_house(upper_tags) {
	return house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(0, 0, 3000, 4000)], objects: upper_tags},
	]})
}

check('a terrace tag is on the floor above the area that it tags', () => {
	let h = terrace_house([
		tag_state('terrace', 4500, 2000), // over floor 0's roof: kept.
		tag_state('terrace', 1000, 2000), // inside floor 1: invalid, kept.
		tag_state('terrace', 8000, 2000), // outside the house: ground.
	])
	assert.equal(h.floors[1].objects.length, 2)
	assert.equal(h.floors[1].objects[0].x, 4500)
	assert.equal(h.floors[1].objects[1].x, 1000)
	assert(!is_on_ground(h, 'terrace', 1000, 2000))
	assert(is_on_ground(h, 'terrace', 8000, 2000))
	assert.equal(h.floors[0].make_areas()[0].kind, 'terrace')
})

// cutting the house at a floor ----------------------------------------------

function two_floor_house() {
	return house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
}

function check_wall_caps(h, z, floor) {
	let [poly, ...rest] = horizontal_polys_at(h, z, 1, floor)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, -140], [6140, -140], [6140, 4140], [-140, 4140]])
	assert.deepEqual([...poly.holes], [4])
	assert.deepEqual(loop_points(poly, 4, 8),
		[[40, 40], [40, 3960], [5960, 3960], [5960, 40]])
}

check('a cut floor has wall caps and no slab on top', () => {
	let h = two_floor_house()
	let floor = h.floors[0]
	check_wall_caps(h, 2500, floor)
	assert.equal(horizontal_polys_at(h, 2500, -1, floor).length, 0)
	assert.equal(horizontal_polys_at(h, 2700,  1, floor).length, 0)
	assert.equal(house_polys(h, floor)[1].length, 3)
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1, floor)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 2500], [-140, 2500]])
})

check('a cut keeps the floors below and their slabs', () => {
	let h = two_floor_house()
	let floor = h.floors[1]
	assert.equal(horizontal_polys_at(h, 2500, -1, floor).length, 1)
	assert.equal(horizontal_polys_at(h, 2700,  1, floor).length, 1)
	check_wall_caps(h, 5000, floor)
	assert.equal(horizontal_polys_at(h, 5200,  1, floor).length, 0)
	let [poly] = wall_polys_at(h, false, -140, -1, floor)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 5000], [-140, 5000]])
})

// adding and removing floors -----------------------------------------------

check('adding a floor copies the top floor and raises the walls', () => {
	let h = house(ctx.house_test_plans.simple)
	let edit_no = h.edit_no
	let floor = h.add_floor(h.floors[0])
	assert.equal(h.floors.length, 2)
	assert.equal(h.floors[1], floor)
	assert.equal(h.edit_no, edit_no + 1)
	assert.deepEqual(JSON.stringify(floor.save_state()),
		JSON.stringify(h.floors[0].save_state()))
	assert.equal(h.h, 5000)
	let [poly] = wall_polys_at(h, false, -140, -1)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 5000], [-140, 5000]])
})

check('adding and removing floors is undoable', () => {
	let h = house(ctx.house_test_plans.simple)
	let floor = h.add_floor(h.floors[0])
	floor.delete_seg(floor.segs[0])
	let state1 = JSON.stringify(floor.save_state())
	h.remove_floor(floor)
	assert(h.undo()) // remove
	assert.equal(h.floors[1], floor)
	assert.equal(h.h, 5000)
	assert(h.undo()) // the floor's edit
	assert.notEqual(JSON.stringify(floor.save_state()), state1)
	assert(h.undo()) // add
	assert.equal(h.floors.length, 1)
	assert.equal(h.h, 2500)
	assert.equal(h.undo(), null)
	assert(h.redo()) // add
	assert(h.redo()) // the floor's edit
	assert.equal(JSON.stringify(floor.save_state()), state1)
	assert(h.redo()) // remove
	assert.equal(h.floors.length, 1)
	assert.equal(h.redo(), null)
})

check('adding a floor in the middle inserts it above, undo and redo', () => {
	let h = house(ctx.house_test_plans.simple)
	let floor0 = h.floors[0]
	let top = h.add_floor(floor0)
	let middle = h.add_floor(floor0)
	assert.deepEqual(Array.from(h.floors, floor => floor.i), [0, 1, 2])
	assert.equal(h.floors[1], middle)
	assert.equal(h.floors[2], top)
	assert.equal(top.id, 'floor2')
	assert.equal(top.z, 5000)
	let entry = h.undo()
	assert.equal(entry.op, 'remove_floor')
	assert.equal(h.floors[1], top)
	assert.equal(top.i, 1)
	entry = h.redo()
	assert.equal(entry.op, 'add_floor')
	assert.equal(entry.floor, middle)
	assert.equal(h.floors[1], middle)
	assert.equal(top.i, 2)
	h.remove_floor(top)
	entry = h.undo()
	assert.equal(entry.op, 'add_floor')
	assert.equal(entry.floor, top)
	assert.equal(h.floors[2], top)
})

check('removing a middle floor places the floor above again; undo', () => {
	let h = stair_house()
	let state0 = JSON.stringify(h.save_state())
	let middle = h.add_floor(h.floors[0])
	let top = h.floors[2]
	let state1 = JSON.stringify(h.save_state())
	h.remove_floor(middle)
	assert.equal(h.floors[1], top)
	assert.equal(top.i, 1)
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert.equal(h.undo().floor, middle)
	assert.equal(h.floors[1], middle)
	assert.equal(top.i, 2)
	assert.equal(JSON.stringify(h.save_state()), state1)
	assert(top.objects.every(object => object.is_valid))
})

check('load_state with a bad state restores the house and adds no edit', () => {
	let h = house(ctx.house_test_plans.gable1)
	let before = JSON.stringify(h.save_state())
	let floors = h.floors
	let edit_no = h.edit_no
	assert.throws(() => h.load_state({floors: [null]}))
	assert.equal(JSON.stringify(h.save_state()), before)
	assert.equal(h.floors, floors)
	assert.equal(h.edit_no, edit_no)
	assert.equal(h.undo(), null)
})

// roofs --------------------------------------------------------------------

function roof_z_range(faces) {
	let z1 = 1/0
	let z2 = -1/0
	for (let face of faces)
		for (let ring of face.rings)
			for (let [x, y, z] of ring) {
				z1 = Math.min(z1, z)
				z2 = Math.max(z2, z)
			}
	return [z1, z2]
}

check('gable roof on the top floor: two faces over the overhang', () => {
	let h = house(ctx.house_test_plans.gable1)
	let f = h.floors[2]
	let faces = f.make_roof_faces(f.make_areas())
	assert.equal(faces.length, 2)
	// outer skin: x -140..6140, y -140..4140, 45 deg: the ridge is half the
	// width above the wall top; the eaves are 220 lower (eave_h) and 220 out;
	// the gables are 600 out (overhang).
	let wall_z = f.z + f.h
	assert.deepEqual(roof_z_range(faces), [wall_z - 220, wall_z + 2140])
	let x1 = 1/0, y1 = 1/0, x2 = -1/0, y2 = -1/0
	for (let face of faces)
		for (let [x, y] of face.rings[0]) {
			x1 = Math.min(x1, x); y1 = Math.min(y1, y)
			x2 = Math.max(x2, x); y2 = Math.max(y2, y)
		}
	assert.deepEqual([x1, y1, x2, y2], [-740, -360, 6740, 4360])
})

function faces_bbox(faces) {
	let x1 = 1/0, y1 = 1/0, x2 = -1/0, y2 = -1/0
	for (let face of faces)
		for (let [x, y] of face.rings[0]) {
			x1 = Math.min(x1, x); y1 = Math.min(y1, y)
			x2 = Math.max(x2, x); y2 = Math.max(y2, y)
		}
	return [x1, y1, x2, y2]
}

// up faces of make_faces() at height z.
function up_faces_at(faces, z) {
	return faces.filter(face => face.rings[0].every(p => p[2] == z)
		&& face_poly(face).normal == 1)
}

// the default roof: the eave height is 220 mm under the wall top, about a
// 600 mm overhang at 20 deg.
let roof60_eave_h = -220
function roof60() {
	return {pitch: 20, overhang: 600, eave_h: roof60_eave_h, edge_points: []}
}

// the overhang of the sloped sides of roof60().
let roof60_d = -roof60_eave_h / Math.tan(20 * Math.PI / 180)
// roof points are on the prism_union grid.
let grid = x => Math.round(x * ctx.prism_union.grid_scale)
	/ ctx.prism_union.grid_scale
// the roof60() eave lines: west and north, east of 6000 and of 3000, south.
let eave_w = grid(-140 - roof60_d)
let eave_e6 = grid(6140 + roof60_d)
let eave_e3 = grid(3140 + roof60_d)
let eave_s = grid(4140 + roof60_d)

// floor 0: x 0..6000; floor 1: x 0..3000 on top of it.
function lean_to_house(upper_tags) {
	return house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)], roof: roof60()},
		{lines: [rect_lines(0, 0, 3000, 4000)], objects: upper_tags,
			roof: roof60()},
	]})
}

check('a lower floor sticking out: a roof against the upper wall', () => {
	let h = lean_to_house()
	let [f0, f1] = h.floors
	let areas = f0.make_areas()
	assert.equal(areas.length, 1)
	assert.equal(areas[0].kind, 'roof')
	let faces = f0.make_roof_faces(areas)
	// eaves north, east and south follow the rounded eave height; the upper
	// floor's outer skin, x = 3140, stays: no face rises from it.
	assert.equal(faces.length, 3)
	assert.deepEqual(faces_bbox(faces), [3140, eave_w, eave_e6, eave_s])
	let wall_z = f0.z + f0.h
	let [z1, z2] = roof_z_range(faces)
	assert(Math.abs(z1 - (wall_z + roof60_eave_h)) < 1e-8)
	assert_near(z2, wall_z + roof60_eave_h
		+ (2000 - eave_w) * Math.tan(20 * Math.PI / 180))
	// slab 1 leaves out the roof: its top shows in the upper room only.
	let all_faces = h.make_faces(f1, false)
	let [slab_top, ...rest] = up_faces_at(all_faces, f1.z + h.slab_thickness)
	assert.equal(rest.length, 0)
	assert.deepEqual(faces_bbox([slab_top]), [40, 40, 2960, 3960])
	// floor 0's outer wall under the roof rises to the roof underside.
	let [poly] = all_faces.map(face_poly).filter(poly =>
		poly.is_v && poly.axis == 6140 && poly.normal == 1)
	let d = h.roof_thickness / Math.cos(20 * Math.PI / 180)
	assert(Math.abs(Math.max(...outline_points(poly).map(p => p[1]))
		- (wall_z - d)) < .02)
})

check('the upper roof overhangs the lower roof', () => {
	let h = lean_to_house()
	let [f0, f1] = h.floors
	let upper_faces = f1.make_roof_faces(f1.make_areas())
	assert.deepEqual(faces_bbox(upper_faces), [eave_w, eave_w, eave_e3, eave_s])
	let faces = h.make_faces(f1, false)
	assert.deepEqual(faces_bbox(faces.filter(face => face.tag == 'roof')),
		[eave_w, eave_w, eave_e6, eave_s])
})

// one floor, outer skin x -140..6140, y -140..4140, roof60(). eave sides of
// its roof by outward normal: 'w', 'e', 'n' (y < 0), 's'.
function eave_house() {
	return house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)],
		roof: roof60()}]})
}

let tan20 = Math.tan(20 * Math.PI / 180)
function assert_near(a, b) {
	assert(Math.abs(a - b) < 1e-8, a + ' != ' + b)
}


function eave_sides(f) {
	let sides = []
	let faces = f.make_roof_faces(f.make_areas(), sides)
	let by_dir = {faces: faces}
	for (let side of sides)
		by_dir[side.nx < 0 ? 'w' : side.nx > 0 ? 'e' : side.ny < 0 ? 'n' : 's']
			= side
	return by_dir
}

check('toggle_gable: add a gable point, flip it, or nothing if 2+', () => {
	let h = eave_house()
	let f = h.floors[0]
	let edit_no = h.edit_no
	f.toggle_gable(eave_sides(f).w, -400, 2000)
	assert.equal(h.edit_no, edit_no + 1)
	// the point is on the wall line, across from the click.
	assert.deepEqual({...f.roof.edge_points[0]}, {x: -140, y: 2000, pitch: 90})
	let {w, faces} = eave_sides(f)
	assert.equal(w.edge_point, f.roof.edge_points[0])
	assert.equal(w.pitch, 90)
	assert.equal(faces.length, 3)
	f.toggle_gable(w, -400, 2000)
	assert.equal(f.roof.edge_points[0].pitch, null)
	assert.equal(eave_sides(f).w.pitch, 20)
	assert.equal(eave_sides(f).faces.length, 4)
	f.roof.edge_points.push({x: -140, y: 3000, pitch: 90})
	w = eave_sides(f).w
	assert.equal(w.edge_point, null)
	edit_no = h.edit_no
	f.toggle_gable(w, -400, 2000)
	assert.equal(h.edit_no, edit_no)
	assert.equal(f.roof.edge_points.length, 2)
})

// the overhang of a sloped side with the eave height eave_h (mm, whole).
function eave_overhang(eave_h) {
	return -eave_h / tan20
}

check('moving a sloped eave sets the roof eave height', () => {
	let h = eave_house()
	let f = h.floors[0]
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	assert.equal(m.move(200, 50, false), true)
	m.stop()
	assert_near(f.roof.eave_h, -293)
	assert.equal(f.roof.overhang, 600)
	assert.equal(f.roof.edge_points.length, 0)
	let d = eave_overhang(-293)
	assert.deepEqual(faces_bbox(eave_sides(f).faces),
		[grid(-140 - d), grid(-140 - d), grid(6140 + d), grid(4140 + d)])
	// inward to the wall line: the eaves are at the wall top.
	m = f.start_move_eave(eave_sides(f).n, 3000, -500)
	assert.equal(m.move(0, 900, false), true)
	m.stop()
	assert_near(f.roof.eave_h, 0)
	assert.deepEqual(faces_bbox(eave_sides(f).faces), [-140, -140, 6140, 4140])
	// past the wall line or past max_overhang: clamped.
	m = f.start_move_eave(eave_sides(f).n, 3000, -200)
	assert.equal(m.move(0, 100, false), true)
	assert_near(f.roof.eave_h, 0)
	assert.equal(m.move(0, -1510, false), true)
	assert_near(f.roof.eave_h, -546)
	m.cancel()
})

check('cancelling or undoing an eave move restores the eave height', () => {
	let h = eave_house()
	let f = h.floors[0]
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(300, 0, true)
	m.cancel()
	assert.equal(f.roof.edge_points.length, 0)
	m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(300, 0, false)
	m.stop()
	assert_near(f.roof.eave_h, -329)
	assert(h.undo())
	assert_near(h.floors[0].roof.eave_h, -220)
})

// the face of eave_sides(f) in the plane of the side facing dir.
function eave_face(by_dir, dir) {
	return by_dir.faces.find(face => face.sides.includes(by_dir[dir]))
}

function face_z(face, x, y) {
	let [a, b, c] = face.plane
	return a * x + b * y + c
}

// eave_house's hip roof: the ridge along y = 2000 at this height.
function eave_ridge_z(f) {
	return f.z + f.h + 2140 * Math.tan(20 * Math.PI / 180)
}

check('moving the ridge sets the pitches of the faces on both sides', () => {
	let h = eave_house()
	let f = h.floors[0]
	let by_dir = eave_sides(f)
	let z = eave_ridge_z(f)
	let n = eave_face(by_dir, 'n')
	let s = eave_face(by_dir, 's')
	assert.equal(f.can_move_faces([n, s], z), true)
	let m = f.start_move_faces([n, s], z)
	// along the ridge: no difference.
	assert.equal(m.move(3200, 2500), true)
	m.stop()
	assert.equal(f.roof.edge_points.length, 2)
	by_dir = eave_sides(f)
	n = eave_face(by_dir, 'n')
	s = eave_face(by_dir, 's')
	// the edge points are on the wall lines, at the middle of the sides.
	assert.deepEqual([by_dir.n.edge_point.x, by_dir.n.edge_point.y], [3000, -140])
	assert.deepEqual([by_dir.s.edge_point.x, by_dir.s.edge_point.y], [3000, 4140])
	// both planes pass through the line at the grabbed height, within the
	// rounding of the eave lines to the grid.
	assert(Math.abs(face_z(n, 3000, 2500) - z) < 1e-1)
	assert(Math.abs(face_z(s, 3000, 2500) - z) < 1e-1)
	assert(Math.abs(faces_bbox([n])[3] - 2500) < 1e-1)
	assert(Math.abs(faces_bbox([s])[1] - 2500) < 1e-1)
	assert(by_dir.n.pitch < 20 && by_dir.s.pitch > 20)
	// the other sides keep the roof's pitch.
	assert.equal(by_dir.w.pitch, 20)
	assert.equal(by_dir.e.pitch, 20)
	assert(h.undo())
	assert.equal(h.floors[0].roof.edge_points.length, 0)
})

// stored geometry precision ------------------------------------------------

check('load snaps stored geometry to mm without changing the input plan', () => {
	let plan = {floor_h: 2500.6, int_wall_thickness: 80.6,
		ext_wall_thickness: 180.6, slab_thickness: 200.6,
		roof_thickness: 200.6, floors: [{h: 2600.6,
			lines: [['connect', [-1000.6, 0.4], [1000.6, 0.4],
				[1000.6, 2000.6], [-1000.6, 2000.6], [-1000.6, 0.4]],
				['connect', [0.4, -1000.6], [0.4, 3000.6]]],
			objects: [tag_state('open_room', 300.6, 400.4)],
			roof: {pitch: 23.456789, overhang: 600.6, eave_h: -220.6,
				max_overhang: 1500.6, edge_points: [{x: 1000.6,
					y: 300.4, pitch: null, overhang: null, eave_h: -120.6}]},
		}]}
	let before = JSON.stringify(plan)
	let h = house(plan)
	assert.equal(JSON.stringify(plan), before)
	assert_near(h.floor_h, 2501)
	assert_near(h.int_wall_thickness, 81)
	assert_near(h.ext_wall_thickness, 181)
	assert_near(h.slab_thickness, 201)
	assert_near(h.roof_thickness, 201)
	let f = h.floors[0]
	assert_near(f.fixed_h, 2601)
	assert.equal(f.h, f.fixed_h)
	for (let p of f.ps) {
		assert.equal(p[0], Math.round(p[0]))
		assert.equal(p[1], Math.round(p[1]))
	}
	assert(f.ps.find(p => p[0] == 0 && p[1] == 0 && p.segs.length == 4))
	assert_near(f.objects[0].x, 301)
	assert_near(f.objects[0].y, 400)
	assert.equal(f.roof.pitch, plan.floors[0].roof.pitch)
	assert_near(f.roof.overhang, 601)
	assert_near(f.roof.eave_h, -221)
	assert_near(f.roof.max_overhang, 1501)
	assert_near(f.roof.edge_points[0].x, 1001)
	assert_near(f.roof.edge_points[0].y, 300)
	assert_near(f.roof.edge_points[0].eave_h, -121)
	assert.equal(f.roof.edge_points[0].overhang, null)
	let saved = JSON.stringify(h.save_state())
	assert.equal(JSON.stringify(house(JSON.parse(saved)).save_state()), saved)
})

check('moving a floor height moves upper floors and saves one undo', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{h: 3000, lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
	let state0 = JSON.stringify(h.save_state())
	let f = h.floors[0]
	let upper = h.floors[1]
	let m = f.start_move_height()
	assert.equal(m.move(700), true)
	assert.equal(m.move(700), false)
	m.move(500)
	assert.equal(f.h, 3000)
	assert.equal(upper.z, 3000)
	assert.equal(upper.h, 3000)
	assert.equal(h.h, 6000)
	m.stop()
	assert.equal(h.edit_no, 1)
	assert.equal(h.save_state().floors[0].h, 3000)
	let state1 = JSON.stringify(h.save_state())
	assert(h.undo())
	assert.equal(h.floors[1], upper)
	assert.equal(upper.z, 2500)
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert(h.redo())
	assert.equal(JSON.stringify(h.save_state()), state1)
})

// settings -----------------------------------------------------------------

check('a wall thickness setting rebuilds the walls and is one undo step', () => {
	let h = house(ctx.house_test_plans.simple)
	let bb0 = [...h.bb]
	let edit_no = h.edit_no
	let s = h.start_edit_setting('ext_wall_thickness')
	s.move(300.4)
	s.move(400)
	assert.equal(h.ext_wall_thickness, 400)
	assert(h.bb[0] < bb0[0])
	assert.equal(h.edit_no, edit_no)
	s.stop()
	assert.equal(h.edit_no, edit_no + 1)
	let bb1 = [...h.bb]
	assert(h.undo())
	assert.equal(h.ext_wall_thickness, 180)
	assert.deepEqual([...h.bb], bb0)
	assert.equal(h.undo(), null)
	assert(h.redo())
	assert.equal(h.ext_wall_thickness, 400)
	assert.deepEqual([...h.bb], bb1)
	assert.equal(JSON.stringify(h.save_state()).includes('"ext_wall_thickness":400'),
		true)
})

// objects ------------------------------------------------------------------

function opening_house(objects) {
	return house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)],
		objects: objects}]})
}

// the faces of the north wall's outer side, as polys in (x, z).
function north_outer_polys(h) {
	return wall_polys_at(h, false, -140, -1)
}

let default_n = Object.keys(house({}).object_types).length // default objects.

check('unknown object types warn and are skipped on load and paste', () => {
	let warning_n = warnings.length
	let h = house({
		ground_objects: [{type: 'unknown_ground_object'}],
		floors: [{lines: [rect_lines(0, 0, 6000, 4000)], objects: [
			{type: 'sink'},
			{type: 'bed', x: 1000, y: 1000, rot: 0},
		]}],
	})
	let f = h.floors[0]
	assert.equal(warnings.length, warning_n + 2)
	assert(warnings.slice(warning_n).some(args => args.includes('sink')))
	assert.equal(f.objects.length, 1)
	assert.equal(f.objects[0].type, 'bed')
	assert.equal(h.ground_objects.length, default_n)
	let state = JSON.stringify(h.save_state())
	let edit_no = h.edit_no
	f.add_object({type: 'unknown_pasted_object'}, 2000, 2000, 0)
	assert.equal(warnings.length, warning_n + 3)
	assert.equal(JSON.stringify(h.save_state()), state)
	assert.equal(h.edit_no, edit_no)
})

check('Space cycles saved plant names with undo and redo', () => {
	let source = fs.readFileSync(path.join(sdk,
		'www/house_plan_editor.js'), 'utf8')
	let plant_names = Array.from(source.matchAll(/plant_paths\.(\w+) =/g),
		match => match[1])
	assert.deepEqual(plant_names, ['rosette', 'monstera', 'broad_leaf'])
	let update_source = source.slice(
		source.indexOf('\tobject_views.potted_plant.update ='),
		source.indexOf('\tobject_views.potted_plant.draw ='))
	let object_views = {potted_plant: {}}
	let space = false
	vm.runInNewContext(update_source, {
		object_views, plant_names, ui: {keydown: key => space && key == ' '},
	})
	let h = opening_house([
		{type: 'potted_plant', x: 2000, y: 2000, rot: 0},
	])
	let f = h.floors[0], object = f.objects[0]
	assert.equal(object.plant_name, plant_names[0])
	let edit_no = h.edit_no
	object_views.potted_plant.update(f, object)
	assert.equal(h.edit_no, edit_no)
	space = true
	for (let i = 1; i <= plant_names.length; i++) {
		object_views.potted_plant.update(f, object)
		let name = plant_names[i % plant_names.length]
		assert.equal(object.plant_name, name)
		assert.deepEqual([object.x, object.y, object.w], [2000, 2000, 600])
		assert.equal(object.l, undefined)
		assert.equal(house(h.save_state()).floors[0].objects[0].plant_name,
			name)
	}
	assert(h.undo())
	assert.equal(f.objects[0].plant_name, plant_names.at(-1))
	assert(h.redo())
	assert.equal(f.objects[0].plant_name, plant_names[0])
})

check('plants resize as centred squares from every edge and quarter turn', () => {
	for (let rot of [0, 90, 180, 270]) {
		for (let axis of ['w', 'l']) {
			for (let side of [-1, 1]) {
				let h = opening_house([{type: 'potted_plant',
					x: 2000, y: 2000, rot, w: 600, l: 900}])
				let f = h.floors[0], object = f.objects[0]
				assert.deepEqual(Array.from(h.get_object_box(f, object, [])),
					[2000, 2000, 2600, 2600])
				let [dx, dy] = h.object_vector_to_plan(object,
					axis == 'w' ? side * 25 : 0,
					axis == 'l' ? side * 25 : 0, ctx.Math3D.v2())
				let resize = f.start_resize_object(object, side, axis)
				resize.resize(dx, dy)
				assert.equal(object.w, 650)
				assert.deepEqual(Array.from(h.get_object_box(f, object, [])),
					[1975, 1975, 2625, 2625])
				resize.stop()
				assert(h.undo())
				assert.equal(f.objects[0].w, 600)
				assert(h.redo())
				let saved = h.save_state()
				assert.equal(saved.floors[0].objects[0].l, undefined)
				assert.equal(house(saved).floors[0].objects[0].w, 650)
			}
		}
	}
})

check('object allow defaults to indoor and accepts either location bit', () => {
	let {INDOOR, OUTDOOR} = ctx.house_plan
	for (let allow of [undefined, INDOOR, OUTDOOR, INDOOR | OUTDOOR]) {
		let h = opening_house([{type: 'potted_plant',
			x: 2000, y: 2000, rot: 0}])
		assert.equal(h.object_types.potted_plant.allow, INDOOR | OUTDOOR)
		assert.equal(h.object_types.bed.allow, undefined)
		h.object_types.potted_plant.allow = allow
		let f = h.floors[0], object = f.objects[0]
		let [x0, y0] = box_centre(h, f, object)
		let move = f.start_move_object(object)
		move.move(0, 0, 0)
		assert.equal(object.is_valid, !!((allow ?? INDOOR) & INDOOR))
		move.move(-1000 - x0, 2000 - y0, 0)
		assert.equal(object.is_valid, !!((allow ?? INDOOR) & OUTDOOR))
		assert.equal(object.on_floor, false)
		assert(h.ground_objects.includes(object))
		move.move(-x0, 2000 - y0, 0)
		assert.equal(object.is_valid, false)
		assert.equal(object.on_floor, true)
		assert(f.objects.includes(object))
		move.cancel()
	}
})

check('objects are saved, loaded and undone with their floor', () => {
	let object = {type: 'window', x: 3000, y: 0, rot: 0, w: 1200}
	let h = opening_house([object])
	let state = h.save_state()
	assert.equal(JSON.stringify(state.floors[0].objects),
		JSON.stringify([object]))
	assert.equal(state.ground_objects.length, default_n)
	let h2 = house(state)
	assert.equal(JSON.stringify(h2.save_state()), JSON.stringify(state))
})

check('a window cuts a hole in the wall', () => {
	let h = opening_house([{type: 'window', x: 2400, y: 0, rot: 0, w: 1200}])
	let polys = north_outer_polys(h)
	let holed = polys.filter(p => p.holes.length)
	assert.equal(holed.length, 1)
	let hole = holed[0].slice(holed[0].holes[0])
	let xs = hole.map(p => p[0])
	let zs = hole.map(p => p[1])
	assert.equal(Math.min(...xs), 2400)
	assert.equal(Math.max(...xs), 3600)
	assert.equal(Math.min(...zs), 1100)
	assert.equal(Math.max(...zs), 2300)
})

check('a door cuts a hole from the slab top up', () => {
	let h = opening_house([{type: 'door', x: 2550, y: 0, rot: 0, w: 900}])
	let polys = north_outer_polys(h)
	assert.equal(polys.length, 1)
	assert.equal(polys[0].holes.length, 1)
	let hole = polys[0].slice(polys[0].holes[0])
	let points = Array.from(hole, p => p.join())
	for (let p of ['2550,200', '3450,200', '2550,2300', '3450,2300'])
		assert(points.includes(p), p)
	assert.equal(points.length, 4)
})

check('moving a wall moves its objects along', () => {
	let h = opening_house([
		{type: 'window', x: 3000, y: 0, rot: 0, w: 1200},
		{type: 'door', x: 6000, y: 2000, rot: 90, w: 900},
	])
	let f = h.floors[0]
	let seg = f.objects[0].seg
	let s = f.start_move_seg(seg)
	s.move(0, 500, 0)
	assert.equal(f.objects[0].y, 500)
	assert.equal(f.objects[0].x, 3000)
	assert.equal(f.objects[1].x, 6000)
	assert.equal(f.objects[1].y, 2000)
	s.stop()
	assert.equal(f.objects.length, 2)
	assert.equal(f.objects[0].seg, seg)
	assert(h.undo())
	assert.equal(f.objects[0].y, 0)
})

check('dragging an object onto a wall snaps it to the floor, undo back', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = h.ground_objects.find(object => object.type == 'window')
	let [x0, y0] = box_centre(h, f, object)
	let s = f.start_move_object(object)
	s.move(3000 - x0, 5000 - y0, 200) // clear of the house.
	assert.equal(f.objects.length, 0)
	assert.equal(object.y, 5000)
	s.move(3000 - x0, 3000 - y0, 200) // in the room, off the walls.
	assert.equal(f.objects.length, 1)
	assert(!object.seg)
	assert.equal(object.y, 3000)
	s.move(3000 - x0, 120 - y0, 200)
	assert.equal(f.objects.length, 1)
	assert.equal(h.ground_objects.length, default_n - 1)
	assert.equal(object.y, 0)
	assert.equal(object.x, 2400) // its min end: the window is 1200 wide.
	assert.equal(object.rot, 0)
	s.move(6100 - x0, 2000 - y0, 200)
	assert.equal(object.x, 6000)
	assert.equal(object.y, 1400)
	assert.equal(object.rot, 90)
	s.stop()
	assert.equal(f.objects.length, 1)
	assert(h.undo())
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n)
})

check('an opening turned onto a crossing wall stays on it', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = h.ground_objects.find(object => object.type == 'window')
	let [x0, y0] = box_centre(h, f, object)
	let s = f.start_move_object(object)
	s.move(6200 - x0, 2000 - y0, 200) // touching the outer face at 6140.
	assert.equal(object.rot, 90)
	assert.equal(object.x, 6000)
	s.move(6210 - x0, 2000 - y0, 200)
	assert.equal(object.rot, 90)
	assert.equal(object.x, 6000)
	assert.equal(object.y, 1400)
	s.cancel()
})

check('deleting a wall moves its objects to the ground, undo back', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}])
	let f = h.floors[0]
	f.delete_seg(f.objects[0].seg)
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	assert(h.undo())
	assert.equal(f.objects.length, 1)
	assert.equal(h.ground_objects.length, default_n)
	assert(h.redo())
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
})

// furniture: the room of opening_house has its faces at 40 and 5960 (x), 40
// and 3960 (y).
function add_furniture(f, type, rot, x, y, snap_d) {
	f.add_object({type: type, x: 0, y: 0, rot: rot}, x, y, snap_d)
	return f.objects.at(-1)
}

check('furniture rests its snapping face against the wall it is near', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 3000, 1100, 200)
	assert.equal(f.objects.length, 1)
	assert.equal(object.rot, 0)
	assert.equal(object.y, 40) // the head against the north face at 40.
	assert.equal(object.x, 2300)
	assert(object.on_floor)
	assert(!object.seg)
})

check('furniture goes to the ground only when clear of the house', () => {
	let h = opening_house([])
	let f = h.floors[0]
	add_furniture(f, 'bed', 0, 3000, -2000, 200)
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	let object = h.ground_objects.at(-1)
	assert(!object.on_floor)
	let [x0, y0] = box_centre(h, f, object)
	let s = f.start_move_object(object)
	s.move(3000 - x0, 100 - y0, 0) // its head is in the north wall.
	assert.equal(f.objects.length, 1)
	s.move(3000 - x0, -2000 - y0, 0)
	assert.equal(f.objects.length, 0)
	s.move(3000 - x0, 2000 - y0, 0)
	assert.equal(f.objects.length, 1)
	s.stop()
})

// countertop ---------------------------------------------------------------

// the default contour is [0, 600, 0, 0, 1800, 0, 1800, 600]: free ends on
// edges 0 and 2. a handle is edge_index * 3 + zone + 1; zone 1 is the start
// and zone 2 the end of the edge.
function countertop_floor() {
	let h = house({floors: [{lines: [rect_lines(0, 0, 8000, 8000)]}]})
	let f = h.floors[0]
	// the box centre of the default 1800 x 600 contour at (3000, 3000).
	f.add_object({type: 'countertop', rot: 0}, 3900, 3300, 0)
	return f
}

check('countertop handles extend and retract from all four free corners', () => {
	// [corner handle, outward dy, handle of the new leg's free end, box]
	for (let [handle, dy, end_handle, extended_box] of [
		[5, -800, 1, [3000, 2200, 4800, 3600]],
		[6, -800, 10, [3000, 2200, 4800, 3600]],
		[11, 800, 10, [3000, 3000, 4800, 4400]],
		[12, 800, 1, [3000, 3000, 4800, 4400]],
	]) {
		let f = countertop_floor()
		let object = f.objects.at(-1)
		let bounds = []
		let s = f.start_resize_object(object, handle)
		s.resize(0, dy)
		s.stop()
		assert.equal(object.contour.length, 12)
		assert.deepEqual(f.house.get_object_box(f, object, bounds), extended_box)
		s = f.start_resize_object(object, end_handle)
		s.resize(0, -dy)
		s.stop()
		assert.deepEqual(Array.from(object.contour),
			[0, 600, 0, 0, 1800, 0, 1800, 600])
		assert.deepEqual(f.house.get_object_box(f, object, bounds),
			[3000, 3000, 4800, 3600])
	}
})

check('countertop copies, saved states and undo own their contours', () => {
	let f = countertop_floor()
	let object = f.objects.at(-1)
	let state = f.house.save_state()
	let copy = f.house.save_object(object)
	assert.notEqual(copy.contour, object.contour)
	let s = f.start_resize_object(object, 11)
	s.resize(0, 1000)
	s.stop()
	assert.equal(copy.contour.length, 8)
	assert.equal(state.floors[0].objects[0].contour.length, 8)
	f.house.undo()
	assert.equal(f.objects.at(-1).contour.length, 8)
	f.house.redo()
	assert.equal(f.objects.at(-1).contour.length, 12)
	let h1 = house(f.house.save_state())
	assert.deepEqual(Array.from(h1.floors[0].objects.at(-1).contour),
		Array.from(f.objects.at(-1).contour))
	f.add_object(copy, 1000, 1000, 0)
	assert.notEqual(f.objects.at(-1).contour, copy.contour)
})

check('sinks and stovetops sit on countertop front edges, after them', () => {
	let f = countertop_floor()
	let bounds = []
	// the nearer front edge: the bottom one, 50 mm in.
	f.add_object({type: 'kitchen_sink', rot: 0}, 3900, 3500, 0)
	let sink = f.objects.at(-1)
	assert(sink.is_valid)
	assert.equal(sink.rot, 0)
	assert.deepEqual(f.house.get_object_box(f, sink, bounds),
		[3600, 3100, 4200, 3550])
	// the top edge, facing up.
	f.add_object({type: 'kitchen_sink', rot: 0}, 4500, 3100, 0)
	assert.equal(f.objects.at(-1).rot, 180)
	assert.deepEqual(f.house.get_object_box(f, f.objects.at(-1), bounds),
		[4200, 3050, 4800, 3500])
	// centred across, clamped along.
	f.add_object({type: 'stovetop', rot: 0}, 3100, 3200, 0)
	let stovetop = f.objects.at(-1)
	assert(stovetop.is_valid)
	assert.equal(stovetop.rot, 0)
	assert.deepEqual(f.house.get_object_box(f, stovetop, bounds),
		[3000, 3040, 3600, 3560])
	// resizing snaps to the size step; with nosnap (ctrl), to whole mm.
	let s = f.start_resize_object(stovetop, 1, 'w')
	s.resize(37, 0, 0)
	assert.equal(stovetop.w, 650)
	s.resize(37, 0, 0, true)
	assert.equal(stovetop.w, 637)
	s.stop()
	// off the countertop: invalid.
	f.add_object({type: 'kitchen_sink', rot: 0}, 1000, 1000, 0)
	assert(!f.objects.at(-1).is_valid)
	// a new countertop goes before the sinks and stovetops.
	f.add_object({type: 'countertop', rot: 0}, 3900, 6000, 0)
	assert.deepEqual(Array.from(f.objects, object => object.type), ['countertop',
		'countertop', 'kitchen_sink', 'kitchen_sink', 'stovetop',
		'kitchen_sink'])
	// a countertop against a wall: only the other long edge is a front edge.
	s = f.start_move_object(f.objects[1])
	s.move(0, -5600, 500)
	s.stop()
	let [x1, y1, x2, y2] = f.house.get_object_box(f, f.objects[1], bounds)
	f.add_object({type: 'stovetop', rot: 180}, (x1 + x2) / 2, y1 + 300, 0)
	assert.equal(f.objects.at(-1).rot, 0)
	assert.equal(f.objects.at(-1).y, y1 + 40)
})

// stairs -------------------------------------------------------------------

function stair_house(height = 2800, objects, lower_lines) {
	return house({floors: [
		{h: height, lines: lower_lines ?? [rect_lines(0, 0, 8000, 8000)]},
		{lines: [rect_lines(0, 0, 8000, 8000),
			['connect', [0, 2000], [8000, 2000]]],
			objects: objects ?? [
				{type: 'stair', x: 3550, y: 2040, rot: 0}, // top middle 4000
				tag_state('open_room', 4000, 4000),
			]},
	]})
}

function stair_of(h) {
	return h.floors[1].objects.find(o => o.type == 'stair')
}

check('a stair belongs to its upper floor and fits its actual slab opening',
	() => {
	let h = stair_house()
	let stair = stair_of(h)
	assert(stair?.on_floor)
	assert.equal(h.floors[0].objects.length, 0)
	assert.equal(stair.stair.n, 16)
	assert.equal(stair.stair.rise, 175)
	assert.equal(stair.stair.bottom_rise, 175)
	assert.equal(stair.stair.l, 4200)
	assert.equal(stair.l, null)
	assert.equal(stair.stair.depth, 280)
})

check('a stair needs an upper opening, a top wall, and slab beyond it', () => {
	for (let objects of [
		[{type: 'stair', x: 4000, y: 2040, rot: 0}],
		[{type: 'stair', x: 4000, y: 2200, rot: 0},
			tag_state('open_room', 4000, 4000)],
		[{type: 'stair', x: 4000, y: 140, rot: 0},
			tag_state('open_room', 4000, 4000),
			tag_state('open_room', 4000, 1000)],
		[{type: 'stair', x: 4000, y: 2040, rot: 0, l: 7000},
			tag_state('open_room', 4000, 4000)],
		[{type: 'stair', x: 4000, y: 2040, rot: 0},
			tag_state('open_room', 4000, 4000),
			tag_state('open_room', 4000, 1000)],
	]) {
		let h = stair_house(2800, objects)
		let stair = stair_of(h)
		assert(stair) // touching the house: it stays on the floor.
		h.object_types.stair.place(h.floors[1], stair, 0)
		assert(!stair.on_floor)
	}
	let h = stair_house()
	let stair = stair_of(h)
	h.object_types.stair.place(h.floors[1], stair, 0)
	assert(stair.on_floor)
})

check('stair saved state keeps parameters and excludes calculated sizes', () => {
	let h = stair_house()
	let f = h.floors[1]
	let stair = stair_of(h)
	f.update_object(stair, o => { o.tread_depth = 275; o.l = 4003 })
	let saved = h.save_object(stair)
	assert.equal(saved.tread_depth, 275)
	assert.equal(saved.l, 4003)
	assert(!('stair' in saved))
	let h1 = stair_house(2800, [saved, tag_state('open_room', 4000, 4000)])
	assert(stair_of(h1)?.on_floor)
	assert.equal(stair_of(h1).stair.l, 4003)
})

// object coordinates --------------------------------------------------------

// fill a stub model editor with the house through ui.house_model_editor,
// with a stub ui: any ui function does nothing, except stateful_widget,
// which returns a widget that does nothing, and model3_editor, which runs
// the editor's init. create_component(name) returns the component for
// that name.
function fill_model_editor(h, create_component) {
	if (!ctx.ui) {
		let stub_ui = {stateful_widget: () => () => {}}
		ctx.ui = new Proxy(stub_ui, {get: (t, k) => t[k] ?? (() => {})})
		ctx.S = (name, text) => text
		let file = path.join(sdk, 'www/house_model_editor.js')
		vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
	}
	let editor = {
		create_component: t => create_component(t.name),
		root: {comp: {add_child() {}}},
		update_all() {},
		set_camera_pos() {},
		set_camera_dir() {},
	}
	ctx.ui.model3_editor = (id, opt, init) => init(editor)
	ctx.ui.house_model_editor('house_model', h)
}

check('the stair group is closed with outward faces and exact tread heights',
	() => {
	let h = stair_house(2813)
	let stair = stair_of(h)
	let points = [], faces = []
	let group = {
		add_point_xyz(x, y, z) {
			points.push([x, y, z])
			return points.length - 1
		},
		add_face(pis) { faces.push(Array.from(pis)) },
	}
	let other_group = {add_point_xyz() { return 0 }, add_face() {}}
	let n_stairs = 0
	fill_model_editor(h, name => {
		if (name != 'stair')
			return other_group
		n_stairs++
		return group
	})
	assert.equal(n_stairs, 1)
	let edges = new Map(), tread_heights = []
	let volume = 0
	for (let face of faces) {
		for (let i = 0; i < face.length; i++) {
			let a = face[i], b = face[(i + 1) % face.length]
			let reverse = b + ',' + a
			if (edges.has(reverse)) edges.delete(reverse)
			else edges.set(a + ',' + b, true)
		}
		let p = ctx.Math3D.poly3(...face)
		p.points = points.flat()
		let normal = p.plane().normal
		if (normal[1] > 0)
			tread_heights.push(points[face[0]][1])
		for (let i = 1; i < face.length - 1; i++) {
			let a = points[face[0]], b = points[face[i]]
			let c = points[face[i + 1]]
			volume += a[0] * (b[1] * c[2] - b[2] * c[1])
				+ a[1] * (b[2] * c[0] - b[0] * c[2])
				+ a[2] * (b[0] * c[1] - b[1] * c[0])
		}
	}
	assert.equal(edges.size, 0)
	assert(volume > 0)
	assert.equal(tread_heights.length, stair.stair.n - 1)
	assert.equal(Math.min(...tread_heights), -2813 + 173)
	assert.equal(Math.max(...tread_heights), -165)
})

// round dining table -------------------------------------------------------

check('round table resize keeps its centre, limits and undo state', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 6000)],
		objects: [{type: 'round_table', x: 1800, y: 1800, rot: 90}]}]})
	let f = h.floors[0], t = f.objects[0]
	assert.equal(t.w, 1200)
	assert.deepEqual(Array.from(h.get_object_box(f, t, [])),
		[1800, 1800, 3750, 3750])
	let r = f.start_resize_object(t, 1)
	r.resize(0, 36)
	assert.equal(t.w, 1250)
	assert.equal(t.x, 1775)
	assert.equal(t.y, 1775)
	r.resize(0, 10000)
	assert.equal(t.w, 2000)
	r.resize(0, -10000)
	assert.equal(t.w, 800)
	r.stop()
	assert(h.undo())
	assert.equal(f.objects[0].w, 1200)
	assert(h.redo())
	assert.equal(f.objects[0].w, 800)
	let state = h.save_object(f.objects[0])
	assert.equal(state.w, 800)
	assert.equal(state.l, undefined)
})

check('round table can resize into and out of invalid placement', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 4000, 4000)],
		objects: [{type: 'round_table', x: 150, y: 850, rot: 0}]}]})
	let f = h.floors[0], t = f.objects[0]
	assert(t.on_floor)
	let r = f.start_resize_object(t, 1)
	r.resize(1000, 0)
	assert.equal(t.w, 2000)
	assert.equal(t.x, -250)
	assert(t.on_floor) // across the wall, still touching the house.
	assert(!h.ground_objects.includes(t))
	r.resize(0, 0)
	assert.equal(t.w, 1200)
	assert(t.on_floor)
	r.cancel()
	t = f.objects[0]
	let m = f.start_move_object(t)
	m.move(-3000, 0, 0)
	assert.equal(t.on_floor, false) // clear of the house.
	assert(h.ground_objects.includes(t))
	m.move(0, 0, 0)
	assert(t.on_floor)
	m.cancel()
})

check('round table square chairs stay half tucked and inside its box', () => {
	let source = fs.readFileSync(path.join(sdk,
		'www/house_plan_editor.js'), 'utf8')
	let draw_source = source.slice(
		source.indexOf('\t/// table chairs'),
		source.indexOf('\t/// countertop'))
	let h = house({floors: []})
	let object_views = {}
	vm.runInNewContext(draw_source, {
		PI: Math.PI, floor: Math.floor,
		cos: Math.cos, sin: Math.sin, s: {house: h}, box: [], id: 'test',
		ui: {color_css: () => '', captured: () => null, hovers: () => null},
		object_views, hit_box() {}, hit_resize_rect() {},
	})
	let draw = object_views.round_table.draw
	let paths = [], points // the points of each stroked path
	let cx = {
		beginPath() { points = [] },
		moveTo(x, y) { points.push([x, y]) },
		lineTo(x, y) { points.push([x, y]) },
		closePath() {}, fill() {}, stroke() { paths.push(points) }, arc() {},
	}
	for (let w = 800; w <= 2000; w += 50) {
		let object = {type: 'round_table', w}
		let box = h.object_types.round_table.local_box(null, object, [])
		let [x1, y1, x2, y2] = box
		let cx0 = (x1 + x2) / 2, cy = (y1 + y2) / 2
		paths.length = 0
		draw(cx, null, object)
		let points = paths[0] // the chairs
		let n = points.length / 6
		assert.equal(n, Math.floor(Math.PI * w / 600))
		for (let i = 0; i < points.length; i += 6) {
			let x = 0, y = 0
			for (let j = 0; j < 4; j++) {
				let [px, py] = points[i+j]
				assert(px >= x1 && py >= y1 && px <= x2 && py <= y2)
				x += px / 4
				y += py / 4
				let [qx, qy] = points[i + (j+1) % 4]
				let side = Math.hypot(qx - px, qy - py)
				assert(Math.abs(side - 450) < 1e-9)
			}
			let r = Math.hypot(x - cx0, y - cy)
			assert(Math.abs(r - w / 2) < 1e-9)
			if (n == 4 && i == 0) {
				assert(x > cx0 && y > cy)
				assert(Math.abs(x - y) < 1e-9)
			}
		}
	}
})

check('round table drawing and diameter use its actual local box', () => {
	let source = fs.readFileSync(path.join(sdk,
		'www/house_plan_editor.js'), 'utf8')
	let draw_source = source.slice(
		source.indexOf('\t/// table chairs'),
		source.indexOf('\t/// countertop'))
	let object_views = {}
	let h = house({floors: []})
	let object = {type: 'round_table', w: 1200}
	let hs = {object}, arc, rect, diameter
	let context = {
		s: {house: h}, box: [], PI: Math.PI, id: 'test',
		floor: Math.floor, cos: Math.cos, sin: Math.sin,
		to_pixels_exact: () => 1, table_dash: [0, 0], solid_line: [],
		ui: {color_css: () => '', captured: () => hs, hovers: () => null},
		draw_object_length(cx, plan, object, ...args) { diameter = args },
		object_views, hit_box() {}, hit_resize_rect() {},
	}
	vm.runInNewContext(draw_source, context)
	let draw = object_views.round_table.draw
	let sizes = object_views.round_table.draw_sizes
	let cx = {
		beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
		fill() {}, stroke() {}, setLineDash() {},
		arc(...args) { arc = args },
		strokeRect(...args) { rect = args },
	}
	let [x1, y1, x2, y2] = h.object_types.round_table
		.local_box(null, object, [])
	let x = (x1 + x2) / 2, y = (y1 + y2) / 2
	draw(cx, null, object)
	sizes(cx, null, object)
	assert.deepEqual(arc, [x, y, object.w / 2, 0, 2 * Math.PI])
	assert.deepEqual(rect, [x1, y1, x2 - x1, y2 - y1])
	assert.deepEqual(diameter,
		[x - object.w / 2, y, x + object.w / 2, y, 0])
	hs = null
	rect = null
	draw(cx, null, object)
	assert.equal(rect, null)
})

check('round table resizes from all four edges at every quarter turn', () => {
	let source = fs.readFileSync(path.join(sdk,
		'www/house_plan_editor.js'), 'utf8')
	let helper = source.slice(source.indexOf('\tfunction hit_resize_rect('),
		source.indexOf('\t/// window and door'))
	for (let rot = 0; rot < 360; rot += 90) {
		let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 6000)],
			objects: [{type: 'round_table', x: 1800, y: 1800, rot}]}]})
		let f = h.floors[0], t = f.objects[0]
		let hit = vm.runInNewContext(helper + '\nhit_resize_rect', {
			s: {house: h}, to_plan: d => d, css_to_plan: d => d, box: [],
			object_point1: ctx.Math3D.v2(), min: Math.min,
		})
		for (let axis of ['w', 'l']) {
			for (let side of [-1, 1]) {
				let [x1, y1, x2, y2] = h.object_types.round_table
					.local_box(f, t, [])
				let is_l = axis == 'l'
				let x = is_l ? (x1 + x2) / 2 : side == -1 ? x1 : x2
				let y = is_l ? (side == -1 ? y1 : y2) : (y1 + y2) / 2
				let point = h.object_to_plan(f, t,
					x, y, ctx.Math3D.v2())
				let hs = {mx_plan: point[0], my_plan: point[1]}
				assert(hit(f, t, hs, true))
				assert.equal(hs.object_axis, axis)
				assert.equal(hs.object_side, side)
				let [dx, dy] = h.object_vector_to_plan(t,
					is_l ? 0 : 25 * side,
					is_l ? 25 * side : 0, ctx.Math3D.v2())
				let r = f.start_resize_object(t, hs.object_side, hs.object_axis)
				r.resize(dx, dy)
				assert.equal(t.w, 1250)
				assert.equal(t.x, 1775)
				assert.equal(t.y, 1775)
				r.cancel()
				t = f.objects[0]
			}
		}
	}
})

// rectangular dining table -------------------------------------------------

check('rect table chairs skip short and blocked sides', () => {
	let source = fs.readFileSync(path.join(sdk,
		'www/house_plan_editor.js'), 'utf8')
	let draw_source = source.slice(
		source.indexOf('\t/// table chairs'),
		source.indexOf('\t/// countertop'))
	let h = house({floors: []})
	let object_views = {}
	vm.runInNewContext(draw_source, {
		PI: Math.PI, floor: Math.floor, abs: Math.abs,
		sign: Math.sign, cos: Math.cos, sin: Math.sin, s: {house: h},
		box: [], id: 'test', object_views, hit_box() {}, hit_resize_rect() {},
		ui: {color_css: () => '', captured: () => null, hovers: () => null},
	})
	let paths = [], points // the points of each stroked path
	let cx = {
		beginPath() { points = [] },
		moveTo(x, y) { points.push([x, y]) },
		lineTo(x, y) { points.push([x, y]) },
		closePath() {}, fill() {}, stroke() { paths.push(points) }, rect() {},
	}
	// the chairs on each side, classified by the side that each chair's centre
	// is on: [top, right, bottom, left].
	function count_chairs(w, l, blocked_sides) {
		paths.length = 0
		object_views.rect_table.draw(cx, null,
			{type: 'rect_table', w, l, blocked_sides})
		let sides = [0, 0, 0, 0]
		for (let i = 0; i < paths[0].length; i += 6) {
			let x = 0, y = 0
			for (let j = 0; j < 4; j++) {
				x += paths[0][i+j][0] / 4
				y += paths[0][i+j][1] / 4
			}
			if (Math.abs(y) < 1e-9) sides[0]++
			else if (Math.abs(x - w) < 1e-9) sides[1]++
			else if (Math.abs(y - l) < 1e-9) sides[2]++
			else sides[3]++
		}
		return sides
	}
	let [top, right, bottom, left] = count_chairs(3000, 1500, 0)
	assert(right > 0 && top > right)
	assert.equal(top, bottom)
	assert.equal(right, left)
	assert.deepEqual(count_chairs(1500, 3000, 0), [right, top, right, top])
	assert.deepEqual(count_chairs(300, 300, 0), [0, 0, 0, 0])
	assert.deepEqual(count_chairs(3000, 1500, 0b0010), [top, 0, bottom, left])
})

check('rect table blocks the sides that rest against a wall', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 6000)],
		objects: [{type: 'rect_table', x: 2000, y: 2000, rot: 0}]}]})
	let f = h.floors[0], t = f.objects[0]
	assert.equal(t.blocked_sides, 0)
	let m = f.start_move_object(t)
	m.move(-2000, 0, 300)
	assert.equal(t.x, t.side_x[1])
	assert.equal(t.blocked_sides, 0b1000) // the left side
	m.move(0, 0, 0)
	assert.equal(t.blocked_sides, 0)
	m.cancel()
	// turned a quarter, the local top faces the right wall.
	h = house({floors: [{lines: [rect_lines(0, 0, 6000, 6000)],
		objects: [{type: 'rect_table', x: 2000, y: 2000, rot: 90}]}]})
	f = h.floors[0]
	t = f.objects[0]
	m = f.start_move_object(t)
	m.move(3000, 0, 300)
	assert.equal(h.get_object_box(f, t, [])[2], t.side_x[1])
	assert.equal(t.blocked_sides, 0b0001) // the local top
	m.cancel()
})

console.log(n_checks + ' house plan checks passed')
