(function () {
"use strict"
const G = window

const {
	assert, push_log, pop_log,
	empty_array, empty_obj,
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

		for (let floor of house.floors) {

			// cut: skip the roofs of the cut floor and above.
			if (cut_floor && floor.i >= cut_floor.i)
				break

			push_log('creating floor', floor.id)

			let floor_y = floor.z

			for (let roof of floor.roofs ?? empty_array) {

				let roof_name = 'roof_'+floor.i

				push_log('creating roof', roof_name)

				let c = e.create_component({name: roof_name})
				e.root.comp.add_child(c, mat4().translate(0, floor_y, 0))

				roof.comp = c

				if (roof.type == 'gable') {

					// calculate the ridge end-point coords om the xz-plane
					let pitch = roof.pitch
					let h = assert(roof.h)
					let eaves = roof.eaves ?? 0
					let axis = roof.axis ?? 'v'
					let [bx1, bz1, bx2, bz2] = roof.box
					let rx1, rz1, rx2, rz2, y1, y2
					if (axis == 'v') {
						rz1 = bz1
						rz2 = bz2
						rx1 = (bx2 + bx1) / 2
						rx2 = rx1
					} else {
						rx1 = bx1
						rx2 = bx2
						rz1 = (bz2 + bz1) / 2
						rz2 = rz1
					}

					// generate the 2 sides, 2 faces each, of the gable roof
					for (let j = 0; j <= 1; j++) { // bottom then top face

						let ry = h + j * 20

						// generate the ridge end-points for this face
						c.add_point_xyz(rx1, ry, rz1)
						c.add_point_xyz(rx2, ry, rz2)

						for (let i = 0; i <= 1; i++) { // left then right side
							let pis = []
							let x1, z1, x2, z2
							if (axis == 'v') {
								z1 = rz1
								z2 = rz2
								x1 = i ? bx2 : bx1
								x2 = x1
							} else {
								x1 = rx1
								x2 = rx2
								z1 = i ? bz2 : bz1
								z2 = z1
							}
							let y = ry - 100
							if (!i) {
								c.add_point_xyz(x2, y, z2)
								c.add_point_xyz(x1, y, z1)
								if (!j)
									pis.push(3, 2, 1, 0)
								else
									pis.push(6, 7, 8, 9)
							} else {
								c.add_point_xyz(x1, y, z1)
								c.add_point_xyz(x2, y, z2)
								if (!j)
									pis.push(5, 4, 0, 1)
								else
									pis.push(7, 6, 10, 11)
							}
							let face = c.add_face(pis)
							face.bottom = !j
						}

					}

					// create fascias
					c.add_face([1, 2, 8, 7, 11, 5])
					c.add_face([0, 4, 10, 6, 9, 3])
					c.add_face([3, 9, 8, 2])
					c.add_face([4, 5, 11, 10])

				}

				pop_log()

			} // for roof

			pop_log()

		} // for floor

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
