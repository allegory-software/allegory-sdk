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
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js', 'house_plan.js']
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

check('wall history leaves direct editor links attached', () => {
	let f = house(ctx.house_test_plans.gable1).floors[0]
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
	state.floors[2].roof.edge_points[0].x += 100
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
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1, h.floors[0])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 250], [-14, 250]])
	assert.deepEqual([...poly.holes], [])
})

// gable1 cut at its top floor: without the roof.
check('exterior skins of stacked floors merge into one polygon', () => {
	let h = house(ctx.house_test_plans.gable1)
	let [poly, ...rest] = wall_polys_at(h, true, -14, -1, h.floors[2])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [414, 0], [414, 750], [-14, 750]])
})

check('the gable wall rises to the roof underside', () => {
	let h = house(ctx.house_test_plans.gable1)
	let faces = h.make_faces(h.floors[2], false)
	let walls = faces.filter(face => face.tag == 'walls')
	let roofs = faces.filter(face => face.tag == 'roof')
	assert(roofs.length > 0)
	let [poly, ...rest] = walls.map(face_poly).filter(poly =>
		poly.is_v && poly.axis == -14 && poly.normal == -1)
	assert.equal(rest.length, 0)
	// 45 deg, 20 thick: the underside is 20*sqrt(2) below the top, which
	// starts at 750 on the outer skin and peaks at the ridge, y = 200.
	let d = 20 * Math.SQRT2
	let ps = outline_points(poly)
	let ps1 = [[-14, 0], [414, 0], [414, 750 - d], [200, 964 - d],
		[-14, 750 - d]]
	assert.equal(ps.length, ps1.length)
	for (let i = 0; i < ps.length; i++)
		for (let k = 0; k < 2; k++)
			assert(Math.abs(ps[i][k] - ps1[i][k]) <= .002, JSON.stringify(ps))
})

check('room skins of floors with a slab between them stay separate', () => {
	let h = house(ctx.house_test_plans.gable1)
	let polys = wall_polys_at(h, true, 4, 1, h.floors[2])
	assert.equal(polys.length, 4)
	for (let poly of polys)
		assert.equal(poly.point_count(), 4)
})

// a terrace on the lower floor, cut at the top floor: without roofs.
check('a smaller upper floor makes a stepped polygon', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)],
			area_points: [{x: 450, y: 200, kind: 'terrace'}]},
		{lines: [rect_lines(0, 0, 300, 400)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1, h.floors[1])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly), [
		[-14, 0], [614, 0], [614, 270], [314, 270], [314, 500], [-14, 500]])
	let [side] = wall_polys_at(h, true, 314, 1, h.floors[1])
	assert.deepEqual(outline_points(side),
		[[-14, 270], [414, 270], [414, 500], [-14, 500]])
})

check('a gap between two floors makes a hole', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)],
			area_points: [{x: 300, y: 200, kind: 'terrace'}]},
		{lines: [rect_lines(0, 0, 200, 400), rect_lines(400, 0, 200, 400)]},
		{lines: [rect_lines(0, 0, 600, 400)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -14, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 750], [-14, 750]])
	assert.equal(poly.hole_count(), 1)
	assert.deepEqual(loop_points(poly, poly.hole_i1(0), poly.hole_i2(0)),
		[[214, 270], [214, 500], [386, 500], [386, 270]])
})

check('floor height comes from the plan', () => {
	let h = house({floors: [{h: 300, lines: [rect_lines(0, 0, 600, 400)]}]})
	assert.equal(h.floors[0].h, 300)
	let [poly] = wall_polys_at(h, false, -14, -1)
	assert.deepEqual(outline_points(poly),
		[[-14, 0], [614, 0], [614, 300], [-14, 300]])
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

check('one floor has slab bottom, floor and wall tops', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 600, 400)]}]})
	assert.equal(house_polys(h)[1].length, 3)
	let outline = [[-14, -14], [614, -14], [614, 414], [-14, 414]]
	let room = [[4, 4], [596, 4], [596, 396], [4, 396]]
	for (let [z, normal, ps, hole_n] of [
		[  0, -1, outline, 0],
		[ 20,  1, room, 0],
		[250,  1, outline, 1],
	]) {
		let [poly, ...rest] = horizontal_polys_at(h, z, normal)
		assert.equal(rest.length, 0)
		assert.deepEqual(outline_points(poly), ps)
		assert.equal(poly.hole_count(), hole_n)
	}
})

check('an open room has no floor and no ceiling below it', () => {
	let h = open_room_house([{x: 100, y: 200, is_open: true}])
	assert.equal(horizontal_polys_at(h, 250, -1).length, 0)
	assert.equal(horizontal_polys_at(h, 250,  1).length, 0)
	assert.equal(horizontal_polys_at(h, 270,  1).length, 0)
	assert.equal(house_polys(h)[1].length, 3)
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
		{lines: [rect_lines(0, 0, 600, 400)],
			area_points: [{x: 450, y: 200, kind: 'terrace'}]},
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
		{lines: [rect_lines(0, 0, 600, 400)],
			area_points: [{x: 450, y: 200, kind: 'terrace'}]},
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
		[[-14, 0], [614, 0], [614, 500], [-14, 500]])
})

check('removing the top floor lowers the walls', () => {
	let h = house(ctx.house_test_plans.simple)
	h.add_floor()
	h.remove_top_floor()
	assert.equal(h.floors.length, 1)
	assert.equal(h.h, 250)
	let [poly] = wall_polys_at(h, true, -14, -1)
	assert.equal(outline_points(poly)[2][1], 250)
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

check('load_state is one undoable edit that keeps older history valid', () => {
	let h = house(ctx.house_test_plans.gable1)
	let before = JSON.stringify(h.save_state())
	h.floors[0].delete_seg(h.floors[0].segs[0])
	let edited = JSON.stringify(h.save_state())
	let state = house(ctx.house_test_plans.simple).save_state()
	let loaded = JSON.stringify(state)
	let edit_no = h.edit_no
	h.load_state(JSON.parse(loaded))
	assert.equal(h.edit_no, edit_no + 1)
	assert.equal(JSON.stringify(h.save_state()), loaded)
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), edited)
	assert(h.undo()) // the edit made before the load
	assert.equal(JSON.stringify(h.save_state()), before)
	assert(h.redo())
	assert(h.redo())
	assert.equal(JSON.stringify(h.save_state()), loaded)
	assert.equal(h.redo(), false)
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
	assert.equal(h.undo(), false)
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
	// outer skin: x -14..614, y -14..414, 45 deg: the ridge is half the
	// width above the wall top; the eaves are 60 out and 60 lower; the
	// gables are 60 out too.
	let wall_z = f.z + f.h
	assert.deepEqual(roof_z_range(faces), [wall_z - 60, wall_z + 214])
	let x1 = 1/0, y1 = 1/0, x2 = -1/0, y2 = -1/0
	for (let face of faces)
		for (let [x, y] of face.rings[0]) {
			x1 = Math.min(x1, x); y1 = Math.min(y1, y)
			x2 = Math.max(x2, x); y2 = Math.max(y2, y)
		}
	assert.deepEqual([x1, y1, x2, y2], [-74, -74, 674, 474])
})

check('two edge points on one side: the roof pitch', () => {
	let state = JSON.parse(JSON.stringify(ctx.house_test_plans.gable1))
	state.floors[2].roof.edge_points.push({x: 0, y: 100, pitch: 90})
	let f = house(state).floors[2]
	let faces = f.make_roof_faces(f.make_areas())
	assert.equal(faces.length, 3) // left side sloped, right side vertical
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

// floor 0: x 0..600; floor 1: x 0..300 on top of it.
function lean_to_house(area_points) {
	return house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)], area_points: area_points},
		{lines: [rect_lines(0, 0, 300, 400)]},
	]})
}

check('a lower floor sticking out: a roof against the upper wall', () => {
	let h = lean_to_house()
	let [f0, f1] = h.floors
	let areas = f0.make_areas()
	assert.equal(areas.length, 1)
	assert.equal(areas[0].kind, 'roof')
	let faces = f0.make_roof_faces(areas)
	// eaves north, east and south move out by 60; the side on the upper
	// floor's outer skin, x = 314, stays: no face rises from it.
	assert.equal(faces.length, 3)
	assert.deepEqual(faces_bbox(faces), [314, -74, 674, 474])
	let wall_z = f0.z + f0.h
	let [z1, z2] = roof_z_range(faces)
	assert(Math.abs(z1 - (wall_z - 60 * Math.tan(20 * Math.PI / 180))) < 1e-9)
	assert(Math.abs(z2 - (wall_z + 214 * Math.tan(20 * Math.PI / 180))) < 1e-9)
	// slab 1 leaves out the roof: its top shows in the upper room only.
	let all_faces = h.make_faces(f1, false)
	let [slab_top, ...rest] = up_faces_at(all_faces, f1.z + h.slab_thickness)
	assert.equal(rest.length, 0)
	assert.deepEqual(faces_bbox([slab_top]), [4, 4, 296, 396])
	// floor 0's outer wall under the roof rises to the roof underside.
	let [poly] = all_faces.map(face_poly).filter(poly =>
		poly.is_v && poly.axis == 614 && poly.normal == 1)
	let d = h.roof_thickness / Math.cos(20 * Math.PI / 180)
	assert(Math.abs(Math.max(...outline_points(poly).map(p => p[1]))
		- (wall_z - d)) < .002)
})

check('a lower floor sticking out: a terrace', () => {
	let h = lean_to_house([{x: 450, y: 200, kind: 'terrace'}])
	let [f0, f1] = h.floors
	let areas = f0.make_areas()
	assert.equal(areas.length, 1)
	assert.equal(areas[0].kind, 'terrace')
	let faces = h.make_faces(f1, false)
	// the roof is the upper floor's only: x -74..374.
	assert.deepEqual(faces_bbox(faces.filter(face => face.tag == 'roof')),
		[-74, -74, 374, 474])
	// slab 1 top: the upper room floor and the terrace.
	let slab_tops = up_faces_at(faces, f1.z + h.slab_thickness)
	assert.deepEqual([...slab_tops].map(face => [...faces_bbox([face])]).sort(),
		[[314, -14, 614, 414], [4, 4, 296, 396]])
})

check('the upper roof overhangs the lower roof', () => {
	let h = lean_to_house()
	let [f0, f1] = h.floors
	let upper_faces = f1.make_roof_faces(f1.make_areas())
	assert.deepEqual(faces_bbox(upper_faces), [-74, -74, 374, 474])
	let faces = h.make_faces(f1, false)
	assert.deepEqual(faces_bbox(faces.filter(face => face.tag == 'roof')),
		[-74, -74, 674, 474])
})

// floor 1 covers the north-east corner of floor 0 and sticks out north:
// floor 0's north side runs on from its outline to floor 1's wall.
check('an eave side runs on into a wall side', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 600, 400)]},
		{lines: [rect_lines(300, 200, 300, 400)]},
	]})
	let [f0, f1] = h.floors
	let areas = f0.make_areas()
	assert.equal(areas.length, 1)
	let faces = f0.make_roof_faces(areas)
	assert(faces.length > 0)
	h.make_faces(f1, false)
})

check('the roof is in the floor state: add_floor and undo keep it', () => {
	let h = house(ctx.house_test_plans.gable1)
	let roof = JSON.stringify(h.floors[2].roof)
	let f = h.add_floor()
	assert.equal(JSON.stringify(f.roof), roof)
	let ds = draw_state()
	let r = f.start_move_seg(f.segs.find(s => !s.is_v && s.axis == 240), ds)
	r.move(0, 50, ds)
	r.stop(ds)
	assert(h.undo())
	assert.equal(JSON.stringify(f.roof), roof)
})

console.log(n_checks + ' house plan checks passed')
