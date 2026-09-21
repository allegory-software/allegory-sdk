//// COLOR PICKER ------------------------------------------------------------

/// sat-lum square -----------------------------------------------------------

function draw_cross(x0, y0, w, h, hue, sat, lum, alpha) {
	if (sat == null) return
	let x = round(x0 + lerp(sat, 0, 1, 0, w-1)) + .5
	let y = round(y0 + lerp(lum, 1, 0, 0, h-1)) + .5
	let d = 10.5
	cx.strokeStyle = hsl(360-hue, sat, lum > .5 ? 0 : 1, alpha)
	cx.beginPath()
	cx.moveTo(x, y); cx.lineTo(x+d, y)
	cx.moveTo(x, y); cx.lineTo(x-d, y)
	cx.moveTo(x, y); cx.lineTo(x, y+d)
	cx.moveTo(x, y); cx.lineTo(x, y-d)
	cx.stroke()
}

let SAT_LUM_ID      = BOX_ARGS+0
let SAT_LUM_HUE     = BOX_ARGS+1
let SAT_LUM_HIT_SAT = BOX_ARGS+2
let SAT_LUM_HIT_LUM = BOX_ARGS+3
let SAT_LUM_SEL_SAT = BOX_ARGS+4
let SAT_LUM_SEL_LUM = BOX_ARGS+5

function sat_lum_update(id, s) {

	let cs = ui.drag(id)
	if (cs) {
		if (cs.drag)
			ui.focus(id)
		if (cs.dragging) {
			s.sat = clamp(cs.sat + cs.dx / (cs.w - 1), 0, 1)
			s.lum = clamp(cs.lum - cs.dy / (cs.h - 1), 0, 1)
		}
	}

	if (ui.focused(id)) {
		let lum_step = ui.keydown('arrowup'   ) && 1 || ui.keydown('arrowdown') && -1
		let sat_step = ui.keydown('arrowright') && 1 || ui.keydown('arrowleft') && -1
		if (lum_step)
			s.lum = clamp(s.lum + (ui.keypressed('shift') ? 0.1 : 1) * 0.1 * lum_step, 0, 1)
		if (sat_step)
			s.sat = clamp(s.sat + (ui.keypressed('shift') ? 0.1 : 1) * 0.1 * sat_step, 0, 1)
	}
}

ui.box_widget('sat_lum_square', {

	ID: SAT_LUM_ID,

	create: function(cmd, id, hue, sat, lum) {

		ui.focusable(id)

		let fr     = fr0     ?? 1
		let align  = align0  ?? 's'
		let valign = valign0 ?? 's'
		let min_w  = min_w0  ?? 0
		let min_h  = min_h0  ?? 0
		ui.clear_box_args()

		hue = hue ?? 0
		sat = sat ?? .5
		lum = lum ?? .5

		let s = ui.state(id)
		s.sat = sat
		s.lum = lum
		ui.state(id, sat_lum_update)

		ui.stack('', fr, align, valign, min_w, min_h)
			let i = ui_cmd_box(cmd, null, null, null, 0, 0,
				id,
				hue,
				hit(id, 'sat'),
				hit(id, 'lum'),
				ui.state_of(id, 'sat'),
				ui.state_of(id, 'lum'))
			if (ui.focused(id))
				ui.focus_ring()
		ui.end_stack()
		return i
	},

	draw: function(a, i) {

		let id      = a[i+SAT_LUM_ID]
		let hue     = a[i+SAT_LUM_HUE]
		let hit_sat = a[i+SAT_LUM_HIT_SAT]
		let hit_lum = a[i+SAT_LUM_HIT_LUM]
		let sel_sat = a[i+SAT_LUM_SEL_SAT]
		let sel_lum = a[i+SAT_LUM_SEL_LUM]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let idata = ui.image_data(id, 'square', w, h)

		if (idata.hue != hue) {
			let d = idata.data
			let w = idata.width
			let h = idata.height
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					let sat = lerp(x, 0, w-1, 0, 1)
					let lum = lerp(y, 0, h-1, 1, 0)
					hsl_to_rgb_out(d, (y * w + x) * 4, hue, sat, lum)
				}
			}
			idata.hue = hue
		}

		cx.putImageData(idata, x, y)

		draw_cross(x, y, w, h, hue, hit_sat, hit_lum, 0.3)
		draw_cross(x, y, w, h, hue, sel_sat, sel_lum, 1.0)

	},

	hit: function(a, i) {

		let id = a[i+SAT_LUM_ID]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let hs = hit_rect(x, y, w, h) && set_hit(id)
		if (hs) {
			hs.sat = clamp(lerp(ui.mx - x, 0, w-1, 0, 1), 0, 1)
			hs.lum = clamp(lerp(ui.my - y, h-1, 0, 0, 1), 0, 1)
			hs.w = w
			hs.h = h
		}

		return !!hs
	},

})

/// hue bar ------------------------------------------------------------------

function draw_hue_line(x, y, h, w, hue, alpha) {
	if (hue == null) return
	cx.strokeStyle = hsl(0, 0, 0, alpha)
	cx.beginPath()
	let hue_y = round(lerp(hue, 0, 360, 0, h-1))
	cx.moveTo(x    , y + hue_y + .5)
	cx.lineTo(x + w, y + hue_y + .5)
	cx.stroke()
}

let HUE_BAR_ID      = BOX_ARGS+0
let HUE_BAR_HIT_HUE = BOX_ARGS+1
let HUE_BAR_SEL_HUE = BOX_ARGS+2

function hue_bar_update(id, s) {

	let cs = ui.drag(id)
	if (cs) {
		if (cs.drag)
			ui.focus(id)
		if (cs.dragging)
			s.hue = round(clamp(cs.hue + cs.dy / (cs.h - 1) * 360, 0, 360))
	}

	if (ui.focused(id)) {
		let step = ui.keydown('arrowup') && -1 || ui.keydown('arrowdown') && 1
		if (step)
			s.hue = clamp(round(s.hue
				+ (ui.keypressed('shift') ? 1 : 10) * step), 0, 360)
	}
}

ui.box_widget('hue_bar', {

	ID: HUE_BAR_ID,

	create: function(cmd, id, hue) {

		ui.focusable(id)
		ui.state(id).hue = hue
		ui.state(id, hue_bar_update)

		let fr     = fr0     ?? 0
		let align  = align0  ?? 's'
		let valign = valign0 ?? 's'
		let min_w  = min_w0  ?? ui.em(1.5)
		let min_h  = min_h0  ?? 0
		ui.clear_box_args()

		ui.stack('', fr, align, valign, min_w, min_h)
			let i = ui_cmd_box(cmd, null, null, null, 0, 0,
				id,
				hit(id, 'hue'),
				ui.state_of(id, 'hue'))
			if (ui.focused(id))
				ui.focus_ring()
		ui.end_stack()
		return i
	},

	draw: function(a, i) {

		let id      = a[i+HUE_BAR_ID]
		let hit_hue = a[i+HUE_BAR_HIT_HUE]
		let sel_hue = a[i+HUE_BAR_SEL_HUE]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let idata = ui.image_data(id, 'bar', w, h)

		if (!idata.ready) {
			let d = idata.data
			let w = idata.width
			let h = idata.height
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					let hue = lerp(y, 0, h-1, 0, 360)
					hsl_to_rgb_out(d, (y * w + x) * 4, hue, 1, .5)
				}
			}
			idata.ready = true
		}

		cx.putImageData(idata, x, y)

		draw_hue_line(x, y, h, w, hit_hue, 0.3)
		draw_hue_line(x, y, h, w, sel_hue, 1.0)

	},

	hit: function(a, i) {

		let id = a[i+HUE_BAR_ID]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let hs = hit_rect(x, y, w, h) && set_hit(id)
		if (hs) {
			let hue = round(clamp(lerp(ui.my - y, 0, h - 1, 0, 360), 0, 360))
			hs.hue = hue
			hs.h = h
			return true
		}
	},

})

/// color picker -------------------------------------------------------------

let HEX_RE = /^#[0-9a-f]{6}$/i
let HSL_RE = /^\s*([\d.]+)\s*\u00B0?\s*,\s*([\d.]+)\s*%?\s*,\s*([\d.]+)\s*%?\s*$/

function hsl_to_text(hue, sat, lum) {
	return dec(hue)+'\u00B0, '+dec(sat*100)+'%, '+dec(lum*100)+'%'
}

function set_picker_color(s, hue, sat, lum) {
	s.hue = hue
	s.sat = sat
	s.lum = lum
	s.hex = hsl_to_rgb_hex(hue, sat, lum)
}

function set_picker_input_texts(s) {
	s.hsl_text = hsl_to_text(s.hue, s.sat, s.lum)
	s.hex_text = s.hex
}

function color_picker_update(id, s) {

	let hue0 = s.hue
	let sat0 = s.sat
	let lum0 = s.lum
	let hsl_text0 = s.hsl_text
	let hex_text0 = s.hex_text

	let hsl_text = ui.value(id+'.input_hsl')
	if (hsl_text !== undefined && hsl_text !== hsl_text0) {
		s.hsl_text = hsl_text
		let m = hsl_text?.match(HSL_RE)
		if (m) {
			set_picker_color(s,
				clamp(num(m[1])      , 0, 360),
				clamp(num(m[2]) / 100, 0, 1),
				clamp(num(m[3]) / 100, 0, 1))
			s.hex_text = s.hex
		}
	}

	let hex_text = ui.value(id+'.input_hex')
	if (hex_text !== undefined && hex_text !== hex_text0) {
		s.hex_text = hex_text
		if (hex_text != null && HEX_RE.test(hex_text)) {
			let [hue, sat, lum] = hex_to_hsl(hex_text)
			set_picker_color(s, hue, sat, lum)
			s.hsl_text = hsl_to_text(hue, sat, lum)
		}
	}

	let hb = ui.state_of(id+'.hb')
	if (hb && hb.hue != hue0) {
		set_picker_color(s, hb.hue, s.sat, s.lum)
		set_picker_input_texts(s)
	}

	let sl = ui.state_of(id+'.sl')
	if (sl && (sl.sat != sat0 || sl.lum != lum0)) {
		set_picker_color(s, s.hue, sl.sat, sl.lum)
		set_picker_input_texts(s)
	}
}

ui.color_picker = function(id, hex) {
	let s = ui.state(id)
	if (hex !== s.hex) {
		let [hue, sat, lum] = hex_to_hsl(HEX_RE.test(hex) ? hex : '#808080')
		s.hue = hue
		s.sat = sat
		s.lum = lum
		s.hex = hex
		s.hsl_text = hsl_to_text(hue, sat, lum)
		s.hex_text = hex
	}
	ui.state(id, color_picker_update)
	ui.v(1, ui.sp())
		ui.h(0, ui.sp05())
			ui.aspect_box(1, 1, 's', 't')
				ui.bb(':'+hsl(s.hue, s.sat, s.lum))
			ui.end_aspect_box()
			ui.aspect_box(1, 1, 's', 't')
				ui.sat_lum_square(id+'.sl', s.hue, s.sat, s.lum)
			ui.end_aspect_box()
			ui.hue_bar(id+'.hb', s.hue)
			ui.end_h()
			ui.h(0, ui.sp(), 's')
				let hsl_id = id+'.input_hsl'
				ui.label(hsl_id, 'HSL', .5)
				ui.input(hsl_id, s.hsl_text, 1)
			ui.end_h()
			ui.h(0, ui.sp(), 's')
				let hex_id = id+'.input_hex'
				ui.label(hex_id, 'HEX', .5)
				ui.input(hex_id, s.hex_text, 1)
		ui.end_h()
	ui.end_v()
	return s.hex
}

//// COLOR INPUT -------------------------------------------------------------

function color_input_hex(id, s, v) {
	if (s.opened)
		s.hex_before_open = v // use caller value before open for cancel
	let picker_hex = ui.state_of(id+'.picker', 'hex')
	let hex = v // use caller value
	if (s.open) {
		if (v != s.prev_hex)
			s.hex_before_open = v // use new caller value for cancel
		else if (picker_hex != null)
			hex = picker_hex // use picker value
	} else if (s.closed) {
		hex = s.picked ? picker_hex ?? v : s.hex_before_open
	}

	if (ui.focused(id) && ui.keydown('delete'))
		hex = null

	s.value = hex
	return hex
}

function color_input_update(id, s) {
	ui.dropdown_update(id, s)
	color_input_hex(id, s, s.v)
}

ui.color_input = function(id, v, fr, min_w, min_h, bg, bg_state) {

	let picker_id = id+'.picker'

	let s = ui.state(id)
	s.v = v

	ui.stack('', fr, 's', 's', min_w ?? ui.em_input(), min_h ?? ui.em(1.5))

	ui.focusable(id)
	let open = ui.dropdown(id, 'b', null, color_input_update)
	if (!open && ui.focus_inside(picker_id))
		ui.focus(id)

	let hex = color_input_hex(id, s, v)
	s.prev_hex = hex

		if (bg !== false)
			ui.bb(bg ?? 'input',
				bg ? bg_state : ui.focused(id) ? 'focused' : null,
				1, 'intense', ui.focused(id) ? 'hover' : null)
		ui.m(ui.sp(), ui.sp())
		ui.stack('', 1, 's', 'c', null, ui.em(1))
			if (hex != null)
				ui.bb(':'+hex)
		ui.end_stack()

	ui.dropdown_picker()

		if (open) {
			ui.p(ui.sp2())
			ui.v(0, ui.sp1())
				ui.color_picker(picker_id, hex)
				ui.h(0, ui.sp05(), 'r')
					ui.default_button(id+'.pick')
					ui.primary_button(id+'.pick', S('pick', 'Pick'), 0)
					ui.button(id+'.cancel', S('cancel', 'Cancel'), 0)
				ui.end_h()
			ui.end_v()
			ui.resizer(id+'.resizer', ui.em(22), null, 'x')
		}

	ui.end_dropdown()

	ui.end_stack()

	return hex
}
