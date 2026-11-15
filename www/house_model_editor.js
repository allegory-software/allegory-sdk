(function () {
"use strict"
const G = window

const {
	assert, push_log, pop_log,
	map,
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

	function create_plan(faces) {

		// one component per face tag ('walls', 'roof'), named after it.
		push_log('creating faces')
		let comp_by_tag = map() // {tag -> component}
		for (let face of faces) {
			let c = comp_by_tag.get(face.tag)
			if (!c) {
				c = e.create_component({name: face.tag})
				e.root.comp.add_child(c, mat4())
				comp_by_tag.set(face.tag, c)
			}
			// face rings are ccw seen from outside in (x, y, z). the model's
			// (x, y, z) is the plan's (x, z, y), a mirror, so reverse each ring.
			let pis = []
			let holes = []
			for (let ring of face.rings) {
				if (pis.length)
					holes.push(pis.length)
				for (let i = ring.length-1; i >= 0; i--) {
					let [x, y, z] = ring[i]
					pis.push(c.add_point_xyz(x, z, y))
				}
			}
			c.add_face(pis, null, null, holes)
		}
		pop_log()

	}

	let floors = house.floors
	let faces = cut_floor
		? house.make_faces(cut_floor, true)
		: house.make_faces(floors[floors.length-1], false)
	create_plan(faces)
	e.update_all()
}

ui.saved_value_def('house_model_fov', 60, ui.create_field({
	type: 'number',
	min: 20,
	max: 120,
	decimals: 0,
}))

let model_editor_opt = {}

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
	model_editor_opt.fov = ui.saved_value('house_model_fov') ?? undefined
	ui.stack('', fr, align, valign)
		ui.model3_editor(id, model_editor_opt, init)
		ui.p(ui.sp())
		ui.stack()
			if (floor)
				ui.toggle_button(cut_id, is_cut,
					S('house_model_cut', 'Up to current floor'), null, 0, 'l', 't')
			ui.h(0, ui.sp(), 'r', 't')
				ui.text('', S('house_model_fov', 'FOV'))
				let fov_i = ui.stack('', 0)
					ui.num_slider('house_model_fov')
				ui.end_stack()
			ui.end_h()
		ui.end_stack()
	ui.end_stack()
}

}()) // module function
