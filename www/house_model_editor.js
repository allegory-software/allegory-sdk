(function () {
"use strict"
const G = window

const {
	assert, push_log, pop_log,
	empty_obj,
} = glue

const {v3, mat4, line2, line3} = Math3D

// fill the editor with the house model up to cut_floor, or with all of it.
function init_house_model_editor(e, house, cut_floor) {

	e.house = assert(house)
	e.house_edit_no = house.edit_no
	e.cut_floor = cut_floor // floor the model is cut at, or null

	let project_wall_to_roof_face
	{

	let edge = line3()
	function wall_edge(wp) {
		let [x, y] = wp
		edge[0].set(x, 0, y)
		edge[1].set(x, 1, y)
		return edge
	}

	let cl = line3() // wall cut line i.e. wall base line projected on the roof face plane
	let cl_on_wall = line2() // cut line in wall plane as 2D vector
	let cl_on_roof = line2() // cut line in roof plane as 2D vector
	let sl = line2() // resulting seg line

	project_wall_to_roof_face = function(wall, wp1, wp2, roof_face) {

		roof_face.plane().intersect_line(wall_edge(wp1), cl[0])
		roof_face.plane().intersect_line(wall_edge(wp2), cl[1])

		cl.transform(wall.plane, cl_on_wall)
		cl.transform(roof_face.plane(), cl_on_roof)

		let ts = cl_on_roof.split_by_poly(roof_face, 'inside', [])

		for (let i = 0, n = ts.length; i < n; i += 2) {
			let t1 = ts[i+0]
			let t2 = ts[i+1]
			cl_on_wall.at(t1, sl[0])
			cl_on_wall.at(t2, sl[1])
			let sp1 = wall.add_point(sl[0][0], sl[0][1])
			let sp2 = wall.add_point(sl[1][0], sl[1][1])
			wall.add_seg(sp1, sp2)
			if (t1 == 0) wall.sp1 = sp1
			if (t2 == 1) wall.sp2 = sp2
		}
	}
	}

	function create_plan(wall_polys, horizontal_polys) {

		// walls: one face per merged wall polygon of the house.
		push_log('creating walls')
		let c = e.create_component({name: 'walls'})
		e.root.comp.add_child(c, mat4())

		// add a face from the outline and holes of poly, each loop reversed
		// if is_reversed. add_poly_point(poly, p) adds 2D point p in 3D.
		function add_poly_face(poly, is_reversed, add_poly_point) {
			let pis = []
			for (let hi = -1, hn = poly.hole_count(); hi < hn; hi++) {
				let i1 = hi < 0 ? 0 : poly.hole_i1(hi)
				let i2 = hi < 0 ? poly.point_count_without_holes()
					: poly.hole_i2(hi)
				for (let j = 0; j < i2 - i1; j++)
					pis.push(add_poly_point(poly, poly[is_reversed ? i2-1-j : i1+j]))
			}
			c.add_face(pis, null, null, poly.holes)
		}

		function add_wall_point(poly, [m, z]) {
			let x = poly.is_v ? poly.axis : m
			let y = poly.is_v ? m : poly.axis
			return c.add_point_xyz(x, z, y)
		}

		function add_horizontal_point(poly, [x, y]) {
			return c.add_point_xyz(x, poly.z, y)
		}

		for (let poly of wall_polys) {
			// model3 faces are ccw seen from outside. the poly is ccw in
			// (m, z), so it is cw seen from outside when the plan's m axis
			// is toward the viewer's left: on an x plane facing +x, or on a
			// y plane facing -y. reverse each loop there.
			let is_reversed = poly.is_v == (poly.normal > 0)
			add_poly_face(poly, is_reversed, add_wall_point)
		}

		// slab tops and undersides, wall caps. a poly that is ccw in plan
		// (x, y) is cw seen from above, so reverse each loop of up faces.
		for (let poly of horizontal_polys) {
			let is_reversed = poly.normal > 0
			add_poly_face(poly, is_reversed, add_horizontal_point)
		}
		pop_log()

		// roof: on the top floor, when the model is not cut.
		let top_floor = floors[floors.length-1]
		if (!cut_floor && top_floor.roof) {
			push_log('creating roof')
			let c = e.create_component({name: 'roof'})
			e.root.comp.add_child(c, mat4())
			for (let face of top_floor.make_roof_faces()) {
				// the footprint has no holes, so neither have its faces: each
				// ring is an outline, ccw in plan (x, y), so cw seen from
				// above: reverse it.
				for (let ring of face.rings) {
					let pis = []
					let area = 0
					for (let i = ring.length-1; i >= 0; i--) {
						let [x1, y1, z] = ring[i]
						let [x2, y2] = ring[(i+1) % ring.length]
						area += x1 * y2 - x2 * y1
						pis.push(c.add_point_xyz(x1, z, y1))
					}
					assert(area > 0)
					c.add_face(pis)
				}
			}
			pop_log()
		}

	}

	let floors = house.floors
	let [wall_polys, horizontal_polys] = cut_floor
		? house.make_polys(cut_floor, true)
		: house.make_polys(floors[floors.length-1], false)
	create_plan(wall_polys, horizontal_polys)
	e.update_all()
}

// ui.house_model_editor (id, house, floor=, fr=1, align='s', valign='s')
// floor: the current floor, which the user can choose to cut the model at.
ui.house_model_editor = function(id, house, floor, fr, align, valign) {
	let cut_id = id+'.cut_button'
	// read before the toggle builds: its update gives this frame's click.
	let is_cut = ui.value(cut_id) ?? true // option: cut the model at floor
	let cut_floor = floor && is_cut ? floor : null
	let e = ui.state_of(id, 'e')
	let init = null
	if (!e) {
		init = function(e1) {
			init_house_model_editor(e1, house, cut_floor)
			// the house is in cm, the editor's default camera is for 1-unit models.
			e1.set_camera_pos(v3(-300, 600, 900))
			e1.set_camera_dir(v3(-6, 4.4, 7))
		}
	} else if (e.house != house || e.house_edit_no != house.edit_no
		|| e.cut_floor != cut_floor
	) {
		e.clear_model()
		init_house_model_editor(e, house, cut_floor)
	}
	ui.stack('', fr, align, valign)
		ui.model3_editor(id, empty_obj, init)
		ui.p(ui.sp())
		ui.stack()
			if (floor)
				ui.toggle_button(cut_id, is_cut,
					S('house_model_cut', 'Up to current floor'), null, 0, 'l', 't')
		ui.end_stack()
	ui.end_stack()
}

}()) // module function
