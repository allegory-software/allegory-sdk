(function () {
"use strict"
const G = window

const {
	assert, push_log, pop_log,
	map, max, PI, format_kcount,
	profile_time,
} = glue

const {v3, v2, mat4, line2, line3} = Math3D

// object models -------------------------------------------------------------

// build a closed stair mesh below the top landing, with outward-facing faces.
function create_stair_model(editor, plan, object) {
	let s = plan.house.stair_shape(plan, object)
	let c = editor.create_component({name: 'stair'})
	let w = object.w
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
		left.push(c.add_point_xyz(0, h - s.height, z))
		right.push(c.add_point_xyz(w, h - s.height, z))
	}
	c.add_face(left)
	c.add_face(right.slice().reverse())
	for (let i = 0; i < profile.length; i++) {
		let j = (i + 1) % profile.length
		c.add_face([left[i], right[i], right[j], left[j]])
	}
	return c
}

let object_models = { // {type -> create_model(editor, plan, object)}
	stair: create_stair_model,
}

// house model ---------------------------------------------------------------

let wall_footprint_material = {
	name: 'Wall footprints', diffuse_color: 0x666666,
	uv: v2(1, 1), opacity: 1,
}

// fill the editor with the house model up to cut_floor, or with all of it.
function init_house_model_editor(e, house, cut_floor, no_external_walls) {

	e.house = assert(house)
	e.house_edit_no = house.edit_no
	e.cut_floor = cut_floor // floor the model is cut at, or null
	e.no_external_walls = no_external_walls

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

		// one component per face tag, named after it.
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
			let material = face.tag == 'wall_footprints'
				? wall_footprint_material : null
			c.add_face(pis, null, material, holes)
		}
		pop_log()

	}

	let floors = house.floors
	let faces = cut_floor
		? house.make_faces(cut_floor, true, no_external_walls)
		: house.make_faces(floors[floors.length-1], false)
	let t0 = profile_time()
	create_plan(faces)
	for (let floor of floors) {
		if (cut_floor && floor.i > cut_floor.i)
			break
		for (let object of floor.objects) {
			let create_model = object_models[object.type]
			if (!create_model)
				continue
			let c = create_model(e, floor, object)
			let z = floor.z + house.slab_thickness
			let [x, y] = house.get_object_origin(floor, object, v2())
			let transform = mat4().translate(x, z, y)
				.rotate(v3.y_axis, -object.rot * PI / 180)
			e.root.comp.add_child(c, transform)
		}
	}
	profile_time('model.create', t0)
	e.update_all()
}

ui.saved_value_def('house_model_fov', 60, ui.create_field({
	type: 'number',
	min: 20,
	max: 120,
	decimals: 0,
}))

let model_editor_opt = {}

let model_mode_field = ui.create_field({
	type: 'enum',
	enum_values: ['full', 'cut', 'no_external_walls'],
	enum_labels: {
		full: S('house_model_full', 'Full'),
		cut: S('house_model_cut', 'Up to current floor'),
		no_external_walls: S('house_model_no_external_walls',
			'No external walls'),
	},
})

// height controls ----------------------------------------------------------

const HEIGHT_CONTROLS_ID = ui.BOX_ARGS
const CMD_HEIGHT_CONTROLS = ui.box_widget('house_height_controls', {
	ID: HEIGHT_CONTROLS_ID,
	draw: function(a, i) {
		ui.local_state(a[i+HEIGHT_CONTROLS_ID], 'e')?.draw(a, i)
	},
	hit: function(a, i) {
		if (!ui.hit_box(a, i))
			return
		let controls = a[i+HEIGHT_CONTROLS_ID+1]
		let mx = ui.mx - a[i+0]
		let my = ui.my - a[i+1]
		let hit_i
		let distance = 10 ** 2
		for (let i = 1; i < controls.length; i++) {
			let p = controls[i]
			if (!p.visible)
				continue
			let dx = mx - p[0]
			let dy = my - p[1]
			let d = dx*dx + dy*dy
			if (d < distance) {
				distance = d
				hit_i = i
			}
		}
		if (hit_i) {
			let hs = ui.set_hit(a[i+HEIGHT_CONTROLS_ID])
			hs.control_i = hit_i
			return true
		}
	},
})

function create_height_controls(id) {
	let e = {}
	let changed = false
	let house, editor_id, cut_floor, readonly
	let controls = []
	let axis = line3()
	let point = v3()
	let edit, drag_z0
	let roof_h = 0
	let roof_edit_no
	let x, y

	function cancel_edit() {
		if (edit) {
			edit.cancel()
			edit = null
			changed = true
		}
	}
	ui.on_free(id, cancel_edit)

	e.update = function() {
		ui.state(id)
		changed = false
		if (readonly) {
			cancel_edit()
			return
		}
		if (ui.hit_enter(id))
			ui.focus(id)
		let cs = ui.drag(id)
		if (!cs && (ui.focused(id) || ui.focused(editor_id))) {
			let redo = ui.keydown('ctrl shift z') || ui.keydown('ctrl y')
			let undo = ui.keydown('ctrl z')
			if (redo || undo) {
				changed = (redo ? house.redo() : house.undo()) != null
				ui.capture_keys()
			}
		}
		if (cs) {
			if (cs.cancel) {
				cancel_edit()
			} else {
				let editor = ui.state_of(editor_id, 'e')
				if (cs.drag) {
					ui.focus(id)
					let p = editor.screen_to_axis(ui.mx0-x, ui.my0-y,
						axis, point)
					drag_z0 = p?.[1]
				}
				if (cs.moved && drag_z0 != null) {
					let p = editor.screen_to_axis(ui.mx-x, ui.my-y,
						axis, point)
					if (p) {
						let floors = house.floors
						let is_roof = cs.control_i > floors.length
						let floor = floors[is_roof ? floors.length-1
							: cs.control_i-1]
						edit ??= floor.start_move_height(is_roof)
						if (edit) {
							changed = edit.move(p[1] - drag_z0)
						}
					}
				}
				if (cs.drop && edit) {
					edit.stop()
					edit = null
				}
			}
		}
		if (ui.captured_or_hit(id))
			ui.set_cursor('ns-resize')
	}

	e.build = function(id, house1, editor_id1, cut_floor1, readonly1) {
		if (house != house1 || cut_floor != cut_floor1) {
			cancel_edit()
			roof_edit_no = null
		}
		if (readonly1)
			cancel_edit()
		house = house1
		editor_id = editor_id1
		cut_floor = cut_floor1
		readonly = readonly1
		let floors = house.floors
		let top_floor = floors[floors.length-1]
		if (roof_edit_no != house.edit_no
			|| changed && ui.captured(id)?.control_i > floors.length
		) {
			roof_h = cut_floor ? 0 : top_floor.roof_height()
			roof_edit_no = house.edit_no
		}
		let ax = house.bb[0] - 1000
		let az = house.bb[3] + 1000
		if (!ui.captured(id)) {
			axis[0].set(ax, 0, az)
			axis[1].set(ax, max(house.h + roof_h, 1), az)
		}

		if (!readonly)
			ui.focusable(id)
		let box_i = ui.cmd_box(CMD_HEIGHT_CONTROLS, 1, 's', 's', id, controls)
		if (readonly)
			ui.nohit(box_i)
		return changed
	}

	e.draw = function(a, i) {
		let editor = ui.local_state(editor_id, 'e')
		if (!editor)
			return
		x = a[i+0]
		y = a[i+1]
		let cx = ui.cx
		cx.save()
		cx.beginPath()
		cx.rect(x, y, a[i+2], a[i+3])
		cx.clip()
		cx.translate(x, y)
		cx.font = 'bold 14px sans-serif'
		cx.textAlign = 'left'
		cx.textBaseline = 'middle'
		cx.strokeStyle = ui.color_css('text')
		cx.fillStyle = ui.color_css('text')
		cx.lineWidth = 2
		let prev
		let hs = ui.captured(id) || ui.hovers(id)
		let floors = house.floors
		let floor_n = cut_floor ? cut_floor.i+1 : floors.length
		controls.length = floor_n + 1 + (roof_h > 0 ? 1 : 0)
		for (let i = 0; i < controls.length; i++) {
			let is_roof = i > floor_n
			let floor = floors[is_roof ? floor_n-1 : max(0, i-1)]
			let z = is_roof ? house.h + roof_h : i ? floor.z + floor.h : 0
			let p = controls[i] ??= v3()
			point.set(axis[0][0], z, axis[0][2])
			p.visible = !!editor.world_to_screen(point, p)
			if (!p.visible) {
				prev = null
				continue
			}
			let [px, py] = p
			if (prev) {
				cx.beginPath()
				cx.moveTo(prev[0], prev[1])
				cx.lineTo(px, py)
				cx.stroke()
				let text = (is_roof ? 'Roof ' : '')
					+ format_kcount((is_roof ? roof_h : floor.h) / 1000, 2)+'m'
				cx.fillText(text, (px + prev[0])/2 + 12,
					(py + prev[1])/2)
			}
			cx.beginPath()
			cx.arc(px, py, z > 0 && hs?.control_i == i
				? 6 : 4, 0, 2*PI)
			cx.fill()
			prev = p
		}
		cx.restore()
	}

	return e
}

let height_controls = ui.stateful_widget(create_height_controls)

// ui.house_model_editor (id, house, floor=, fr=1, align='s', valign='s',
//                       readonly=)
// floor: the current floor, which the user can choose to cut the model at.
ui.house_model_editor = function(id, house, floor, fr, align, valign,
	readonly
) {
	let mode_id = id+'.model_mode'
	// read before the toggle builds: its update gives this frame's click.
	let model_mode = ui.value(mode_id)
		?? ui.saved_state[id]?.model_mode ?? 'cut'
	if (ui.interaction_value(mode_id) !== undefined)
		ui.save_state(id, 'model_mode', model_mode)
	let cut_floor = floor && model_mode != 'full' ? floor : null
	let no_external_walls = !!cut_floor && model_mode == 'no_external_walls'
	let controls_id = id+'.heights'
	ui.state_of(controls_id)
	let e = ui.state_of(id, 'e')
	let init = null
	if (!e) {
		init = function(e1) {
			init_house_model_editor(e1, house, cut_floor, no_external_walls)
			// the house is in mm, the editor's default camera is for 1-unit models.
			e1.set_camera_pos(v3(-3000, 6000, 9000))
			e1.set_camera_dir(v3(-6, 4.4, 7))
		}
	}
	model_editor_opt.fov = ui.saved_value('house_model_fov') ?? undefined
	ui.stack('', fr, align, valign)
		ui.model3_editor(id, model_editor_opt, init)
		let is_changed = height_controls(controls_id, house, id, cut_floor,
			readonly)
		if (e && (e.house != house || e.house_edit_no != house.edit_no
			|| is_changed || e.cut_floor != cut_floor
			|| e.no_external_walls != no_external_walls)) {
			e.clear_model()
			init_house_model_editor(e, house, cut_floor, no_external_walls)
		}
		ui.p(ui.sp())
		ui.stack()
			if (floor)
				ui.enum_toggle(mode_id, model_mode, model_mode_field, 0, 'l', 't')
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
