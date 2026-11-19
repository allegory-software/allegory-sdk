(function () {
'use strict'

let sample
let plan_text
let plan_value
let show_editors = false
let gl
let house0
let viewed_house

function add_time(stage, ms) {
	if (!sample)
		return
	sample.times[stage] = (sample.times[stage] ?? 0) + ms
	sample.calls[stage] = (sample.calls[stage] ?? 0) + 1
}

function reset_profile_times() {
	for (let stage in glue.profile_times) {
		let times = glue.profile_times[stage]
		times.ms = 0
		times.calls = 0
	}
}

function copy_profile_times(result, prefix = '') {
	for (let stage in glue.profile_times) {
		let times = glue.profile_times[stage]
		if (times.calls) {
			result.times[prefix + stage] = times.ms
			result.calls[prefix + stage] = times.calls
		}
	}
}

function floor_counts(floor) {
	let cycles = 0, rooms = 0, offset_points = 0
	for (let comp of floor.comps) {
		for (let c of comp.cycles) {
			cycles++
			if (!c.outer)
				rooms++
			offset_points += c.edges.length
		}
	}
	return {points: floor.ps.length, walls: floor.segs.length,
		components: floor.comps.length, cycles, rooms, offset_points}
}

window.DEBUG = true
ui.DEBUG_WINDOW = false

// Frame timings before the frame graph rounds them.
let frame_graph_names = ['frame_time', 'frame_hit_time', 'frame_make_time',
	'frame_layout_time', 'frame_draw_time']
for (let name of frame_graph_names) {
	let graph = ui.frame_graphs[name]
	let push = graph.push
	graph.push = function(ms) {
		add_time(name, ms)
		push.call(this, ms)
	}
}

// WebGL calls: CPU time and supplied bytes, including allocation-only calls.
let get_context = HTMLCanvasElement.prototype.getContext
HTMLCanvasElement.prototype.getContext = function(type, ...args) {
	let context = get_context.call(this, type, ...args)
	if (type == 'webgl2' && context)
		gl = context
	return context
}

for (let name of ['bufferData', 'bufferSubData']) {
	let call = WebGL2RenderingContext.prototype[name]
	WebGL2RenderingContext.prototype[name] = function(...args) {
		if (!sample)
			return call.apply(this, args)
		let t = performance.now()
		let result = call.apply(this, args)
		add_time('webgl.upload', performance.now() - t)
		let data_i = name == 'bufferData' ? 1 : 2
		let data = args[data_i]
		if (typeof data == 'number') {
			sample.allocated_bytes += data
		} else if (data) {
			let offset = args[3] ?? 0
			let length = args[4]
			let element_bytes = data.BYTES_PER_ELEMENT ?? 1
			let bytes = length ? length * element_bytes
				: data.byteLength - offset * element_bytes
			sample.uploaded_bytes += bytes
		}
		return result
	}
}

ui.main = function() {
	if (!show_editors)
		return
	ui.h()
		ui.floor_editor('plan', plan_value)
		let house = ui.state_of('plan', 'house')
		if (house) {
			ui.house_model_editor('model', house)
			if (viewed_house != house) {
				let e = ui.state_of('model', 'e')
				let bb = e.root.comp.bbox()
				if (!bb.is_empty()) {
					let center = bb.center(Math3D.v3())
					let radius = bb.delta(Math3D.v3()).len() / 2
					let dir = Math3D.v3(-1, .8, 1.2)
						.set_len(Math.max(1, radius * 3))
					e.set_camera_dir(dir)
					e.set_camera_pos(center.add(dir))
				}
				viewed_house = house
			}
		}
	ui.end_h()
}

function frame() {
	return new Promise(resolve => {
		ui.frame_changed = resolve
		ui.animate()
	})
}

window.house_plan_bench = {
	async load(text) {
		plan_text = text
		DEBUG_LOG = false
		DEBUG_PLAN_LOAD = 0
		DEBUG_MODEL3 = 0
		// Wait for the initial empty frame before starting the first sample.
		await frame()
	},
	async run(reload) {
		reset_profile_times()
		let result = {
			times: {},
			calls: {},
			allocated_bytes: 0,
			uploaded_bytes: 0,
		}
		sample = result
		let t = performance.now()
		try {
			if (reload) {
				let parse_t = performance.now()
				plan_value = JSON.parse(plan_text)
				add_time('plan.parse', performance.now() - parse_t)
			}
			show_editors = true
			await frame()
			let house = ui.state_of('plan', 'house')
			if (!house || !gl)
				throw Error('The plan or WebGL model was not built')
			if (reload && house == house0)
				throw Error('The plan was not reloaded')
			if (!reload && house != house0)
				throw Error('An unchanged frame reloaded the plan')
			house0 = house
			let gpu_t = performance.now()
			gl.finish()
			add_time('gpu.wait', performance.now() - gpu_t)
			add_time('total.wall', performance.now() - t)
			copy_profile_times(result)
			return result
		} finally {
			sample = null
			ui.frame_changed = glue.noop
		}
	},
	run_wall() {
		let house = house_plan(JSON.parse(plan_text))
		let floor = house.floors[0]
		let seg
		for (let s of floor.segs)
			if (!seg || s.m2 - s.m1 > seg.m2 - seg.m1)
				seg = s
		if (!seg)
			throw Error('Wall-update samples need a wall on floor zero')
		let is_v = seg.is_v
		let axis0 = seg.axis
		let result = {
			times: {}, calls: {},
			wall: {floor: floor.i, id: seg.id,
				from: [seg[0][0], seg[0][1]], to: [seg[1][0], seg[1][1]]},
			before: floor_counts(floor),
		}
		let edit = floor.start_move_seg(seg)
		reset_profile_times()
		sample = result
		try {
			let t = performance.now()
			edit.move(is_v ? 10 : 0, is_v ? 0 : 10, 0)
			add_time('wall.drag', performance.now() - t)
			copy_profile_times(result, 'drag.')
			result.wall.displacement = seg.axis - axis0
			if (!result.wall.displacement)
				throw Error('The longest wall did not move')
			result.after_drag = floor_counts(floor)

			reset_profile_times()
			t = performance.now()
			floor.fix()
			add_time('wall.refresh', performance.now() - t)
			copy_profile_times(result, 'refresh.')
			result.after_refresh = floor_counts(floor)

			reset_profile_times()
			t = performance.now()
			let area_sum = 0, rooms = 0
			for (let f of house.floors) {
				for (let comp of f.comps) {
					for (let c of comp.cycles) {
						if (c.outer)
							continue
						c.center()
						area_sum += c.edges.area()
						for (let island of c.islands)
							area_sum += island.outer_cycle.edges.area()
						rooms++
					}
				}
			}
			add_time('wall.room_areas', performance.now() - t)
			result.room_count = rooms
			result.room_area_sum = area_sum
			t = performance.now()
			let areas = 0
			for (let f of house.floors)
				areas += f.make_areas().length
			add_time('wall.roof_areas', performance.now() - t)
			copy_profile_times(result, 'areas.')
			result.area_count = areas
			add_time('wall.total', result.times['wall.drag']
				+ result.times['wall.refresh'] + result.times['wall.room_areas']
				+ result.times['wall.roof_areas'])
			return result
		} finally {
			sample = null
		}
	},
	info() {
		let ext = gl.getExtension('WEBGL_debug_renderer_info')
		let house = ui.state_of('plan', 'house')
		let walls = 0, openings = 0
		for (let floor of house.floors) {
			walls += floor.segs.length
			for (let object of floor.objects)
				if (house.object_types[object.type].in_wall)
					openings++
		}
		return {
			renderer: gl.getParameter(ext
				? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
			vendor: gl.getParameter(ext
				? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
			floors: house.floors.length, walls, openings,
			viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
		}
	},
}
}())
