//// TEMPLATE ----------------------------------------------------------------

/*

	ui.template         (id, t, ...stack_args)  build a widget template
	ui.template_overlay (id, t, i0, i1) -> i    draw template editing controls

*/

let targs  = {}
let tprops = {}

targs.text  = function(t) { return [t.id, t.s, t.align, t.valign, t.fr] }
targs.h     = function(t) { return [t.fr, t.gap, t.align, t.valign] }
targs.v     = targs.h
targs.stack = function(t) { return [t.id, t.fr, t.align, t.valign] }
targs.bb    = function(t) { return [t.bg_color, t.sides, t.border_color, t.border_radius] }

tprops.text = {
	id     : {type: 'id'  , },
	s      : {type: 'text', },
	align  : {type: 'enum', enum_values: 's c l r', default: 'l'},
	valign : {type: 'enum', enum_values: 's c t b', default: 'c'},
	fr     : {type: 'fr'  , },
}

tprops.h = {
	fr     : {type: 'fr'  , },
	gap    : {type: 'size', },
	align  : {type: 'enum', enum_values: 's c l r', default: 's'},
	valign : {type: 'enum', enum_values: 's c t b', default: 's'},
	min_w  : {type: 'size', default: 0},
	min_h  : {type: 'size', default: 0},
}
tprops.v = tprops.h

tprops.stack = {
	id     : {type: 'id'  , },
	fr     : {type: 'fr'  , },
	align  : {type: 'enum', enum_values: 's c l r', default: 's'},
	valign : {type: 'enum', enum_values: 's c t b', default: 's'},
	min_w  : {type: 'size', default: 0},
	min_h  : {type: 'size', default: 0},
}

tprops.bb = {
	bg_color      : {type: 'color', },
	sides         : {type: 'enum' , enum_values: 't r b l tb rl tr rb lt bl -l -b -r -t all', default: 'all'},
	border_color  : {type: 'color', },
	border_radius : {type: 'size' , default: 0},
}

let hit_template_id
let hit_template_i0
let hit_template_i1
let selected_template_id
let selected_template_root_t
let selected_template_node_t

function hit_frame_template_reset() {
	hit_template_id = null
	hit_template_i0 = null
	hit_template_i1 = null
}

function template_select_node(id, root_t, node_t, node_i) {
	selected_template_id = id
	selected_template_root_t = root_t
	selected_template_node_t = node_t
	ui.rebuild('select_node')
}

function template_find_node(a, i, t, t_i) {
	if (i == t_i)
		return t
	if (t.e) {
		let ch_t_i = cmd_next_i(a, t_i)
		for (let ch_t of t.e) {
			let found_t = template_find_node(a, i, ch_t, ch_t_i)
			if (found_t)
				return found_t
			ch_t_i = cmd_next_sibling_i(a, ch_t_i)
		}
	}
}
function hit_template(a, i) {
	let id = hit_template_id
	if (id && i >= hit_template_i0 && i < hit_template_i1) {
		let hs = hovers(id)
		if (!hs)
			return
		let root_t = hs.root
		let node_t = template_find_node(a, i, root_t, hit_template_i0)
		hs.node = node_t
		if (ui.click)
			template_select_node(id, root_t, node_t)
		return true
	}
}

function template_add(t) {
	let cmd = cmd_name_map[t.t]
	let targs_f = assert(targs[t.t], 'unknown type ', t.t)
	let args = targs_f(t)
	t.i = n + 2
	ui.min_wh(t.min_w, t.min_h)
	ui[t.t](...args)
	if (t.e)
		for (let ch_t of t.e)
			template_add(ch_t, 0)
	if (cmd & 1) // container
		ui.end()
}

function template_drag_point(id, ch_t, ct_i, ha, va) {
	ui.popup('', 'overlay', ct_i, ha, va)
		ui.drag_point(id+'.'+ha+va, 0, 0, 'red')
	ui.end_popup()
}

ui.template = function(id, t, ...stack_args) {
	ui.stack('', ...stack_args)
	let i0 = n+2 // index of first cmd's arg#1
	template_add(t)
	let i1 = n+2 // index of next cmd's arg#1
	ui.template_overlay(id, t, i0, i1)
	let ch_t = selected_template_node_t
	let ch_i = ch_t && ch_t.i
	let ct_i = ch_i
	if (t == selected_template_root_t) {
		template_drag_point(id, ch_t, ct_i, 'l', '[')
		template_drag_point(id, ch_t, ct_i, 'l', 'c')
		template_drag_point(id, ch_t, ct_i, 'l', ']')
		template_drag_point(id, ch_t, ct_i, 'r', '[')
		template_drag_point(id, ch_t, ct_i, 'r', 'c')
		template_drag_point(id, ch_t, ct_i, 'r', ']')
		template_editor(id, t, ch_t)
	}
	ui.end_stack()
}

ui.box_widget('template_overlay', {
	create: function(cmd, id, t, i0, i1) {
		let i = ui_cmd_box_begin(cmd, 1, 's', 's')
		a[n++] = id
		a[n++] = t
		a[n++] = i0
		a[n++] = i1
		ui_cmd_box_end(i)
		return i
	},
	hit: function(a, i) {
		let id = a[i+BOX_ARGS+0]
		let t  = a[i+BOX_ARGS+1]
		let i0 = a[i+BOX_ARGS+2]
		let i1 = a[i+BOX_ARGS+3]
		if (hit_box(a, i)) {
			hit_template_id = id
			hit_template_i0 = i0
			hit_template_i1 = i1
			set_hit(id).root = t
		}
	},
	draw: function(a, i) {
		let id = a[i+BOX_ARGS+0]
		let sel_id = selected_template_id
		if (sel_id && sel_id == id) {
			let t = selected_template_node_t
			let i = t.i
			if (a[i-1] == CMD_BB)
				i = i+a[i+BB_CT_I]
			let x = a[i+0]
			let y = a[i+1]
			let w = a[i+2]
			let h = a[i+3]
			cx.strokeStyle = 'magenta'
			cx.beginPath()
			cx.rect(
				x + .5,
				y + .5,
				w - .5,
				h - .5,
			)
			cx.stroke()
		}
	},
})

function draw_node(id, t_t, t, depth) {
	ui.p(depth * 20, ui.sp05(), 0)
	ui.stack(t)
		let hs = hit(t)
		if (hs && ui.click)
			template_select_node(id, t_t, t)
		let sel = t == selected_template_node_t
		if (sel) {
			ui.bb('item',
				ui.focused(id)
					? 'item-focused item-selected focused'
					: 'item-focused item-selected'
			)
		}
		ui.color('text', hs ? 'hover' : null)
		ui.text('', t.t, 1, 'l')
	ui.end_stack()
	if (t.e)
		for (let ct of t.e)
			draw_node(id, t_t, ct, depth+1)
}
function template_editor(id, t, ch_t) {

	ui.begin_toolboxes('template_editor_toolboxes')

	ui.toolbox(id+'.tree_toolbox', 'Tree', ']', 't', 100, 100)
		ui.min_wh(150, 200)
		ui.scrollbox(id+'.tree_toolbox_sb')
			ui.p(10)
			ui.v(1, 0, 's', 't')
				draw_node(id, t, t, 0)
			ui.end_v()
		ui.end_scrollbox()
	ui.end_toolbox()

	ui.toolbox(id+'.prop_toolbox', 'Props', ']', 't', 100, 400)
		ui.min_wh(150, 200)
		ui.scrollbox(id+'.prop_toolbox_sb')
			ui.v(1, 0, 's', 't')
			let defs = tprops[ch_t.t]
			for (let k in defs) {
				let def = defs[k]
				let v = ch_t[k]
				ui.h()
					ui.border('b', 'light')
					let vs = str((v != null ? v : def.default) ?? '')
					ui.mb(1)
					ui.p(8, 5)
					ui.text('', k , 1, 'l', 'c', 20)
					ui.mb(1)
					ui.p(8, 5)
					ui.stack()
						if (def.type == 'color') {
							ui.bb(v, null, 'l', 'light')
						} else {
							ui.border('l', 'light')
							ui.color(v != null ? 'text' : 'label')
							ui.text('', vs, 1, 'l', 'c', 20)
						}
					ui.end_stack()
				ui.end_h()
			}
			ui.end_v()
		ui.end_scrollbox()
	ui.end_toolbox()

	ui.end_toolboxes()
}

