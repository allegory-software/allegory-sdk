// run: node tests/house_plan_test.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sdk = path.resolve(__dirname, '..')
const pressed_keys = new Set()
const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
	ui: {keypressed: k => pressed_keys.has(k)},
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
let files = ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'house_plan.js']
for (let name of files) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

function house(t) {
	return ctx.house_plan(t)
}

function floor(lines) {
	return house({floors: [{lines}]}).floors[0]
}

function draw_state() {
	return {snap_lines: [], measure_edges: []}
}

let n_checks = 0
function check(name, f) {
	pressed_keys.clear()
	try {
		f()
		n_checks++
	} catch (e) {
		console.error(name)
		throw e
	}
}

// resize origins -----------------------------------------------------------

check('new wall uses the initial pointer position', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let ds = draw_state()
	let r = f.start_resize_seg(null, 300, 300, 20, 0, 1, 0, ds)
	r.resize(20, 0, ds, {})
	assert.equal(r.seg.m1, 300)
	assert.equal(r.seg.m2, 320)
	r.resize(40, 0, ds, {})
	assert.equal(r.seg.m2, 340)
	r.stop(ds)
})

check('detached endpoint uses its original position', () => {
	pressed_keys.add('ctrl')
	let f = floor([['connect', [0, 0], [100, 0], [100, 100]]])
	let ds = draw_state()
	let p = f.ps.find(p => p[0] == 100 && p[1] == 0)
	let r = f.start_resize_seg(p, 100, 0, -20, 0, -1, 0, ds)
	r.resize(-20, 0, ds, {})
	assert.equal(r.seg.m2, 80)
	r.resize(-40, 0, ds, {})
	assert.equal(r.seg.m2, 60)
	r.stop(ds)
})

check('existing free endpoint uses its original position', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let ds = draw_state()
	let p = f.ps.find(p => p[0] == 100)
	let r = f.start_resize_seg(p, 100, 0, 20, 0, 1, 0, ds)
	r.resize(20, 0, ds, {})
	assert.equal(p[0], 120)
	r.stop(ds)
})

// collapsed-wall preview ---------------------------------------------------

check('collapsing a free wall keeps finite bounds and allows extending', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let ds = draw_state()
	let created = f.start_resize_seg(null, 400, 200, 60, 0, 1, 0, ds)
	created.resize(60, 0, ds, {})
	created.stop(ds)
	let p = f.ps.find(p => p[0] == 400 && p[1] == 200)
	let r = f.start_resize_seg(p, 400, 200, 60, 0, 1, 0, ds)
	r.resize(60, 0, ds, {})
	assert.equal(r.seg.m1, r.seg.m2)
	for (let m of f.house.bb)
		assert(Number.isFinite(m), 'infinite house bounds')
	for (let c of f.comps)
		assert(c.outer_cycle.edges.length > 0, 'empty wall outline')
	r.resize(80, 0, ds, {})
	assert.equal(p[0], 480)
	assert.equal(r.seg.m2 - r.seg.m1, 20)
	for (let m of f.house.bb)
		assert(Number.isFinite(m))
	r.stop(ds)
})

// resize previews without cleanup -----------------------------------------

check('overlapping walls stay separate until release', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let seg = f.segs[0]
	let ds = draw_state()
	let fix = f.fix
	let n_fix = 0
	f.fix = function() {
		n_fix++
		return fix.call(this)
	}
	let r = f.start_resize_seg(null, 500, 0, 40, 0, 1, 0, ds)
	for (let dx of [40, 100, 200]) {
		r.resize(dx, 0, ds, {})
		assert.equal(n_fix, 0)
		assert.equal(f.segs.length, 2)
		assert.equal(f.ps.length, 4)
		assert(f.segs.includes(seg))
		assert(f.segs.includes(r.seg))
		assert.equal(seg.m1, 0)
		assert.equal(seg.m2, 1000)
		assert.equal(r.seg.m2, 500 + dx)
		let co = f.comps.find(co => co.segs.includes(r.seg))
		assert(co.outer_cycle.edges.length > 0)
		assert(co.outer_cycle.edges.bbox()[2] >= r.seg.m2)
	}
	r.stop(ds)
	assert.equal(n_fix, 1)
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
})

check('overlapping extension commits once and supports undo and redo', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let ds = draw_state()
	let r = f.start_resize_seg(null, 500, 0, 40, 0, 1, 0, ds)
	r.resize(600, 0, ds, {})
	assert.equal(f.segs.length, 2)
	assert(f.segs.includes(r.seg))
	r.stop(ds)
	assert.equal(f.segs.length, 1)
	assert.equal(f.segs[0].m2, 1100)
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('cancelling an overlapping extension restores its starting geometry',
	() => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let ds = draw_state()
	let r = f.start_resize_seg(null, 500, 0, 40, 0, 1, 0, ds)
	r.resize(600, 0, ds, {})
	assert(f.segs.includes(r.seg))
	r.cancel(ds)
	assert.equal(geometry(f), before)
	assert.equal(ds.snap_lines.length, 0)
	assert.equal(ds.measure_edges.length, 0)
	assert.equal(f.house.undo(), false)
})

check('a detached junction endpoint can collapse on the first resize step',
	() => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	let p = f.ps_ids.get('cl')
	let ds = draw_state()
	let r = f.start_resize_seg(p, 200, 0, -200, 0, -1, 0, ds)
	assert.equal(r.seg.m2, 200)
	r.resize(-200, 0, ds, {})
	assert(f.segs.includes(r.seg))
	assert.equal(r.seg.m1, r.seg.m2)
	for (let m of f.house.bb)
		assert(Number.isFinite(m))
	r.resize(-80, 0, ds, {})
	assert.equal(r.seg.m2, 120)
	r.stop(ds)
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

// resize snapping and limits -----------------------------------------------

check('vertical endpoint does not snap to x coordinates', () => {
	let f = floor([
		[null, [100, 0], [100, 100]],
		[null, [180, 500], [180, 600]],
	])
	let ds = draw_state()
	let p = f.ps.find(p => p[0] == 100 && p[1] == 100)
	let r = f.start_resize_seg(p, 100, 100, 0, 0, 0, 1, ds)
	r.resize(0, 90, ds, {})
	assert.equal(p[1], 190)
	assert.equal(ds.snap_lines.length, 0)
	r.stop(ds)
})

for (let ctrl of [false, true]) {
	check('vertical endpoint snaps to y coordinates, ctrl=' + ctrl, () => {
		if (ctrl) pressed_keys.add('ctrl')
		let f = floor([
			[null, [100, 0], [100, 100]],
			[null, [180, 200], [180, 600]],
		])
		let ds = draw_state()
		let p = f.ps.find(p => p[0] == 100 && p[1] == 100)
		let r = f.start_resize_seg(p, 100, 100, 0, 0, 0, 1, ds)
		r.resize(0, 90, ds, {})
		assert.equal(p[1], ctrl ? 190 : 200)
		r.stop(ds)
	})
}

check('vertical endpoint stops at a blocking wall', () => {
	let f = floor([
		[null, [100, 0], [100, 100]],
		[null, [0, 250], [300, 250]],
	])
	let ds = draw_state()
	let p = f.ps.find(p => p[0] == 100 && p[1] == 100)
	let r = f.start_resize_seg(p, 100, 100, 0, 0, 0, 1, ds)
	r.resize(0, 400, ds, {})
	assert.equal(p[1], 250)
	r.stop(ds)
})

for (let v of [false, true])
	for (let direction of [-1, 1])
		for (let first_delta of [20, 200]) {
			let name = 'new wall collision, vertical=' + v
				+ ', direction=' + direction + ', first_delta=' + first_delta
			check(name, () => {
				let wall
				if (v)
					wall = [null, [0, 250], [300, 250]]
				else
					wall = [null, [250, 0], [250, 300]]
				let f = floor([wall])
				let m0 = direction > 0 ? 100 : 400
				let x0 = v ? 150 : m0
				let y0 = v ? m0 : 150
				let d0 = direction * first_delta
				let dx0 = v ? 0 : d0
				let dy0 = v ? d0 : 0
				let ds = draw_state()
				let r = f.start_resize_seg(null, x0, y0, dx0, dy0,
					v ? 0 : direction, v ? direction : 0, ds)
				let d = direction * 200
				r.resize(v ? 0 : d, v ? d : 0, ds, {})
				assert.equal(r.seg[1][v ? 1 : 0], 250)
				r.resize(0, 0, ds, {})
				assert.equal(r.seg[1][v ? 1 : 0], m0)
				r.cancel(ds)
			})
		}

// free-wall snapping and preview -------------------------------------------

for (let ctrl of [false, true]) {
	check('free-wall movement and outline, ctrl=' + ctrl, () => {
		if (ctrl) pressed_keys.add('ctrl')
		let f = floor([
			[null, [0, 0], [100, 0]],
			[null, [0, 200], [100, 200]],
		])
		let ds = draw_state()
		let s = f.segs.find(s => s.axis == 0)
		let c = f.comps.find(c => c.segs.includes(s)).outer_cycle
		let y1 = c.edges.bbox()[1]
		let r = f.start_move_seg(s, ds)
		r.move(0, 190, ds)
		let dy = ctrl ? 190 : 200
		assert.equal(s.axis, dy)
		assert.equal(c.edges.bbox()[1], y1 + dy)
		r.stop(ds)
	})
	check('free-wall endpoints snap while preserving length, ctrl=' + ctrl,
		() => {
		if (ctrl) pressed_keys.add('ctrl')
		let f = floor([
			[null, [0, 0], [100, 0]],
			[null, [200, 200], [350, 200]],
		])
		let ds = draw_state()
		let s = f.segs.find(s => s.axis == 0)
		let r = f.start_move_seg(s, ds)
		r.move(190, 0, ds)
		assert.equal(s.m1, ctrl ? 190 : 200)
		assert.equal(s.m2 - s.m1, 100)
		r.stop(ds)
	})
}

for (let v of [false, true])
	for (let reverse of [false, true]) {
		let name = 'free-wall endpoint identity, vertical=' + v
			+ ', reversed=' + reverse
		check(name, () => {
			let a = [0, 0]
			let b = v ? [0, 100] : [100, 0]
			let f = floor([[null, reverse ? b : a, reverse ? a : b]])
			let before = geometry(f)
			let seg = f.segs[0]
			let p1 = seg[0]
			let p2 = seg[1]
			let a0 = [...p1]
			let b0 = [...p2]
			let ds = draw_state()
			let r = f.start_move_seg(seg, ds)
			r.move(0, 0, ds)
			r.stop(ds)
			assert.equal(geometry(f), before)
			assert.equal(f.house.undo(), false)
			r = f.start_move_seg(seg, ds)
			r.move(30, 40, ds)
			assert.equal(seg[0], p1)
			assert.equal(seg[1], p2)
			assert.deepEqual([...p1], [a0[0] + 30, a0[1] + 40])
			assert.deepEqual([...p2], [b0[0] + 30, b0[1] + 40])
			r.stop(ds)
			let after = geometry(f)
			assert(f.house.undo())
			assert.equal(geometry(f), before)
			assert(f.house.redo())
			assert.equal(geometry(f), after)
		})
	}

for (let v of [false, true]) {
	check('reversed free-wall endpoints keep their IDs when snapping, v=' + v,
		() => {
		let f
		if (v)
			f = floor([
				[null, [0, 100], [0, 0]],
				[null, [200, 200], [200, 350]],
			])
		else
			f = floor([
				[null, [100, 0], [0, 0]],
				[null, [200, 200], [350, 200]],
			])
		let seg = f.segs.find(seg => seg.axis == 0)
		let ds = draw_state()
		let r = f.start_move_seg(seg, ds)
		r.move(v ? 0 : 190, v ? 190 : 0, ds)
		assert.equal(seg[0][v ? 1 : 0], 300)
		assert.equal(seg[1][v ? 1 : 0], 200)
		assert.equal(seg.m2 - seg.m1, 100)
		r.stop(ds)
	})
}

// measurements after moving an exterior wall --------------------------------

for (let y of [0, 400])
	for (let dy of [-100, 100]) {
		check('exterior wall measurements y=' + y + ', dy=' + dy, () => {
			let f = house(ctx.house_test_plans.simple).floors[0]
			let ds = draw_state()
			let s = f.segs.find(s => !s.is_v && s.axis == y && s.m1 == 200)
			let r = f.start_move_seg(s, ds)
			r.move(0, dy, ds)
			r.stop(ds)
			let connector = f.segs.find(s => s.is_v && s.axis == 200
				&& s.m1 == Math.min(y, y+dy) && s.m2 == Math.max(y, y+dy))
			assert(connector)
			let r1 = f.start_move_seg(connector, ds)
			for (let dx of [0, 40]) {
				r1.move(dx, 0, ds)
				assert(ds.measure_edges.length > 0)
				for (let [a, b] of ds.measure_edges)
					assert(a[0] == b[0] || a[1] == b[1],
						'diagonal measurement: ' + a + ' to ' + b)
				for (let c of f.comps)
					for (let cy of c.cycles)
						for (let i = 0; i < cy.edges.length; i++) {
							let a = cy.edges[i]
							let b = cy.edges[(i+1) % cy.edges.length]
							assert(a[0] == b[0] || a[1] == b[1],
								'diagonal outline: ' + a + ' to ' + b)
						}
			}
			r1.stop(ds)
		})
	}

// connected-wall snapping and deletion -------------------------------------

for (let ctrl of [false, true]) {
	check('connected-wall movement, ctrl=' + ctrl, () => {
		if (ctrl) pressed_keys.add('ctrl')
		let f = house(ctx.house_test_plans.simple).floors[0]
		let ds = draw_state()
		let s = f.segs.find(s => s.is_v && s.axis == 200)
		let r = f.start_move_seg(s, ds)
		r.move(15, 0, ds)
		assert.equal(s.axis, ctrl ? 215 : 200)
		r.stop(ds)
	})
}

check('deleting a wall through the move callback', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let ds = draw_state()
	let s = f.segs.find(s => s.is_v && s.axis == 200)
	f.start_move_seg(s, ds).stop(ds, true)
	assert.equal(f.segs.length, 4)
	assert.equal(f.comps[0].cycles.length, 2)
})

// empty floors -------------------------------------------------------------

check('empty floors do not expand the house bounds', () => {
	let h = house({floors: [
		{lines: []},
		{lines: [[null, [0, 0], [100, 0]]]},
	]})
	assert.deepEqual([...h.bb], [-14, -14, 114, 14])
})

check('an empty house keeps empty bounds', () => {
	let h = house({floors: [{lines: []}]})
	assert(h.bb[0] > h.bb[2])
	assert(h.bb[1] > h.bb[3])
})

// edit history -------------------------------------------------------------

function geometry(f) {
	return JSON.stringify({
		ps: Array.from(f.ps, p => [p[0], p[1], p.id]),
		segs: Array.from(f.segs, s => [s[0].id, s[1].id, s.id]),
	})
}

check('serialized geometry restores IDs, connections, and derived data', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let saved = JSON.stringify(f.save_state())
	let f1 = floor([])
	f1.load_state(JSON.parse(saved))
	assert.equal(geometry(f1), geometry(f))
	assert.deepEqual([...f1.house.bb], [...f.house.bb])
	assert.equal(f1.comps[0].cycles.length, 3)
	let p = f1.ps_ids.get('cl')
	assert.equal(p.segs.length, 3)
	for (let seg of p.segs) {
		assert(f1.segs.includes(seg))
		assert(seg[0] == p || seg[1] == p)
		assert(p.adj.includes(seg[1-seg.pi(p)]))
	}
})

check('saved wall geometry loads through the normal plan loader', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let state = JSON.parse(JSON.stringify(f.save_state()))
	let f1 = house({floors: [state]}).floors[0]
	assert.equal(geometry(f1), geometry(f))
	assert.equal(f1.comps[0].cycles.length, 3)
	assert.deepEqual([...f1.house.bb], [...f.house.bb])
})

check('saved geometry remains independent and can be loaded repeatedly', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	let state = f.save_state()
	let saved = JSON.stringify(state)
	for (let i = 0; i < 3; i++) {
		f.delete_seg(f.segs.find(s => s.is_v && s.axis == 200))
		assert.notEqual(geometry(f), before)
		assert.equal(JSON.stringify(state), saved)
		f.load_state(state)
		assert.equal(geometry(f), before)
		assert.equal(JSON.stringify(state), saved)
	}
})

check('wall history leaves roof objects and direct editor links attached', () => {
	let state = JSON.parse(JSON.stringify(ctx.house_test_plans.gable1))
	state.floors[0].roofs = state.floors[2].roofs
	let f = house(state).floors[0]
	let roofs = f.roofs
	let roof = roofs[0]
	let comp = {roof: roof}
	roof.comp = comp
	let editor = {floor: f}
	f.editor = editor
	f.ps[0].editor = editor
	f.segs[0].editor = editor
	JSON.stringify(f.save_state())
	let ds = draw_state()
	let r = f.start_move_seg(f.segs.find(s => s.is_v && s.axis == 200), ds)
	r.move(50, 0, ds)
	r.stop(ds)
	assert(f.house.undo())
	assert(f.house.redo())
	r = f.start_move_seg(f.segs[0], ds)
	r.move(0, 50, ds)
	r.cancel(ds)
	assert.equal(f.roofs, roofs)
	assert.equal(f.roofs[0], roof)
	assert.equal(roof.comp, comp)
	assert.equal(comp.roof, roof)
	assert.equal(f.editor, editor)
	assert.equal(editor.floor, f)
})

check('a whole drag is one undo step with stable IDs', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let ds = draw_state()
	let before = geometry(f)
	let s = f.segs.find(s => s.is_v && s.axis == 200)
	let r = f.start_move_seg(s, ds)
	for (let dx of [30, 40, 50])
		r.move(dx, 0, ds)
	r.stop(ds)
	let after = geometry(f)
	assert.notEqual(after, before)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
	assert.equal(f.house.redo(), false)
	assert.equal(f.ps_ids.get('cl').id, 'cl')
})

check('resizing can be undone and redone', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let ds = draw_state()
	let before = geometry(f)
	let p = f.ps.find(p => p[0] == 100)
	let r = f.start_resize_seg(p, 100, 0, 20, 0, 1, 0, ds)
	r.resize(40, 0, ds, {})
	r.stop(ds)
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('new walls can be undone and redone', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let ds = draw_state()
	let before = geometry(f)
	let r = f.start_resize_seg(null, 300, 300, 20, 0, 1, 0, ds)
	r.resize(40, 0, ds, {})
	r.stop(ds)
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('deletion undo restores rooms and connections', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	f.delete_seg(f.segs.find(s => s.is_v && s.axis == 200))
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
	let ds = draw_state()
	let before = geometry(f)
	let s = f.segs.find(s => !s.is_v && s.axis == 0 && s.m1 == 200)
	let r = f.start_move_seg(s, ds)
	r.move(0, 100, ds)
	r.cancel(ds)
	assert.equal(geometry(f), before)
	assert.equal(f.comps[0].ps.length, f.ps.length)
	assert.equal(f.comps[0].segs.length, f.segs.length)
	assert.equal(ds.snap_lines.length, 0)
	assert.equal(ds.measure_edges.length, 0)
	assert.equal(f.house.undo(), false)
})

check('cancelled wall creation restores the starting geometry', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let ds = draw_state()
	let before = geometry(f)
	let r = f.start_resize_seg(null, 300, 300, 20, 0, 1, 0, ds)
	r.resize(40, 0, ds, {})
	r.cancel(ds)
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
})

check('new edits discard redo history', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let ds = draw_state()
	let before = geometry(f)
	let r = f.start_move_seg(f.segs[0], ds)
	r.move(0, 50, ds)
	r.stop(ds)
	assert(f.house.undo())
	r = f.start_move_seg(f.segs[0], ds)
	r.move(0, 80, ds)
	r.stop(ds)
	assert.equal(f.house.redo(), false)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
})

check('unchanged and cancelled edits preserve redo', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let ds = draw_state()
	let s = f.segs.find(s => s.is_v && s.axis == 200)
	let r = f.start_move_seg(s, ds)
	r.move(50, 0, ds)
	r.stop(ds)
	let after = geometry(f)
	assert(f.house.undo())
	s = f.segs.find(s => !s.is_v && s.axis == 0 && s.m1 == 200)
	r = f.start_move_seg(s, ds)
	r.move(0, 0, ds)
	r.stop(ds)
	r = f.start_move_seg(f.segs[0], ds)
	r.move(0, 50, ds)
	r.cancel(ds)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('house undo preserves the other floors', () => {
	let h = house({floors: [
		{lines: [[null, [0, 0], [100, 0]]]},
		{lines: [[null, [0, 200], [100, 200]]]},
	]})
	let f = h.floors[0]
	let before = geometry(f)
	let other = geometry(h.floors[1])
	let ds = draw_state()
	let r = f.start_move_seg(f.segs[0], ds)
	r.move(0, 50, ds)
	r.stop(ds)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(geometry(h.floors[1]), other)
})

check('the last wall survives repeated deletion undo and redo', () => {
	let f = floor([[null, [0, 0], [100, 0]]])
	let before = geometry(f)
	f.delete_seg(f.segs[0])
	for (let i = 0; i < 3; i++) {
		assert.equal(f.ps.length, 0)
		assert.equal(f.segs.length, 0)
		assert(f.house.bb[0] > f.house.bb[2])
		assert(f.house.undo())
		assert.equal(geometry(f), before)
		assert.deepEqual([...f.house.bb], [-14, -14, 114, 14])
		assert(f.house.redo())
	}
})

check('house snapshots round-trip every floor and roof', () => {
	let h = house(ctx.house_test_plans.gable1)
	let saved = JSON.stringify(h.save_state())
	let h1 = house(JSON.parse(saved))
	assert.equal(JSON.stringify(h1.save_state()), saved)
	let state = h.save_state()
	state.floors[0].points[0][0] += 100
	state.floors[2].roofs[0].box[0] += 100
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
	assert.equal(h.redo(), false)
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), first)
	assert(h.redo())
})

check('cancelled changes add no undo step', () => {
	let h = ctx.house_plan(ctx.house_test_plans.simple)
	let f = h.floors[0]
	let ds = draw_state()
	let drag = f.start_move_seg(f.segs[0], ds)
	drag.move(0, 50, ds)
	drag.cancel(ds)
	assert.equal(h.undo(), false)
	f.delete_seg(f.segs[0])
	assert(h.undo())
	assert.equal(h.undo(), false)
})

check('each house owns its history', () => {
	let h0 = ctx.house_plan(ctx.house_test_plans.simple)
	let h1 = ctx.house_plan(ctx.house_test_plans.simple)
	h0.floors[0].delete_seg(h0.floors[0].segs[0])
	assert.equal(h1.undo(), false)
	h1.floors[0].delete_seg(h1.floors[0].segs[0])
	assert(h1.undo())
	assert(h0.undo())
	assert.equal(h1.undo(), false)
	assert.equal(h0.undo(), false)
})

// walls --------------------------------------------------------------------

function rect_lines(x, y, w, h) {
	return ['draw', x, y, w, h, -w, -h]
}

// polys of the whole house, or of floors 0..floor cut at floor.
function house_polys(h, floor) {
	if (floor)
		return h.make_polys(floor, true)
	return h.make_polys(h.floors[h.floors.length-1], false)
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

check('exterior skin merges across T-junctions and slabs', () => {
	let h = house(ctx.house_test_plans.simple)
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 270], [-14, 270]])
	assert.deepEqual([...poly.holes], [])
})

check('exterior skins of stacked floors merge into one polygon', () => {
	let h = house(ctx.house_test_plans.gable1)
	let [poly, ...rest] = wall_polys_at(h, true, -14, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [414, 0], [414, 770], [-14, 770]])
})

check('room skins of floors with a slab between them stay separate', () => {
	let h = house(ctx.house_test_plans.gable1)
	let polys = wall_polys_at(h, true, 4, 1)
	assert.equal(polys.length, 4)
	for (let poly of polys)
		assert.equal(poly.point_count(), 4)
})

check('a smaller upper floor makes a stepped polygon', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)]},
		{lines: [rect_lines(0, 0, 300, 400)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly), [
		[-14, 0], [614, 0], [614, 270], [314, 270], [314, 520], [-14, 520]])
	let [side] = wall_polys_at(h, true, 314, 1)
	assert.deepEqual(outline_points(side),
		[[-14, 270], [414, 270], [414, 520], [-14, 520]])
})

check('a gap between two floors makes a hole', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)]},
		{lines: [rect_lines(0, 0, 200, 400), rect_lines(400, 0, 200, 400)]},
		{lines: [rect_lines(0, 0, 600, 400)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 770], [-14, 770]])
	assert.equal(poly.hole_count(), 1)
	assert.deepEqual(loop_points(poly, poly.hole_i1(0), poly.hole_i2(0)),
		[[214, 270], [214, 500], [386, 500], [386, 270]])
})

check('floor height comes from the plan', () => {
	let h = house({floors: [{h: 300, lines: [rect_lines(0, 0, 600, 400)]}]})
	assert.equal(h.floors[0].h, 300)
	let [poly] = wall_polys_at(h, false, -14, -1)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 320], [-14, 320]])
})

// open rooms ----------------------------------------------------------------

function open_room_count(floor) {
	let n = 0
	for (let room_point of floor.room_point_by_cycle.values())
		if (room_point?.is_open)
			n++
	return n
}

function open_room_house(upper_room_points, island_lines) {
	let lines = [rect_lines(0, 0, 600, 400)]
	if (island_lines)
		lines.push(island_lines)
	return house({floors: [
		{lines: lines},
		{lines: lines, room_points: upper_room_points},
	]})
}

check('an open room merges its skins with the room below', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = wall_polys_at(h, true, 4, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[4, 20], [396, 20], [396, 500], [4, 500]])
})

check('a closed room point keeps the slab', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: false}])
	assert.equal(open_room_count(h.floors[1]), 0)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 2)
})

check('a room with two points stays closed', () => {
	let h = open_room_house([
		{x: 100, y: 200, is_open: true},
		{x: 500, y: 200, is_open: true},
	])
	assert.equal(open_room_count(h.floors[1]), 0)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 2)
})

check('a room point in a wall body opens no room', () => {
	let h = open_room_house([{x: 0, y: 200, is_open: true}])
	assert.equal(open_room_count(h.floors[1]), 0)
})

check('an island in an open room keeps a slab piece under it', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}],
		rect_lines(200, 100, 100, 100))
	let [poly, ...rest] = wall_polys_at(h, true, 196, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[96, 20], [204, 20], [204, 500], [96, 500]])
})

check('room points are saved and loaded', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	let floor = h.floors[1]
	let state = floor.save_state()
	assert.equal(JSON.stringify(state.room_points),
		JSON.stringify([{x: 100, y: 200, is_open: true}]))
	assert.notEqual(state.room_points[0], floor.room_points[0])
	floor.load_state({...state, room_points: []})
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 2)
	floor.load_state(state)
	assert.equal(open_room_count(floor), 1)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 1)
	assert.equal(JSON.stringify(h.save_state().floors[1].room_points),
		JSON.stringify(state.room_points))
})

check('an edit undo restores the open rooms', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	let floor = h.floors[1]
	let seg = floor.segs.find(seg => seg.is_v && seg.axis == 0)
	let mover = floor.start_move_seg(seg, draw_state())
	mover.move(150, 0, draw_state())
	mover.stop(draw_state())
	assert.equal(open_room_count(floor), 0) // the point is outside now.
	assert(h.undo())
	assert.equal(open_room_count(floor), 1)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 1)
})

check('adding a floor copies the room points', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	let floor = h.add_floor()
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify(h.floors[1].room_points))
	assert.notEqual(floor.room_points[0], h.floors[1].room_points[0])
	assert.equal(open_room_count(floor), 1)
	let [poly, ...rest] = wall_polys_at(h, true, 4, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[4, 20], [396, 20], [396, 750], [4, 750]])
})

check('toggling a room with no point adds an open point', () => {
	let h = open_room_house([])
	let floor = h.floors[1]
	let edit_no = h.edit_no
	floor.toggle_room(floor.hit_cycle_edges(100, 200), 100, 200)
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify([{x: 100, y: 200, is_open: true}]))
	assert.equal(open_room_count(floor), 1)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 1)
	assert.equal(h.edit_no, edit_no + 1)
	assert(h.undo())
	assert.equal(floor.room_points.length, 0)
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 2)
	assert(h.redo())
	assert.equal(open_room_count(floor), 1)
})

check('toggling a room with one point flips the point', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	let floor = h.floors[1]
	floor.toggle_room(floor.hit_cycle_edges(300, 100), 300, 100)
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify([{x: 100, y: 200, is_open: false}]))
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 4, 1).length, 2)
	assert(h.undo())
	assert.equal(floor.room_points[0].is_open, true)
	assert.equal(open_room_count(floor), 1)
})

check('toggling a room with two points does nothing', () => {
	let h = open_room_house([
		{x: 100, y: 200, is_open: true},
		{x: 500, y: 200, is_open: true},
	])
	let floor = h.floors[1]
	let c = floor.hit_cycle_edges(100, 200)
	assert.equal(floor.room_point_by_cycle.get(c), null)
	let edit_no = h.edit_no
	floor.toggle_room(c, 300, 100)
	assert.equal(h.edit_no, edit_no)
	assert.equal(h.undo(), false)
	assert.equal(floor.room_points[0].is_open, true)
	assert.equal(floor.room_points[1].is_open, true)
})

check('removing a room point closes its room', () => {
	let h = open_room_house([
		{x: 100, y: 200, is_open: true},
		{x: 500, y: 200, is_open: true},
	])
	let floor = h.floors[1]
	floor.remove_room_point(floor.room_points[1])
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify([{x: 100, y: 200, is_open: true}]))
	assert.equal(open_room_count(floor), 1) // no conflict anymore.
	assert(h.undo())
	assert.equal(floor.room_points.length, 2)
	assert.equal(open_room_count(floor), 0)
})

check('moving a room point into a wall closes its room', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	let floor = h.floors[1]
	let mover = floor.start_move_room_point(floor.room_points[0])
	mover.move(-100, 0)
	mover.stop()
	assert.equal(floor.room_points[0].x, 0)
	assert.equal(open_room_count(floor), 0)
	assert(h.undo())
	assert.equal(floor.room_points[0].x, 100)
	assert.equal(open_room_count(floor), 1)
})

check('cancelling a room point move restores it', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	let floor = h.floors[1]
	let mover = floor.start_move_room_point(floor.room_points[0])
	mover.move(-100, 0)
	mover.cancel(draw_state())
	assert.equal(floor.room_points[0].x, 100)
	assert.equal(open_room_count(floor), 1)
	assert.equal(h.undo(), false)
})

check('a room point in an island wall body opens no room', () => {
	let h = open_room_house([{x: 200, y: 150, is_open: true}],
		rect_lines(200, 100, 100, 100))
	assert.equal(open_room_count(h.floors[1]), 0)
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

check('one floor has slab bottom, floor, ceiling and slab top', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 600, 400)]}]})
	assert.equal(house_polys(h)[1].length, 4)
	let outline = [[-14, -14], [614, -14], [614, 414], [-14, 414]]
	let room = [[4, 4], [596, 4], [596, 396], [4, 396]]
	for (let [z, normal, ps] of [
		[  0, -1, outline],
		[ 20,  1, room],
		[250, -1, room],
		[270,  1, outline],
	]) {
		let [poly, ...rest] = horizontal_polys_at(h, z, normal)
		assert.equal(rest.length, 0)
		assert.deepEqual(outline_points(poly), ps)
		assert.deepEqual([...poly.holes], [])
	}
})

check('an open room has no floor and no ceiling below it', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	assert.equal(horizontal_polys_at(h, 250, -1).length, 0)
	assert.equal(horizontal_polys_at(h, 250,  1).length, 0)
	assert.equal(horizontal_polys_at(h, 270,  1).length, 0)
	assert.equal(house_polys(h)[1].length, 4)
})

check('a wall under an open room gets a slab', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400), ['draw', 300, 0, 0, 400]]},
		{lines: [rect_lines(0, 0, 600, 400)],
			room_points: [{x: 100, y: 200, is_open: true}]},
	]})
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 270, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[296, 4], [304, 4], [304, 396], [296, 396]])
	assert.equal(horizontal_polys_at(h, 250, 1).length, 0)
	assert.equal(horizontal_polys_at(h, 250, -1).length, 0)
})

check('an open room keeps a slab where it overflows the floor below', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 300, 400)]},
		{lines: [rect_lines(0, 0, 600, 400)],
			room_points: [{x: 100, y: 200, is_open: true}]},
	]})
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 270, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[296, 4], [596, 4], [596, 396], [296, 396]])
})

check('an open room on the ground floor keeps its slab', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)],
			room_points: [{x: 100, y: 200, is_open: true}]},
	]})
	assert.equal(open_room_count(h.floors[0]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 20, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[4, 4], [596, 4], [596, 396], [4, 396]])
})

check('a smaller upper floor leaves a terrace and a ceiling', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)]},
		{lines: [rect_lines(0, 0, 300, 400)]},
	]})
	// slab 1 top: the upper room floor and the terrace.
	let [terrace, room, ...rest] = horizontal_polys_at(h, 270, 1)
		.sort((poly1, poly2) => poly2[0][0] - poly1[0][0])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(terrace),
		[[314, -14], [614, -14], [614, 414], [314, 414]])
	assert.deepEqual(outline_points(room),
		[[4, 4], [296, 4], [296, 396], [4, 396]])
	// slab 1 bottom: the ground floor ceiling.
	let [ceiling, ...rest1] = horizontal_polys_at(h, 250, -1)
	assert.equal(rest1.length, 0)
	assert.deepEqual(outline_points(ceiling),
		[[4, 4], [596, 4], [596, 396], [4, 396]])
})

check('a terrace slab side merges with the walls below it', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)]},
		{lines: [rect_lines(0, 0, 300, 400)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, true, 614, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [414, 0], [414, 270], [-14, 270]])
	assert.deepEqual([...poly.holes], [])
})

// cutting the house at a floor ----------------------------------------------

function two_floor_house() {
	return house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)]},
		{lines: [rect_lines(0, 0, 600, 400)]},
	]})
}

function check_wall_caps(h, z, floor) {
	let [poly, ...rest] = horizontal_polys_at(h, z, 1, floor)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, -14], [614, -14], [614, 414], [-14, 414]])
	assert.deepEqual([...poly.holes], [4])
	assert.deepEqual(loop_points(poly, 4, 8),
		[[4, 4], [4, 396], [596, 396], [596, 4]])
}

check('a cut floor has wall caps and no slab on top', () => {
	let h = two_floor_house()
	let floor = h.floors[0]
	check_wall_caps(h, 250, floor)
	assert.equal(horizontal_polys_at(h, 250, -1, floor).length, 0)
	assert.equal(horizontal_polys_at(h, 270,  1, floor).length, 0)
	assert.equal(house_polys(h, floor)[1].length, 3)
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1, floor)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 250], [-14, 250]])
})

check('a cut keeps the floors below and their slabs', () => {
	let h = two_floor_house()
	let floor = h.floors[1]
	assert.equal(horizontal_polys_at(h, 250, -1, floor).length, 1)
	assert.equal(horizontal_polys_at(h, 270,  1, floor).length, 1)
	check_wall_caps(h, 500, floor)
	assert.equal(horizontal_polys_at(h, 520,  1, floor).length, 0)
	let [poly] = wall_polys_at(h, false, -14, -1, floor)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 500], [-14, 500]])
})

// adding and removing floors -----------------------------------------------

check('adding a floor copies the top floor and raises the walls', () => {
	let h = house(ctx.house_test_plans.simple)
	let edit_no = h.edit_no
	let floor = h.add_floor()
	assert.equal(h.floors.length, 2)
	assert.equal(h.floors[1], floor)
	assert.equal(h.edit_no, edit_no + 1)
	assert.deepEqual(JSON.stringify(floor.save_state()),
		JSON.stringify(h.floors[0].save_state()))
	assert.equal(h.h, 500)
	let [poly] = wall_polys_at(h, false, -14, -1)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 520], [-14, 520]])
})

check('removing the top floor lowers the walls', () => {
	let h = house(ctx.house_test_plans.simple)
	h.add_floor()
	h.remove_top_floor()
	assert.equal(h.floors.length, 1)
	assert.equal(h.h, 250)
	let [poly] = wall_polys_at(h, true, -14, -1)
	assert.equal(outline_points(poly)[2][1], 270)
})

check('adding and removing floors is undoable', () => {
	let h = house(ctx.house_test_plans.simple)
	let floor = h.add_floor()
	floor.delete_seg(floor.segs[0])
	let state1 = JSON.stringify(floor.save_state())
	h.remove_top_floor()
	assert(h.undo()) // remove
	assert.equal(h.floors[1], floor)
	assert.equal(h.h, 500)
	assert(h.undo()) // the floor's edit
	assert.notEqual(JSON.stringify(floor.save_state()), state1)
	assert(h.undo()) // add
	assert.equal(h.floors.length, 1)
	assert.equal(h.h, 250)
	assert.equal(h.undo(), false)
	assert(h.redo()) // add
	assert(h.redo()) // the floor's edit
	assert.equal(JSON.stringify(floor.save_state()), state1)
	assert(h.redo()) // remove
	assert.equal(h.floors.length, 1)
	assert.equal(h.redo(), false)
})

check('a new action clears redo', () => {
	let h = house(ctx.house_test_plans.simple)
	h.add_floor()
	assert(h.undo())
	h.add_floor()
	assert.equal(h.redo(), false)
})

console.log(n_checks + ' house plan checks passed')
