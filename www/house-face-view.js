(function () {
"use strict"
const G = window

// face view -----------------------------------------------------------------

let FACE_VIEW_ID         = ui.S-1
let FACE_VIEW_FACE       = ui.S+0
let FACE_VIEW_DRAW_STATE = ui.S+1

function draw_cycle(cx, sg, ps) {
	for (let p of ps) {
		let x = sg.x(p[0])
		let y = sg.y(p[1])
		if (p == ps[0])
			cx.moveTo(x, y)
		else
			cx.lineTo(x, y)
	}
	cx.closePath()
}

function draw_face_plane(cx, sg, plane, min_depth, max_depth) {
	for (let comp of plane.comps) {
		if (0) {
		for (let seg of comp.segs) {
			let [p1, p2] = seg
			let [x1, y1] = p1
			let [x2, y2] = p2
			cx.moveTo(sg.x(x1), sg.y(y1))
			cx.lineTo(sg.x(x2), sg.y(y2))
		}
		} else {
		cx.beginPath()
		for (let c of comp.cycles) {
			if (c.outer)
				continue
			draw_cycle(cx, sg, c)
		}
		cx.fillStyle = ui.hsl_adjust(ui.bg_color_hsl('bg3'), 1, 1, lerp(plane.depth, min_depth, max_depth, 0.5, 1))
		cx.fill()
		}
		cx.strokeStyle = ui.fg_color('text')
		cx.stroke()
	}
}

function draw_face_planes(cx, sg, planes, min_depth, max_depth) {
	for (let plane of planes)
		draw_face_plane(cx, sg, plane, min_depth, max_depth)
}

function face_view_scale_group(face_i) {
	return scale_group('face_view_'+(face_is_v(face_i) ? 'v' : 'h'))
}

ui.box_widget('face_view', {

	create: function(cmd, id, house, face_i, fr, align, valign, min_w, min_h) {

		let s = ui.state(id)
		let draw_state = s.get('draw_state')
		if (!draw_state) {
			draw_state = {snap_lines: [], measure_edges: []}
			s.set('draw_state', draw_state)
		}
		let face = house.faces[face_i]
		s.set('face', face)
		draw_state.planes = face.planes
		draw_state.min_depth = face.bb[4]
		draw_state.max_depth = face.bb[5]

		let [dstate, dx, dy] = ui.drag(id)

		let sg = face_view_scale_group(face_i)

		dx /= sg.scale
		dy /= sg.scale

		return ui.cmd_box(cmd, fr, align, valign, min_w, min_h,
				id, face_i, draw_state,
			)
	},

	after_position: function(a, i, axis)	{
		let w    = a[i+2]
		let h    = a[i+3]
		let id   = a[i+FACE_VIEW_ID]
		let face_i = a[i+FACE_VIEW_FACE]
		let sg = face_view_scale_group(face_i)
		if (!axis) {
			sg.set_scale(1/0)
		} else {
			let face = ui.state(id).get('face')
			sg.scale_to_fit(face.bb, w, h)
		}
	},

	after_translate: function(a, i) {
		let x00  = a[i+0]
		let y00  = a[i+1]
		let id   = a[i+FACE_VIEW_ID]
		let face_i = a[i+FACE_VIEW_FACE]
		let draw_state = a[i+FACE_VIEW_DRAW_STATE]

		let sg = face_view_scale_group(face_i)
		let face = ui.state(id).get('face')

		draw_state.x0 = sg.x0
		draw_state.y0 = sg.y0
		draw_state.scale = sg.scale
	},

	draw: function(a, i) {

		let x00  = a[i+0]
		let y00  = a[i+1]
		let w    = a[i+2]
		let h    = a[i+3]
		let id   = a[i+FACE_VIEW_ID]
		let face_i = a[i+FACE_VIEW_FACE]
		let draw_state = a[i+FACE_VIEW_DRAW_STATE]
		let x0 = draw_state.x0
		let y0 = draw_state.y0

		let hs = ui.hit(id)

		let sg = face_view_scale_group(face_i)
		sg.set_scale(draw_state.scale)

		let cx = ui.cx

		cx.beginPath()

		cx.save()

		cx.translate(x00, y00)

		cx.beginPath()
		cx.rect(0, 0, w, h)
		cx.clip()

		cx.save()

		// fixed grid
		sg.show_grid = true
		draw_grids(cx, sg, x0, y0, w, h)

		sg.transform(cx, w, h)

		//sg.transform(cx, w, h)

		draw_face_planes(cx, sg,
			draw_state.planes,
			draw_state.min_depth,
			draw_state.max_depth)

		cx.restore()

		let m = ui.sp()
		cx.fillStyle = ui.fg_color('text')
		cx.fillText(((['SOUTH','WEST','NORTH','EAST'])[face_i])+' FACE', m, m + 14)

		cx.restore()

	},

	hit: function(a, i) {

		let x00  = a[i+0]
		let y00  = a[i+1]
		let w    = a[i+2]
		let h    = a[i+3]
		let id   = a[i+FACE_VIEW_ID]
		let face_i = a[i+FACE_VIEW_FACE]

		return

	},

})

}()) // module function
