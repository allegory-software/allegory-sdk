// run: node tests/house_plan_test.js
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const sdk = path.resolve(__dirname, '..')
const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
let files = ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js',
	'house_plan_objects.js', 'house_plan.js']
for (let name of files) {
	// env SDK=dir loads dir/www/roof_skeleton.js instead (a changed copy).
	let file = path.join(name == 'roof_skeleton.js' && process.env.SDK || sdk,
		'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

// everything is in mm.
function house(t) {
	return ctx.house_plan({version: 1, ...t})
}

function floor(lines) {
	return house({floors: [{lines}]}).floors[0]
}

let n_checks = 0
function check(name, f) {
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
	let f = floor([[null, [0, 0], [1000, 0]]])
	let r = f.start_resize_seg(null, 3000, 3000, 200, 0, 1, 0)
	assert.equal(r.resize(200, 0, 20), r.seg[1])
	assert.equal(r.seg.m1, 3000)
	assert.equal(r.seg.m2, 3200)
	r.resize(400, 0, 20)
	assert.equal(r.seg.m2, 3400)
	r.stop()
})

check('detached endpoint uses its original position', () => {
	let f = floor([['connect', [0, 0], [1000, 0], [1000, 1000]]])
	let p = f.ps.find(p => p[0] == 1000 && p[1] == 0)
	let r = f.start_resize_seg(p, 1000, 0, -200, 0, -1, 0)
	r.resize(-200, 0, 20)
	assert.equal(r.seg.m2, 800)
	r.resize(-400, 0, 20)
	assert.equal(r.seg.m2, 600)
	r.stop()
})

check('existing free endpoint uses its original position', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let p = f.ps.find(p => p[0] == 1000)
	let r = f.start_resize_seg(p, 1000, 0, 200, 0, 1, 0)
	assert.equal(r.resize(200, 0), p)
	assert.equal(p[0], 1200)
	r.stop()
})

// collapsed-wall preview ---------------------------------------------------

check('collapsing a free wall keeps finite bounds and allows extending', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let created = f.start_resize_seg(null, 4000, 2000, 600, 0, 1, 0)
	created.resize(600, 0)
	created.stop()
	let p = f.ps.find(p => p[0] == 4000 && p[1] == 2000)
	let r = f.start_resize_seg(p, 4000, 2000, 600, 0, 1, 0)
	r.resize(600, 0)
	assert.equal(r.seg.m1, r.seg.m2)
	for (let m of f.house.bb)
		assert(Number.isFinite(m), 'infinite house bounds')
	for (let c of f.comps)
		assert(c.outer_cycle.edges.length > 0, 'empty wall outline')
	r.resize(800, 0, 20)
	assert.equal(p[0], 4800)
	assert.equal(r.seg.m2 - r.seg.m1, 200)
	for (let m of f.house.bb)
		assert(Number.isFinite(m))
	r.stop()
})

// resize previews without cleanup -----------------------------------------

check('overlapping walls stay separate until release', () => {
	let f = floor([[null, [0, 0], [10000, 0]]])
	let before = geometry(f)
	let seg = f.segs[0]
	let fix = f.fix
	let n_fix = 0
	f.fix = function() {
		n_fix++
		return fix.call(this)
	}
	let r = f.start_resize_seg(null, 5000, 0, 400, 0, 1, 0)
	for (let dx of [400, 1000, 2000]) {
		r.resize(dx, 0)
		assert.equal(n_fix, 0)
		assert.equal(f.segs.length, 2)
		assert.equal(f.ps.length, 4)
		assert(f.segs.includes(seg))
		assert(f.segs.includes(r.seg))
		assert.equal(seg.m1, 0)
		assert.equal(seg.m2, 10000)
		assert.equal(r.seg.m2, 5000 + dx)
		let co = f.comps.find(co => co.segs.includes(r.seg))
		assert(co.outer_cycle.edges.length > 0)
		assert(co.outer_cycle.edges.bbox()[2] >= r.seg.m2)
	}
	r.stop()
	assert.equal(n_fix, 1)
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
})

check('overlapping extension commits once and supports undo and redo', () => {
	let f = floor([[null, [0, 0], [10000, 0]]])
	let before = geometry(f)
	let r = f.start_resize_seg(null, 5000, 0, 400, 0, 1, 0)
	r.resize(6000, 0)
	assert.equal(f.segs.length, 2)
	assert(f.segs.includes(r.seg))
	r.stop()
	assert.equal(f.segs.length, 1)
	assert.equal(f.segs[0].m2, 11000)
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('cancelling an overlapping extension restores its starting geometry',
	() => {
	let f = floor([[null, [0, 0], [10000, 0]]])
	let before = geometry(f)
	let r = f.start_resize_seg(null, 5000, 0, 400, 0, 1, 0)
	r.resize(6000, 0)
	assert(f.segs.includes(r.seg))
	r.cancel()
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
})

check('a detached junction endpoint can collapse on the first resize step',
	() => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	let p = f.ps_ids.get('cl')
	let r = f.start_resize_seg(p, 2000, 0, -2000, 0, -1, 0)
	assert.equal(r.seg.m2, 2000)
	r.resize(-2000, 0)
	assert(f.segs.includes(r.seg))
	assert.equal(r.seg.m1, r.seg.m2)
	for (let m of f.house.bb)
		assert(Number.isFinite(m))
	r.resize(-800, 0, 20)
	assert.equal(r.seg.m2, 1200)
	r.stop()
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

// resize snapping and limits -----------------------------------------------

check('vertical endpoint does not snap to x coordinates', () => {
	let f = floor([
		[null, [1000, 0], [1000, 1000]],
		[null, [1800, 5000], [1800, 6000]],
	])
	let p = f.ps.find(p => p[0] == 1000 && p[1] == 1000)
	let r = f.start_resize_seg(p, 1000, 1000, 0, 0, 0, 1)
	r.resize(0, 900)
	assert.equal(p[1], 1900)
	assert.equal(r.snap_a, null)
	assert.equal(r.snap_v, false)
	r.stop()
})

for (let ctrl of [false, true]) {
	check('vertical endpoint snaps to y coordinates, ctrl=' + ctrl, () => {
		let f = floor([
			[null, [1000, 0], [1000, 1000]],
			[null, [1800, 2000], [1800, 6000]],
		])
		let p = f.ps.find(p => p[0] == 1000 && p[1] == 1000)
		let r = f.start_resize_seg(p, 1000, 1000, 0, 0, 0, 1)
		r.resize(0, 900, ctrl ? 20 : 300)
		assert.equal(p[1], ctrl ? 1900 : 2000)
		assert.equal(r.snap_a, ctrl ? null : 2000)
		assert.equal(r.snap_v, false)
		r.stop()
	})
}

check('a wall endpoint snaps to the wall\'s other end: the wall goes away',
	() => {
	let f = floor([
		[null, [0, 0], [3000, 0]],
		[null, [1000, 1000], [1000, 3000]],
	])
	let p = f.ps.find(p => p[0] == 1000 && p[1] == 3000)
	let r = f.start_resize_seg(p, 1000, 3000, 0, -1000, 0, -1)
	r.resize(0, -1900, 300)
	assert.equal(p[1], 1000)
	assert.equal(r.snap_a, 1000)
	r.stop()
	assert.equal(f.segs.length, 1)
	assert(!f.ps.find(p => p[0] == 1000))
	r = f.start_resize_seg(null, 5000, 5000, 0, 1000, 0, 1)
	r.resize(0, 1000, 300)
	r.resize(0, 100, 300)
	assert.equal(r.seg.m1, r.seg.m2)
	assert.equal(r.snap_a, 5000)
	r.stop()
	assert.equal(f.segs.length, 1)
})

check('vertical endpoint stops at a blocking wall', () => {
	let f = floor([
		[null, [1000, 0], [1000, 1000]],
		[null, [0, 2500], [3000, 2500]],
	])
	let p = f.ps.find(p => p[0] == 1000 && p[1] == 1000)
	let r = f.start_resize_seg(p, 1000, 1000, 0, 0, 0, 1)
	r.resize(0, 4000)
	assert.equal(p[1], 2500)
	r.stop()
})

for (let v of [false, true])
	for (let direction of [-1, 1])
		for (let first_delta of [200, 2000]) {
			let name = 'new wall collision, vertical=' + v
				+ ', direction=' + direction + ', first_delta=' + first_delta
			check(name, () => {
				let wall
				if (v)
					wall = [null, [0, 2500], [3000, 2500]]
				else
					wall = [null, [2500, 0], [2500, 3000]]
				let f = floor([wall])
				let m0 = direction > 0 ? 1000 : 4000
				let x0 = v ? 1500 : m0
				let y0 = v ? m0 : 1500
				let d0 = direction * first_delta
				let dx0 = v ? 0 : d0
				let dy0 = v ? d0 : 0
				let r = f.start_resize_seg(null, x0, y0, dx0, dy0,
					v ? 0 : direction, v ? direction : 0)
				let d = direction * 2000
				r.resize(v ? 0 : d, v ? d : 0)
				assert.equal(r.seg[1][v ? 1 : 0], 2500)
				r.resize(0, 0)
				assert.equal(r.seg[1][v ? 1 : 0], m0)
				r.cancel()
			})
		}

// free-wall snapping and preview -------------------------------------------

for (let ctrl of [false, true]) {
	check('free-wall movement and outline, ctrl=' + ctrl, () => {
		let f = floor([
			[null, [0, 0], [1000, 0]],
			[null, [0, 2000], [1000, 2000]],
		])
		let s = f.segs.find(s => s.axis == 0)
		let c = f.comps.find(c => c.segs.includes(s)).outer_cycle
		let y1 = c.edges.bbox()[1]
		let r = f.start_move_seg(s)
		r.move(0, 1900, ctrl ? 20 : 200)
		let dy = ctrl ? 1900 : 2000
		assert.equal(r.snap_a, undefined)
		assert.equal(r.snap_v, false)
		assert.equal(s.axis, dy)
		assert.equal(c.edges.bbox()[1], y1 + dy)
		r.stop()
	})
	check('free-wall endpoints snap while preserving length, ctrl=' + ctrl,
		() => {
		let f = floor([
			[null, [0, 0], [1000, 0]],
			[null, [2000, 2000], [3500, 2000]],
		])
		let s = f.segs.find(s => s.axis == 0)
		let r = f.start_move_seg(s)
		r.move(1900, 0, ctrl ? 20 : 200)
		assert.equal(s.m1, ctrl ? 1900 : 2000)
		assert.equal(s.m2 - s.m1, 1000)
		r.stop()
	})
}

for (let v of [false, true])
	for (let reverse of [false, true]) {
		let name = 'free-wall endpoint identity, vertical=' + v
			+ ', reversed=' + reverse
		check(name, () => {
			let a = [0, 0]
			let b = v ? [0, 1000] : [1000, 0]
			let f = floor([[null, reverse ? b : a, reverse ? a : b]])
			let before = geometry(f)
			let seg = f.segs[0]
			let p1 = seg[0]
			let p2 = seg[1]
			let a0 = [...p1]
			let b0 = [...p2]
			let r = f.start_move_seg(seg)
			r.move(0, 0)
			r.stop()
			assert.equal(geometry(f), before)
			assert.equal(f.house.undo(), false)
			r = f.start_move_seg(seg)
			r.move(300, 400)
			assert.equal(seg[0], p1)
			assert.equal(seg[1], p2)
			assert.deepEqual([...p1], [a0[0] + 300, a0[1] + 400])
			assert.deepEqual([...p2], [b0[0] + 300, b0[1] + 400])
			r.stop()
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
				[null, [0, 1000], [0, 0]],
				[null, [2000, 2000], [2000, 3500]],
			])
		else
			f = floor([
				[null, [1000, 0], [0, 0]],
				[null, [2000, 2000], [3500, 2000]],
			])
		let seg = f.segs.find(seg => seg.axis == 0)
		let r = f.start_move_seg(seg)
		r.move(v ? 0 : 1900, v ? 1900 : 0)
		assert.equal(seg[0][v ? 1 : 0], 3000)
		assert.equal(seg[1][v ? 1 : 0], 2000)
		assert.equal(seg.m2 - seg.m1, 1000)
		r.stop()
	})
}

// outlines after moving an exterior wall ------------------------------------

for (let y of [0, 4000])
	for (let dy of [-1000, 1000]) {
		check('exterior wall outlines y=' + y + ', dy=' + dy, () => {
			let f = house(ctx.house_test_plans.simple).floors[0]
			let s = f.segs.find(s => !s.is_v && s.axis == y && s.m1 == 2000)
			let r = f.start_move_seg(s)
			r.move(0, dy)
			r.stop()
			let connector = f.segs.find(s => s.is_v && s.axis == 2000
				&& s.m1 == Math.min(y, y+dy) && s.m2 == Math.max(y, y+dy))
			assert(connector)
			let r1 = f.start_move_seg(connector)
			for (let dx of [0, 400]) {
				r1.move(dx, 0)
				for (let c of f.comps)
					for (let cy of c.cycles)
						for (let i = 0; i < cy.edges.length; i++) {
							let a = cy.edges[i]
							let b = cy.edges[(i+1) % cy.edges.length]
							assert(a[0] == b[0] || a[1] == b[1],
								'diagonal outline: ' + a + ' to ' + b)
						}
			}
			r1.stop()
		})
	}

// connected-wall snapping and deletion -------------------------------------

for (let ctrl of [false, true]) {
	check('connected-wall movement, ctrl=' + ctrl, () => {
		let f = house(ctx.house_test_plans.simple).floors[0]
		let s = f.segs.find(s => s.is_v && s.axis == 2000)
		let r = f.start_move_seg(s)
		r.move(150, 0, ctrl ? 20 : 200)
		assert.equal(s.axis, ctrl ? 2150 : 2000)
		assert.equal(r.snap_a, ctrl ? null : 2000)
		assert.equal(r.snap_v, true)
		r.stop()
	})
}

check('deleting a wall through the move callback', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let s = f.segs.find(s => s.is_v && s.axis == 2000)
	f.start_move_seg(s).stop(true)
	assert.equal(f.segs.length, 4)
	assert.equal(f.comps[0].cycles.length, 2)
})

// empty floors -------------------------------------------------------------

check('empty floors do not expand the house bounds', () => {
	let h = house({floors: [
		{lines: []},
		{lines: [[null, [0, 0], [1000, 0]]]},
	]})
	assert.deepEqual([...h.bb], [-140, -140, 1140, 140])
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
		f.delete_seg(f.segs.find(s => s.is_v && s.axis == 2000))
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
	let r = f.start_move_seg(f.segs.find(s => s.is_v && s.axis == 2000))
	r.move(500, 0)
	r.stop()
	assert(f.house.undo())
	assert(f.house.redo())
	r = f.start_move_seg(f.segs[0])
	r.move(0, 500)
	r.cancel()
	assert.equal(f.editor, editor)
	assert.equal(editor.floor, f)
})

check('a whole drag is one undo step with stable IDs', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	let s = f.segs.find(s => s.is_v && s.axis == 2000)
	let r = f.start_move_seg(s)
	for (let dx of [300, 400, 500])
		r.move(dx, 0)
	r.stop()
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
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let p = f.ps.find(p => p[0] == 1000)
	let r = f.start_resize_seg(p, 1000, 0, 200, 0, 1, 0)
	r.resize(400, 0)
	r.stop()
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('new walls can be undone and redone', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let r = f.start_resize_seg(null, 3000, 3000, 200, 0, 1, 0)
	r.resize(400, 0)
	r.stop()
	let after = geometry(f)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('deletion undo restores rooms and connections', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let before = geometry(f)
	f.delete_seg(f.segs.find(s => s.is_v && s.axis == 2000))
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
	let before = geometry(f)
	let s = f.segs.find(s => !s.is_v && s.axis == 0 && s.m1 == 2000)
	let r = f.start_move_seg(s)
	r.move(0, 1000)
	r.cancel()
	assert.equal(geometry(f), before)
	assert.equal(f.comps[0].ps.length, f.ps.length)
	assert.equal(f.comps[0].segs.length, f.segs.length)
	assert.equal(f.house.undo(), false)
})

check('cancelled wall creation restores the starting geometry', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let r = f.start_resize_seg(null, 3000, 3000, 200, 0, 1, 0)
	r.resize(400, 0)
	r.cancel()
	assert.equal(geometry(f), before)
	assert.equal(f.house.undo(), false)
})

check('new edits discard redo history', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	let r = f.start_move_seg(f.segs[0])
	r.move(0, 500)
	r.stop()
	assert(f.house.undo())
	r = f.start_move_seg(f.segs[0])
	r.move(0, 800)
	r.stop()
	assert.equal(f.house.redo(), false)
	assert(f.house.undo())
	assert.equal(geometry(f), before)
})

check('unchanged and cancelled edits preserve redo', () => {
	let f = house(ctx.house_test_plans.simple).floors[0]
	let s = f.segs.find(s => s.is_v && s.axis == 2000)
	let r = f.start_move_seg(s)
	r.move(500, 0)
	r.stop()
	let after = geometry(f)
	assert(f.house.undo())
	s = f.segs.find(s => !s.is_v && s.axis == 0 && s.m1 == 2000)
	r = f.start_move_seg(s)
	r.move(0, 0)
	r.stop()
	r = f.start_move_seg(f.segs[0])
	r.move(0, 500)
	r.cancel()
	assert(f.house.redo())
	assert.equal(geometry(f), after)
})

check('house undo preserves the other floors', () => {
	let h = house({floors: [
		{lines: [[null, [0, 0], [1000, 0]]]},
		{lines: [[null, [0, 2000], [1000, 2000]]]},
	]})
	let f = h.floors[0]
	let before = geometry(f)
	let other = geometry(h.floors[1])
	let r = f.start_move_seg(f.segs[0])
	r.move(0, 500)
	r.stop()
	assert(f.house.undo())
	assert.equal(geometry(f), before)
	assert.equal(geometry(h.floors[1]), other)
})

check('the last wall survives repeated deletion undo and redo', () => {
	let f = floor([[null, [0, 0], [1000, 0]]])
	let before = geometry(f)
	f.delete_seg(f.segs[0])
	for (let i = 0; i < 3; i++) {
		assert.equal(f.ps.length, 0)
		assert.equal(f.segs.length, 0)
		assert(f.house.bb[0] > f.house.bb[2])
		assert(f.house.undo())
		assert.equal(geometry(f), before)
		assert.deepEqual([...f.house.bb], [-140, -140, 1140, 140])
		assert(f.house.redo())
	}
})

check('house snapshots round-trip every floor and roof', () => {
	let h = house(ctx.house_test_plans.gable1)
	let saved = JSON.stringify(h.save_state())
	let h1 = house(JSON.parse(saved))
	assert.equal(JSON.stringify(h1.save_state()), saved)
	let state = h.save_state()
	state.floors[0].points[0][0] += 1000
	state.floors[2].roof.edge_points[0].x += 1000
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
	let drag = f.start_move_seg(f.segs[0])
	drag.move(0, 500)
	drag.cancel()
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
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1, h.floors[0])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 2500], [-140, 2500]])
	assert.deepEqual([...poly.holes], [])
})

// gable1 cut at its top floor: without the roof.
check('exterior skins of stacked floors merge into one polygon', () => {
	let h = house(ctx.house_test_plans.gable1)
	let [poly, ...rest] = wall_polys_at(h, true, -140, -1, h.floors[2])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [4140, 0], [4140, 7500], [-140, 7500]])
})

check('the gable wall rises to the roof underside', () => {
	let h = house(ctx.house_test_plans.gable1)
	let faces = h.make_faces(h.floors[2], false)
	let walls = faces.filter(face => face.tag == 'walls')
	let roofs = faces.filter(face => face.tag == 'roof')
	assert(roofs.length > 0)
	let [poly, ...rest] = walls.map(face_poly).filter(poly =>
		poly.is_v && poly.axis == -140 && poly.normal == -1)
	assert.equal(rest.length, 0)
	// 45 deg, 200 thick: the underside is 200*sqrt(2) below the top, which
	// starts at 7500 on the outer skin and peaks at the ridge, y = 2000.
	let d = 200 * Math.SQRT2
	let ps = outline_points(poly)
	let ps1 = [[-140, 0], [4140, 0], [4140, 7500 - d], [2000, 9640 - d],
		[-140, 7500 - d]]
	assert.equal(ps.length, ps1.length)
	for (let i = 0; i < ps.length; i++)
		for (let k = 0; k < 2; k++)
			assert(Math.abs(ps[i][k] - ps1[i][k]) <= .02, JSON.stringify(ps))
})

check('room skins of floors with a slab between them stay separate', () => {
	let h = house(ctx.house_test_plans.gable1)
	let polys = wall_polys_at(h, true, 40, 1, h.floors[2])
	assert.equal(polys.length, 4)
	for (let poly of polys)
		assert.equal(poly.point_count(), 4)
})

// a terrace on the lower floor, cut at the top floor: without roofs.
check('a smaller upper floor makes a stepped polygon', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)],
			area_points: [{x: 4500, y: 2000, kind: 'terrace'}]},
		{lines: [rect_lines(0, 0, 3000, 4000)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1, h.floors[1])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly), [
		[-140, 0], [6140, 0], [6140, 2700], [3140, 2700], [3140, 5000],
		[-140, 5000]])
	let [side] = wall_polys_at(h, true, 3140, 1, h.floors[1])
	assert.deepEqual(outline_points(side),
		[[-140, 2700], [4140, 2700], [4140, 5000], [-140, 5000]])
})

check('a gap between two floors makes a hole', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)],
			area_points: [{x: 3000, y: 2000, kind: 'terrace'}]},
		{lines: [rect_lines(0, 0, 2000, 4000), rect_lines(4000, 0, 2000, 4000)]},
		{lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 7500], [-140, 7500]])
	assert.equal(poly.hole_count(), 1)
	assert.deepEqual(loop_points(poly, poly.hole_i1(0), poly.hole_i2(0)),
		[[2140, 2700], [2140, 5000], [3860, 5000], [3860, 2700]])
})

check('floor height comes from the plan', () => {
	let h = house({floors: [{h: 3000, lines: [rect_lines(0, 0, 6000, 4000)]}]})
	assert.equal(h.floors[0].h, 3000)
	let [poly] = wall_polys_at(h, false, -140, -1)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 3000], [-140, 3000]])
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
	let lines = [rect_lines(0, 0, 6000, 4000)]
	if (island_lines)
		lines.push(island_lines)
	return house({floors: [
		{lines: lines},
		{lines: lines, room_points: upper_room_points},
	]})
}

check('an open room merges its skins with the room below', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = wall_polys_at(h, true, 40, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[40, 200], [3960, 200], [3960, 5000], [40, 5000]])
})

check('a closed room point keeps the slab', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: false}])
	assert.equal(open_room_count(h.floors[1]), 0)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 2)
})

check('a room with two points stays closed', () => {
	let h = open_room_house([
		{x: 1000, y: 2000, is_open: true},
		{x: 5000, y: 2000, is_open: true},
	])
	assert.equal(open_room_count(h.floors[1]), 0)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 2)
})

check('a room point in a wall body opens no room', () => {
	let h = open_room_house([{x: 0, y: 2000, is_open: true}])
	assert.equal(open_room_count(h.floors[1]), 0)
})

check('an island in an open room keeps a slab piece under it', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}],
		rect_lines(2000, 1000, 1000, 1000))
	let [poly, ...rest] = wall_polys_at(h, true, 1960, -1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[960, 200], [2040, 200], [2040, 5000], [960, 5000]])
})

check('room points are saved and loaded', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	let floor = h.floors[1]
	let state = floor.save_state()
	assert.equal(JSON.stringify(state.room_points),
		JSON.stringify([{x: 1000, y: 2000, is_open: true}]))
	assert.notEqual(state.room_points[0], floor.room_points[0])
	floor.load_state({...state, room_points: []})
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 2)
	floor.load_state(state)
	assert.equal(open_room_count(floor), 1)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 1)
	assert.equal(JSON.stringify(h.save_state().floors[1].room_points),
		JSON.stringify(state.room_points))
})

check('an edit undo restores the open rooms', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	let floor = h.floors[1]
	let seg = floor.segs.find(seg => seg.is_v && seg.axis == 0)
	let mover = floor.start_move_seg(seg)
	mover.move(1500, 0)
	mover.stop()
	assert.equal(open_room_count(floor), 0) // the point is outside now.
	assert(h.undo())
	assert.equal(open_room_count(floor), 1)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 1)
})

check('adding a floor copies the room points', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	let floor = h.add_floor()
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify(h.floors[1].room_points))
	assert.notEqual(floor.room_points[0], h.floors[1].room_points[0])
	assert.equal(open_room_count(floor), 1)
	let [poly, ...rest] = wall_polys_at(h, true, 40, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[40, 200], [3960, 200], [3960, 7500], [40, 7500]])
})

check('toggling a room with no point adds an open point', () => {
	let h = open_room_house([])
	let floor = h.floors[1]
	let edit_no = h.edit_no
	floor.toggle_room(floor.hit_cycle_edges(1000, 2000), 1000, 2000)
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify([{x: 1000, y: 2000, is_open: true}]))
	assert.equal(open_room_count(floor), 1)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 1)
	assert.equal(h.edit_no, edit_no + 1)
	assert(h.undo())
	assert.equal(floor.room_points.length, 0)
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 2)
	assert(h.redo())
	assert.equal(open_room_count(floor), 1)
})

check('toggling a room with one point flips the point', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	let floor = h.floors[1]
	floor.toggle_room(floor.hit_cycle_edges(3000, 1000), 3000, 1000)
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify([{x: 1000, y: 2000, is_open: false}]))
	assert.equal(open_room_count(floor), 0)
	assert.equal(wall_polys_at(h, true, 40, 1).length, 2)
	assert(h.undo())
	assert.equal(floor.room_points[0].is_open, true)
	assert.equal(open_room_count(floor), 1)
})

check('toggling a room with two points does nothing', () => {
	let h = open_room_house([
		{x: 1000, y: 2000, is_open: true},
		{x: 5000, y: 2000, is_open: true},
	])
	let floor = h.floors[1]
	let c = floor.hit_cycle_edges(1000, 2000)
	assert.equal(floor.room_point_by_cycle.get(c), null)
	let edit_no = h.edit_no
	floor.toggle_room(c, 3000, 1000)
	assert.equal(h.edit_no, edit_no)
	assert.equal(h.undo(), false)
	assert.equal(floor.room_points[0].is_open, true)
	assert.equal(floor.room_points[1].is_open, true)
})

check('removing a room point closes its room', () => {
	let h = open_room_house([
		{x: 1000, y: 2000, is_open: true},
		{x: 5000, y: 2000, is_open: true},
	])
	let floor = h.floors[1]
	floor.remove_room_point(floor.room_points[1])
	assert.equal(JSON.stringify(floor.room_points),
		JSON.stringify([{x: 1000, y: 2000, is_open: true}]))
	assert.equal(open_room_count(floor), 1) // no conflict anymore.
	assert(h.undo())
	assert.equal(floor.room_points.length, 2)
	assert.equal(open_room_count(floor), 0)
})

check('moving a room point into a wall closes its room', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	let floor = h.floors[1]
	let mover = floor.start_move_room_point(floor.room_points[0])
	mover.move(-1000, 0)
	assert.equal(open_room_count(floor), 0)
	mover.stop()
	assert.equal(floor.room_points[0].x, 0)
	assert.equal(open_room_count(floor), 0)
	assert(h.undo())
	assert.equal(floor.room_points[0].x, 1000)
	assert.equal(open_room_count(floor), 1)
})

check('wall movement updates room centers and open rooms during preview',
() => {
	let h = house({floors: [{
		lines: [rect_lines(0, 0, 6000, 4000),
			[null, [2000, 0], [2000, 4000]]],
		room_points: [{x: 2500, y: 2000, is_open: true}],
	}]})
	let floor = h.floors[0]
	let left = floor.hit_cycle_edges(1000, 2000)
	let right = floor.hit_cycle_edges(4000, 2000)
	assert.deepEqual(Array.from(left.center()), [1000, 2000])
	assert.deepEqual(Array.from(right.center()), [4000, 2000])
	let seg = floor.segs.find(seg => seg.is_v && seg.axis == 2000)
	let mover = floor.start_move_seg(seg)
	mover.move(1000, 0)
	assert.deepEqual(Array.from(left.center()), [1500, 2000])
	assert.deepEqual(Array.from(right.center()), [4500, 2000])
	assert.equal(floor.room_point_by_cycle.get(left), floor.room_points[0])
	assert.equal(floor.room_point_by_cycle.has(right), false)
	mover.cancel()
	assert.equal(open_room_count(floor), 1)
	assert.equal(h.undo(), false)
})

check('wall resize keeps open rooms assigned to the preview cycles', () => {
	let h = house({floors: [{
		lines: [rect_lines(0, 0, 6000, 4000),
			[null, [2000, 0], [2000, 4000]]],
		room_points: [{x: 2500, y: 2000, is_open: true}],
	}]})
	let floor = h.floors[0]
	let p = floor.ps.find(p => p[0] == 6000 && p[1] == 4000)
	let resize = floor.start_resize_seg(p, 6000, 4000, 0, 500, 0, 1)
	let room = floor.hit_cycle_edges(2500, 2000)
	assert(room)
	assert.equal(floor.room_point_by_cycle.get(room), floor.room_points[0])
	resize.resize(0, 500)
	room = floor.hit_cycle_edges(2500, 2000)
	assert(room)
	assert.equal(floor.room_point_by_cycle.get(room), floor.room_points[0])
	resize.cancel()
	assert.equal(open_room_count(floor), 1)
	assert.equal(h.undo(), false)
})

check('moving a room point updates conflicts during preview', () => {
	let h = house({floors: [{
		lines: [rect_lines(0, 0, 6000, 4000),
			[null, [2000, 0], [2000, 4000]]],
		room_points: [{x: 1000, y: 2000, is_open: true},
			{x: 2500, y: 2000, is_open: true}],
	}]})
	let floor = h.floors[0]
	let left = floor.hit_cycle_edges(1000, 2000)
	let right = floor.hit_cycle_edges(4000, 2000)
	assert.equal(open_room_count(floor), 2)
	let mover = floor.start_move_room_point(floor.room_points[1])
	mover.move(-1000, 0)
	assert.equal(floor.room_point_by_cycle.get(left), null)
	assert.equal(floor.room_point_by_cycle.has(right), false)
	assert.equal(open_room_count(floor), 0)
	mover.move(0, 0)
	assert.equal(open_room_count(floor), 2)
	mover.cancel()
	assert.equal(open_room_count(floor), 2)
	assert.equal(h.undo(), false)
})

check('cancelling a room point move restores it', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	let floor = h.floors[1]
	let mover = floor.start_move_room_point(floor.room_points[0])
	mover.move(-1000, 0)
	mover.cancel()
	assert.equal(floor.room_points[0].x, 1000)
	assert.equal(open_room_count(floor), 1)
	assert.equal(h.undo(), false)
})

check('a room point in an island wall body opens no room', () => {
	let h = open_room_house([{x: 2000, y: 1500, is_open: true}],
		rect_lines(2000, 1000, 1000, 1000))
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
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)]}]})
	assert.equal(house_polys(h)[1].length, 3)
	let outline = [[-140, -140], [6140, -140], [6140, 4140], [-140, 4140]]
	let room = [[40, 40], [5960, 40], [5960, 3960], [40, 3960]]
	for (let [z, normal, ps, hole_n] of [
		[   0, -1, outline, 0],
		[ 200,  1, room, 0],
		[2500,  1, outline, 1],
	]) {
		let [poly, ...rest] = horizontal_polys_at(h, z, normal)
		assert.equal(rest.length, 0)
		assert.deepEqual(outline_points(poly), ps)
		assert.equal(poly.hole_count(), hole_n)
	}
})

check('an open room has no floor and no ceiling below it', () => {
	let h = open_room_house([{x: 1000, y: 2000, is_open: true}])
	assert.equal(horizontal_polys_at(h, 2500, -1).length, 0)
	assert.equal(horizontal_polys_at(h, 2500,  1).length, 0)
	assert.equal(horizontal_polys_at(h, 2700,  1).length, 0)
	assert.equal(house_polys(h)[1].length, 3)
})

check('a wall under an open room gets a slab', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000), ['draw', 3000, 0, 0, 4000]]},
		{lines: [rect_lines(0, 0, 6000, 4000)],
			room_points: [{x: 1000, y: 2000, is_open: true}]},
	]})
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 2700, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[2960, 40], [3040, 40], [3040, 3960], [2960, 3960]])
	assert.equal(horizontal_polys_at(h, 2500, 1).length, 0)
	assert.equal(horizontal_polys_at(h, 2500, -1).length, 0)
})

check('an open room keeps a slab where it overflows the floor below', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 3000, 4000)]},
		{lines: [rect_lines(0, 0, 6000, 4000)],
			room_points: [{x: 1000, y: 2000, is_open: true}]},
	]})
	assert.equal(open_room_count(h.floors[1]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 2700, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[2960, 40], [5960, 40], [5960, 3960], [2960, 3960]])
})

check('an open room on the ground floor keeps its slab', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)],
			room_points: [{x: 1000, y: 2000, is_open: true}]},
	]})
	assert.equal(open_room_count(h.floors[0]), 1)
	let [poly, ...rest] = horizontal_polys_at(h, 200, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[40, 40], [5960, 40], [5960, 3960], [40, 3960]])
})

check('a smaller upper floor leaves a terrace and a ceiling', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)],
			area_points: [{x: 4500, y: 2000, kind: 'terrace'}]},
		{lines: [rect_lines(0, 0, 3000, 4000)]},
	]})
	// slab 1 top: the upper room floor and the terrace.
	let [terrace, room, ...rest] = horizontal_polys_at(h, 2700, 1)
		.sort((poly1, poly2) => poly2[0][0] - poly1[0][0])
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(terrace),
		[[3140, -140], [6140, -140], [6140, 4140], [3140, 4140]])
	assert.deepEqual(outline_points(room),
		[[40, 40], [2960, 40], [2960, 3960], [40, 3960]])
	// slab 1 bottom: the ground floor ceiling.
	let [ceiling, ...rest1] = horizontal_polys_at(h, 2500, -1)
	assert.equal(rest1.length, 0)
	assert.deepEqual(outline_points(ceiling),
		[[40, 40], [5960, 40], [5960, 3960], [40, 3960]])
})

check('a terrace slab side merges with the walls below it', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)],
			area_points: [{x: 4500, y: 2000, kind: 'terrace'}]},
		{lines: [rect_lines(0, 0, 3000, 4000)]},
	]})
	let [poly, ...rest] = wall_polys_at(h, true, 6140, 1)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [4140, 0], [4140, 2700], [-140, 2700]])
	assert.deepEqual([...poly.holes], [])
})

// cutting the house at a floor ----------------------------------------------

function two_floor_house() {
	return house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
}

function check_wall_caps(h, z, floor) {
	let [poly, ...rest] = horizontal_polys_at(h, z, 1, floor)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, -140], [6140, -140], [6140, 4140], [-140, 4140]])
	assert.deepEqual([...poly.holes], [4])
	assert.deepEqual(loop_points(poly, 4, 8),
		[[40, 40], [40, 3960], [5960, 3960], [5960, 40]])
}

check('a cut floor has wall caps and no slab on top', () => {
	let h = two_floor_house()
	let floor = h.floors[0]
	check_wall_caps(h, 2500, floor)
	assert.equal(horizontal_polys_at(h, 2500, -1, floor).length, 0)
	assert.equal(horizontal_polys_at(h, 2700,  1, floor).length, 0)
	assert.equal(house_polys(h, floor)[1].length, 3)
	let [poly, ...rest] = wall_polys_at(h, false, -140, -1, floor)
	assert.equal(rest.length, 0)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 2500], [-140, 2500]])
})

check('a cut keeps the floors below and their slabs', () => {
	let h = two_floor_house()
	let floor = h.floors[1]
	assert.equal(horizontal_polys_at(h, 2500, -1, floor).length, 1)
	assert.equal(horizontal_polys_at(h, 2700,  1, floor).length, 1)
	check_wall_caps(h, 5000, floor)
	assert.equal(horizontal_polys_at(h, 5200,  1, floor).length, 0)
	let [poly] = wall_polys_at(h, false, -140, -1, floor)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 5000], [-140, 5000]])
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
	assert.equal(h.h, 5000)
	let [poly] = wall_polys_at(h, false, -140, -1)
	assert.deepEqual(outline_points(poly),
		[[-140, 0], [6140, 0], [6140, 5000], [-140, 5000]])
})

check('removing the top floor lowers the walls', () => {
	let h = house(ctx.house_test_plans.simple)
	h.add_floor()
	h.remove_top_floor()
	assert.equal(h.floors.length, 1)
	assert.equal(h.h, 2500)
	let [poly] = wall_polys_at(h, true, -140, -1)
	assert.equal(outline_points(poly)[2][1], 2500)
})

check('adding and removing floors is undoable', () => {
	let h = house(ctx.house_test_plans.simple)
	let floor = h.add_floor()
	floor.delete_seg(floor.segs[0])
	let state1 = JSON.stringify(floor.save_state())
	h.remove_top_floor()
	assert(h.undo()) // remove
	assert.equal(h.floors[1], floor)
	assert.equal(h.h, 5000)
	assert(h.undo()) // the floor's edit
	assert.notEqual(JSON.stringify(floor.save_state()), state1)
	assert(h.undo()) // add
	assert.equal(h.floors.length, 1)
	assert.equal(h.h, 2500)
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
	// outer skin: x -140..6140, y -140..4140, 45 deg: the ridge is half the
	// width above the wall top; the eaves are 220 lower (eave_h) and 220 out;
	// the gables are 600 out (overhang).
	let wall_z = f.z + f.h
	assert.deepEqual(roof_z_range(faces), [wall_z - 220, wall_z + 2140])
	let x1 = 1/0, y1 = 1/0, x2 = -1/0, y2 = -1/0
	for (let face of faces)
		for (let [x, y] of face.rings[0]) {
			x1 = Math.min(x1, x); y1 = Math.min(y1, y)
			x2 = Math.max(x2, x); y2 = Math.max(y2, y)
		}
	assert.deepEqual([x1, y1, x2, y2], [-740, -360, 6740, 4360])
})

check('two edge points on one side: the roof pitch', () => {
	let state = JSON.parse(JSON.stringify(ctx.house_test_plans.gable1))
	state.floors[2].roof.edge_points.push({x: 0, y: 1000, pitch: 90})
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

// the default roof: the eave height is 220 mm under the wall top, about a
// 600 mm overhang at 20 deg.
let roof60_eave_h = -220
function roof60() {
	return {pitch: 20, overhang: 600, eave_h: roof60_eave_h, edge_points: []}
}

// the overhang of the sloped sides of roof60().
let roof60_d = -roof60_eave_h / Math.tan(20 * Math.PI / 180)
// roof points are on the prism_union grid.
let grid = x => Math.round(x * ctx.prism_union.grid_scale)
	/ ctx.prism_union.grid_scale
// the roof60() eave lines: west and north, east of 6000 and of 3000, south.
let eave_w = grid(-140 - roof60_d)
let eave_e6 = grid(6140 + roof60_d)
let eave_e3 = grid(3140 + roof60_d)
let eave_s = grid(4140 + roof60_d)

// floor 0: x 0..6000; floor 1: x 0..3000 on top of it.
function lean_to_house(area_points) {
	return house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)], area_points: area_points,
			roof: roof60()},
		{lines: [rect_lines(0, 0, 3000, 4000)], roof: roof60()},
	]})
}

check('a lower floor sticking out: a roof against the upper wall', () => {
	let h = lean_to_house()
	let [f0, f1] = h.floors
	let areas = f0.make_areas()
	assert.equal(areas.length, 1)
	assert.equal(areas[0].kind, 'roof')
	let faces = f0.make_roof_faces(areas)
	// eaves north, east and south follow the rounded eave height; the upper
	// floor's outer skin, x = 3140, stays: no face rises from it.
	assert.equal(faces.length, 3)
	assert.deepEqual(faces_bbox(faces), [3140, eave_w, eave_e6, eave_s])
	let wall_z = f0.z + f0.h
	let [z1, z2] = roof_z_range(faces)
	assert(Math.abs(z1 - (wall_z + roof60_eave_h)) < 1e-8)
	assert_near(z2, wall_z + roof60_eave_h
		+ (2000 - eave_w) * Math.tan(20 * Math.PI / 180))
	// slab 1 leaves out the roof: its top shows in the upper room only.
	let all_faces = h.make_faces(f1, false)
	let [slab_top, ...rest] = up_faces_at(all_faces, f1.z + h.slab_thickness)
	assert.equal(rest.length, 0)
	assert.deepEqual(faces_bbox([slab_top]), [40, 40, 2960, 3960])
	// floor 0's outer wall under the roof rises to the roof underside.
	let [poly] = all_faces.map(face_poly).filter(poly =>
		poly.is_v && poly.axis == 6140 && poly.normal == 1)
	let d = h.roof_thickness / Math.cos(20 * Math.PI / 180)
	assert(Math.abs(Math.max(...outline_points(poly).map(p => p[1]))
		- (wall_z - d)) < .02)
})

check('a lower floor sticking out: a terrace', () => {
	let h = lean_to_house([{x: 4500, y: 2000, kind: 'terrace'}])
	let [f0, f1] = h.floors
	let areas = f0.make_areas()
	assert.equal(areas.length, 1)
	assert.equal(areas[0].kind, 'terrace')
	let faces = h.make_faces(f1, false)
	// the roof is the upper floor's only.
	assert.deepEqual(faces_bbox(faces.filter(face => face.tag == 'roof')),
		[eave_w, eave_w, eave_e3, eave_s])
	// slab 1 top: the upper room floor and the terrace.
	let slab_tops = up_faces_at(faces, f1.z + h.slab_thickness)
	assert.deepEqual([...slab_tops].map(face => [...faces_bbox([face])]).sort(),
		[[3140, -140, 6140, 4140], [40, 40, 2960, 3960]])
})

check('the upper roof overhangs the lower roof', () => {
	let h = lean_to_house()
	let [f0, f1] = h.floors
	let upper_faces = f1.make_roof_faces(f1.make_areas())
	assert.deepEqual(faces_bbox(upper_faces), [eave_w, eave_w, eave_e3, eave_s])
	let faces = h.make_faces(f1, false)
	assert.deepEqual(faces_bbox(faces.filter(face => face.tag == 'roof')),
		[eave_w, eave_w, eave_e6, eave_s])
})

// floor 1 covers the north-east corner of floor 0 and sticks out north:
// floor 0's north side runs on from its outline to floor 1's wall.
check('an eave side runs on into a wall side', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(3000, 2000, 3000, 4000)]},
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
	let r = f.start_move_seg(f.segs.find(s => !s.is_v && s.axis == 2400))
	r.move(0, 500)
	r.stop()
	assert(h.undo())
	assert.equal(JSON.stringify(f.roof), roof)
})

// one floor, outer skin x -140..6140, y -140..4140, roof60(). eave sides of
// its roof by outward normal: 'w', 'e', 'n' (y < 0), 's'.
function eave_house() {
	return house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)],
		roof: roof60()}]})
}

let tan20 = Math.tan(20 * Math.PI / 180)
function assert_near(a, b) {
	assert(Math.abs(a - b) < 1e-8, a + ' != ' + b)
}


function eave_sides(f) {
	let sides = []
	let faces = f.make_roof_faces(f.make_areas(), sides)
	let by_dir = {faces: faces}
	for (let side of sides)
		by_dir[side.nx < 0 ? 'w' : side.nx > 0 ? 'e' : side.ny < 0 ? 'n' : 's']
			= side
	return by_dir
}

// grid units of roof60()'s overhang.
let roof60_d_grid = Math.round(roof60_d * ctx.prism_union.grid_scale)

check('make_roof_faces lists the eave sides', () => {
	let f = eave_house().floors[0]
	let sides = []
	f.make_roof_faces(f.make_areas(), sides)
	assert.equal(sides.length, 4)
	let scale = ctx.prism_union.grid_scale
	for (let side of sides) {
		assert.equal(side.edge_point, undefined)
		assert.equal(side.d, roof60_d_grid)
		assert.equal(side.pitch, 20)
	}
	let {w} = eave_sides(f)
	assert.equal(w.c, -140 * scale - roof60_d_grid)
	assert.equal(w.wall_c, -140 * scale)
	assert.deepEqual([w.m1, w.m2], [-140 * scale, 4140 * scale])
	// the eave line runs to the neighbors' eave lines.
	assert.deepEqual([w.e1, w.e2],
		[-140 * scale - roof60_d_grid, 4140 * scale + roof60_d_grid])
	assert.equal(w.is_only_slope, undefined)
})

check('the only sloped eave side of an area cannot become a gable', () => {
	let h = eave_house()
	let f = h.floors[0]
	f.toggle_gable(eave_sides(f).w, -400, 2000)
	f.toggle_gable(eave_sides(f).e, 6500, 2000)
	f.toggle_gable(eave_sides(f).n, 3000, -400)
	let {s} = eave_sides(f)
	assert.equal(s.is_only_slope, true)
	assert.equal(f.can_toggle_gable(s), false)
	let edit_no = h.edit_no
	f.toggle_gable(s, 3000, 4500)
	assert.equal(h.edit_no, edit_no)
	assert(eave_sides(f).faces.length > 0)
	// a gable side can still go back to sloped.
	assert.equal(f.can_toggle_gable(eave_sides(f).w), true)
})

for (let x of [7000, 10000]) {
	check('each roof area keeps its only slope, second outline x=' + x, () => {
		let f = house({floors: [{
			lines: [rect_lines(0, 0, 6000, 4000), rect_lines(x, 0, 6000, 4000)],
			roof: {pitch: 90, overhang: 600, edge_points: [
				{x: 3000, y: -140, pitch: 20},
				{x: x + 3000, y: 4140, pitch: 30},
			]},
		}]}).floors[0]
		let areas = f.make_areas()
		assert.equal(areas.length, 2)
		let sides = []
		let faces = f.make_roof_faces(areas, sides)
		assert(faces.length > 0)
		let slope_n = 0
		for (let side of sides) {
			if (side.pitch == 90)
				continue
			slope_n++
			assert.equal(side.is_only_slope, true)
			assert.equal(f.can_toggle_gable(side), false)
		}
		assert.equal(slope_n, 2)
		f.roof.edge_points.push({x: 6140, y: 2000, pitch: 40})
		sides = []
		f.make_roof_faces(areas, sides)
		slope_n = 0
		for (let side of sides) {
			if (side.pitch == 90)
				continue
			slope_n++
			let in_second_area = side.edge_point.x > x
			assert.equal(side.is_only_slope,
				in_second_area ? true : undefined)
			assert.equal(f.can_toggle_gable(side), !in_second_area)
		}
		assert.equal(slope_n, 3)
	})
}

check('the eave line of a side at an inside corner stops at the neighbor', () => {
	// L: the inside corner at (3000, 3000): the side along y = 3000 from
	// x = 6000 to 3000 meets the side along x = 3000 going up.
	let f = house({floors: [{lines: [['draw', 0, 0,
		6000, 3000, -3000, 3000, -3000, -6000]], roof: roof60()}]}).floors[0]
	let sides = []
	f.make_roof_faces(f.make_areas(), sides)
	let scale = ctx.prism_union.grid_scale
	let side = sides.find(side => side.ny > 0 && side.wall_c == 3140 * scale)
	// from the east eave line to the inner eave line.
	assert.deepEqual([side.e1, side.e2],
		[3140 * scale + roof60_d_grid, 6140 * scale + roof60_d_grid])
})

check('toggle_gable: add a gable point, flip it, or nothing if 2+', () => {
	let h = eave_house()
	let f = h.floors[0]
	let edit_no = h.edit_no
	f.toggle_gable(eave_sides(f).w, -400, 2000)
	assert.equal(h.edit_no, edit_no + 1)
	// the point is on the wall line, across from the click.
	assert.deepEqual({...f.roof.edge_points[0]}, {x: -140, y: 2000, pitch: 90})
	let {w, faces} = eave_sides(f)
	assert.equal(w.edge_point, f.roof.edge_points[0])
	assert.equal(w.pitch, 90)
	assert.equal(faces.length, 3)
	f.toggle_gable(w, -400, 2000)
	assert.equal(f.roof.edge_points[0].pitch, null)
	assert.equal(eave_sides(f).w.pitch, 20)
	assert.equal(eave_sides(f).faces.length, 4)
	f.roof.edge_points.push({x: -140, y: 3000, pitch: 90})
	w = eave_sides(f).w
	assert.equal(w.edge_point, null)
	edit_no = h.edit_no
	f.toggle_gable(w, -400, 2000)
	assert.equal(h.edit_no, edit_no)
	assert.equal(f.roof.edge_points.length, 2)
})

check('an edge point tied between eaves keeps the first side', () => {
	let f = eave_house().floors[0]
	let point = {x: 3000, y: 2000, pitch: 35,
		eave_h: -150 * Math.tan(35 * Math.PI / 180)}
	f.roof.edge_points.push(point)
	let {n, s} = eave_sides(f)
	assert.equal(s.edge_point, point)
	assert.equal(s.pitch, 35)
	assert.equal(s.d, 150 * ctx.prism_union.grid_scale)
	assert.equal(n.edge_point, undefined)
	assert.equal(n.pitch, 20)
})

check('three edge points on an eave keep its defaults and conflict', () => {
	let f = eave_house().floors[0]
	for (let y of [1000, 2000, 3000])
		f.roof.edge_points.push({x: -140, y: y, pitch: 35, eave_h: -100})
	let point = {x: 6140, y: 2000, pitch: 30,
		eave_h: -400 * Math.tan(30 * Math.PI / 180)}
	f.roof.edge_points.push(point)
	let {w, e} = eave_sides(f)
	assert.equal(w.edge_point, null)
	assert.equal(w.pitch, 20)
	assert.equal(w.d, roof60_d_grid)
	assert.equal(f.can_toggle_gable(w), false)
	assert.equal(e.edge_point, point)
	assert.equal(e.pitch, 30)
	assert.equal(e.d, 400 * ctx.prism_union.grid_scale)
})

check('remove_edge_point is undoable', () => {
	let h = eave_house()
	let f = h.floors[0]
	f.toggle_gable(eave_sides(f).w, -400, 2000)
	f.remove_edge_point(f.roof.edge_points[0])
	assert.equal(f.roof.edge_points.length, 0)
	assert.equal(eave_sides(f).faces.length, 4)
	assert(h.undo())
	assert.equal(h.floors[0].roof.edge_points.length, 1)
})

// the overhang of a sloped side with the eave height eave_h (mm, whole).
function eave_overhang(eave_h) {
	return -eave_h / tan20
}

check('moving a sloped eave sets the roof eave height', () => {
	let h = eave_house()
	let f = h.floors[0]
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	assert.equal(m.move(200, 50, false), true)
	m.stop()
	assert_near(f.roof.eave_h, -293)
	assert.equal(f.roof.overhang, 600)
	assert.equal(f.roof.edge_points.length, 0)
	let d = eave_overhang(-293)
	assert.deepEqual(faces_bbox(eave_sides(f).faces),
		[grid(-140 - d), grid(-140 - d), grid(6140 + d), grid(4140 + d)])
	// inward to the wall line: the eaves are at the wall top.
	m = f.start_move_eave(eave_sides(f).n, 3000, -500)
	assert.equal(m.move(0, 900, false), true)
	m.stop()
	assert_near(f.roof.eave_h, 0)
	assert.deepEqual(faces_bbox(eave_sides(f).faces), [-140, -140, 6140, 4140])
	// past the wall line or past max_overhang: clamped.
	m = f.start_move_eave(eave_sides(f).n, 3000, -200)
	assert.equal(m.move(0, 100, false), true)
	assert_near(f.roof.eave_h, 0)
	assert.equal(m.move(0, -1510, false), true)
	assert_near(f.roof.eave_h, -546)
	m.cancel()
})

check('moving the eaves inward stops when the highest eave is at the wall top',
	() => {
	let f = eave_house().floors[0]
	f.roof.edge_points.push({x: 6140, y: 2000, eave_h: -100})
	let m = f.start_move_eave(eave_sides(f).n, 3000, -500)
	assert.equal(m.move(0, 1000, false), true)
	m.stop()
	assert_near(f.roof.eave_h, -220 + 100)
	assert_near(f.roof.edge_points[0].eave_h, 0)
	// one eave: its overhang stops at 0 and at max_overhang.
	m = f.start_move_eave(eave_sides(f).w, -500, 2000)
	m.move(1000, 0, true)
	assert_near(f.roof.edge_points[1].eave_h, 0)
	m.move(-2000, 0, true)
	assert_near(f.roof.edge_points[1].eave_h, -546)
	m.cancel()
})

check('moving a gable sets the roof overhang', () => {
	let h = eave_house()
	let f = h.floors[0]
	f.toggle_gable(eave_sides(f).e, 6500, 2000)
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	assert.equal(m.move(200, 0, false), true)
	m.stop()
	assert.equal(f.roof.overhang, 800)
	assert_near(f.roof.eave_h, -220)
	let {e, w} = eave_sides(f)
	let scale = ctx.prism_union.grid_scale
	assert.equal(e.d, 800 * scale)
	assert.equal(w.d, roof60_d_grid)
})

check('one eave snaps to the roof value and to eave corners', () => {
	let h = eave_house()
	let f = h.floors[0]
	let scale = ctx.prism_union.grid_scale
	f.roof.edge_points.push({x: 6140, y: 2000, eave_h: -300 * tan20})
	let {e} = eave_sides(f)
	assert_near(e.d / scale, 300)
	// near the roof's overhang (604): the own eave height is removed.
	let m = f.start_move_eave(e, 6500, 2000, [])
	assert.equal(m.move(250, 0, true, 200), true)
	m.stop()
	assert.equal(f.roof.edge_points[0].eave_h, null)
	assert.equal(eave_sides(f).e.d, roof60_d_grid)
	// near the corner position x = 7000: the eave line goes there; snap_d 0
	// (ctrl): no snap.
	m = f.start_move_eave(eave_sides(f).e, 6500, 2000, [7000])
	m.move(300, 0, true, 200)
	assert_near(f.roof.edge_points[0].eave_h, -313)
	m.move(300, 0, true, 0)
	assert_near(f.roof.edge_points[0].eave_h, -329)
	// all eaves: no snap.
	m.move(300, 0, false, 200)
	assert_near(f.roof.eave_h, -329)
	m.cancel()
	// a gable near the roof's overhang: its own overhang is removed.
	f.toggle_gable(eave_sides(f).w, -500, 2000)
	m = f.start_move_eave(eave_sides(f).w, -500, 2000, [])
	m.move(-300, 0, true, 0)
	m.stop()
	assert.equal(f.roof.edge_points[1].overhang, 900)
	m = f.start_move_eave(eave_sides(f).w, -500, 2000, [])
	m.move(250, 0, true, 200)
	m.stop()
	assert.equal(f.roof.edge_points[1].overhang, null)
})

check('eaves are level: the overhang follows the pitch', () => {
	let f = eave_house().floors[0]
	f.roof.edge_points.push({x: 6140, y: 2000, pitch: 45})
	let {e, w, faces} = eave_sides(f)
	let wall_z = f.z + f.h
	let scale = ctx.prism_union.grid_scale
	assert_near(e.eave_z, wall_z - 220)
	assert_near(w.eave_z, wall_z - 220)
	assert.equal(e.d, 220 * scale) // tan 45 = 1
	assert.equal(w.d, roof60_d_grid)
	assert_near(roof_z_range(faces)[0], wall_z - 220)
})

check('a shallow side stops at max_overhang: its eave is higher', () => {
	let f = eave_house().floors[0]
	f.roof.edge_points.push({x: 6140, y: 2000, pitch: 5})
	let wall_z = f.z + f.h
	let scale = ctx.prism_union.grid_scale
	let {e} = eave_sides(f)
	assert.equal(e.d, 1500 * scale)
	assert_near(e.eave_z, wall_z - 1500 * Math.tan(5 * Math.PI / 180))
})

check('moving one eave sets its edge point eave height', () => {
	let h = eave_house()
	let f = h.floors[0]
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(-300, 0, true)
	m.stop()
	assert_near(f.roof.eave_h, -220)
	let point = f.roof.edge_points[0]
	assert.deepEqual([point.x, point.y], [6140, 2000])
	assert_near(point.eave_h, -111)
	let {e, w, faces} = eave_sides(f)
	assert.equal(e.edge_point, f.roof.edge_points[0])
	assert.equal(e.pitch, 20)
	assert.deepEqual(faces_bbox(faces),
		[eave_w, eave_w, grid(6140 + eave_overhang(-111)), eave_s])
	let scale = ctx.prism_union.grid_scale
	assert.equal(e.d, Math.round(eave_overhang(-111) * scale))
	assert.equal(w.d, roof60_d_grid)
	// again: the same edge point.
	m = f.start_move_eave(e, 6500, 3000)
	m.move(100, 0, true)
	m.stop()
	assert.equal(f.roof.edge_points.length, 1)
	assert_near(f.roof.edge_points[0].eave_h, -147)
	// the eave height is saved.
	let state = h.save_state()
	assert_near(state.floors[0].roof.edge_points[0].eave_h, -147)
	// 2+ points: no own eave height; all eaves still move.
	f.roof.edge_points.push({x: 6140, y: 1000})
	m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	assert.equal(m.move(100, 0, true), false)
	assert_near(f.roof.eave_h, -220)
	assert_near(f.roof.edge_points[0].eave_h, -147)
	assert.equal(m.move(100, 0, false), true)
	assert_near(f.roof.eave_h, -256)
	assert_near(f.roof.edge_points[0].eave_h, -183)
	m.stop()
})

check('cancelling or undoing an eave move restores the eave height', () => {
	let h = eave_house()
	let f = h.floors[0]
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(300, 0, true)
	m.cancel()
	assert.equal(f.roof.edge_points.length, 0)
	m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(300, 0, false)
	m.stop()
	assert_near(f.roof.eave_h, -329)
	assert(h.undo())
	assert_near(h.floors[0].roof.eave_h, -220)
})

check('shift toggled during an eave drag: the last mode counts', () => {
	let h = eave_house()
	let f = h.floors[0]
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(200, 0, false)
	assert_near(f.roof.eave_h, -293)
	m.move(300, 0, true)
	assert_near(f.roof.eave_h, -220)
	assert.deepEqual([f.roof.edge_points[0].x, f.roof.edge_points[0].y],
		[6140, 2000])
	assert_near(f.roof.edge_points[0].eave_h, -329)
	m.move(400, 0, false)
	assert_near(f.roof.eave_h, -366)
	assert.equal(f.roof.edge_points.length, 0)
	m.move(500, 0, true)
	m.stop()
	assert_near(f.roof.eave_h, -220)
	assert.equal(f.roof.edge_points.length, 1)
	assert_near(f.roof.edge_points[0].eave_h, -402)
	// a side with its own eave height, without shift: all eaves by the same
	// height, its own too.
	m = f.start_move_eave(eave_sides(f).e, 6500, 2000)
	m.move(100, 0, false)
	m.stop()
	assert_near(f.roof.eave_h, -256)
	assert_near(f.roof.edge_points[0].eave_h, -438)
	assert(h.undo())
	assert(h.undo())
	assert.equal(h.floors[0].roof.edge_points.length, 0)
})

// the face of eave_sides(f) in the plane of the side facing dir.
function eave_face(by_dir, dir) {
	return by_dir.faces.find(face => face.sides.includes(by_dir[dir]))
}

function face_z(face, x, y) {
	let [a, b, c] = face.plane
	return a * x + b * y + c
}

// eave_house's hip roof: the ridge along y = 2000 at this height.
function eave_ridge_z(f) {
	return f.z + f.h + 2140 * Math.tan(20 * Math.PI / 180)
}

check('make_roof_faces gives each face the eave sides in its plane', () => {
	let f = eave_house().floors[0]
	let by_dir = eave_sides(f)
	assert.equal(by_dir.faces.length, 4)
	for (let dir of ['w', 'e', 'n', 's']) {
		let {sides} = eave_face(by_dir, dir)
		assert.equal(sides.length, 1)
		assert.equal(sides[0], by_dir[dir])
	}
})

check('moving the ridge sets the pitches of the faces on both sides', () => {
	let h = eave_house()
	let f = h.floors[0]
	let by_dir = eave_sides(f)
	let z = eave_ridge_z(f)
	let n = eave_face(by_dir, 'n')
	let s = eave_face(by_dir, 's')
	assert.equal(f.can_move_faces([n, s], z), true)
	let m = f.start_move_faces([n, s], z)
	// along the ridge: no difference.
	assert.equal(m.move(3200, 2500), true)
	m.stop()
	assert.equal(f.roof.edge_points.length, 2)
	by_dir = eave_sides(f)
	n = eave_face(by_dir, 'n')
	s = eave_face(by_dir, 's')
	// the edge points are on the wall lines, at the middle of the sides.
	assert.deepEqual([by_dir.n.edge_point.x, by_dir.n.edge_point.y], [3000, -140])
	assert.deepEqual([by_dir.s.edge_point.x, by_dir.s.edge_point.y], [3000, 4140])
	// both planes pass through the line at the grabbed height, within the
	// rounding of the eave lines to the grid.
	assert(Math.abs(face_z(n, 3000, 2500) - z) < 1e-1)
	assert(Math.abs(face_z(s, 3000, 2500) - z) < 1e-1)
	assert(Math.abs(faces_bbox([n])[3] - 2500) < 1e-1)
	assert(Math.abs(faces_bbox([s])[1] - 2500) < 1e-1)
	assert(by_dir.n.pitch < 20 && by_dir.s.pitch > 20)
	// the other sides keep the roof's pitch.
	assert.equal(by_dir.w.pitch, 20)
	assert.equal(by_dir.e.pitch, 20)
	assert(h.undo())
	assert.equal(h.floors[0].roof.edge_points.length, 0)
})

check('moving a hip sets the pitches of its two faces', () => {
	let f = eave_house().floors[0]
	let by_dir = eave_sides(f)
	let z = f.z + f.h + 500
	let m = f.start_move_faces(
		[eave_face(by_dir, 'n'), eave_face(by_dir, 'e')], z)
	m.move(5000, 1000)
	m.stop()
	by_dir = eave_sides(f)
	// within the rounding of the eave lines to the grid.
	assert(Math.abs(face_z(eave_face(by_dir, 'n'), 5000, 1000) - z) < 1e-1)
	assert(Math.abs(face_z(eave_face(by_dir, 'e'), 5000, 1000) - z) < 1e-1)
	assert.equal(by_dir.w.pitch, 20)
	assert.equal(by_dir.s.pitch, 20)
})

check('a line moved onto a wall line: that side goes vertical', () => {
	let f = eave_house().floors[0]
	let by_dir = eave_sides(f)
	let z = eave_ridge_z(f)
	let m = f.start_move_faces(
		[eave_face(by_dir, 'n'), eave_face(by_dir, 's')], z)
	assert.equal(m.move(3000, 4140), true)
	m.stop()
	by_dir = eave_sides(f)
	assert.equal(by_dir.s.pitch, 90)
	assert.equal(eave_face(by_dir, 's'), undefined)
})

for (let blocked_by of ['height', 'edge_points']) {
	check('blocked line start preserves history: ' + blocked_by, () => {
		let h = eave_house()
		let f = h.floors[0]
		if (blocked_by == 'edge_points')
			f.roof.edge_points.push({x: 6140, y: 1000}, {x: 6140, y: 3000})
		let state0 = JSON.stringify(h.save_state())
		f.toggle_room(f.hit_cycle_edges(3000, 2000), 3000, 2000)
		let state1 = JSON.stringify(h.save_state())
		f.toggle_room(f.hit_cycle_edges(3000, 2000), 3000, 2000)
		let state2 = JSON.stringify(h.save_state())
		assert(h.undo())
		let edit_no = h.edit_no
		let by_dir = eave_sides(f)
		let z = blocked_by == 'height' ? f.z + f.h : eave_ridge_z(f)
		assert.equal(f.start_move_faces([eave_face(by_dir, 'n'),
			eave_face(by_dir, 'e')], z), undefined)
		assert.equal(JSON.stringify(h.save_state()), state1)
		assert.equal(h.edit_no, edit_no)
		assert(h.redo())
		assert.equal(JSON.stringify(h.save_state()), state2)
		assert(h.undo())
		assert(h.undo())
		assert.equal(JSON.stringify(h.save_state()), state0)
		assert.equal(h.undo(), false)
	})
}

check('a line cannot move: low, past both walls, or 2+ points', () => {
	let h = eave_house()
	let f = h.floors[0]
	let by_dir = eave_sides(f)
	let n = eave_face(by_dir, 'n')
	let e = eave_face(by_dir, 'e')
	assert.equal(f.can_move_faces([n, e], f.z + f.h), false)
	// past both walls of the hip's corner: start values.
	let m = f.start_move_faces([n, e], f.z + f.h + 500)
	assert.equal(m.move(6500, -500), false)
	assert.equal(f.roof.edge_points.length, 0)
	m.cancel()
	assert.equal(f.roof.edge_points.length, 0)
	f.roof.edge_points.push({x: 6140, y: 1000}, {x: 6140, y: 3000})
	by_dir = eave_sides(f)
	assert.equal(f.can_move_faces([eave_face(by_dir, 'n'),
		eave_face(by_dir, 'e')], eave_ridge_z(f)), false)
})

// eave_house's hip roof: the east end of the ridge, where the north, south
// and east faces meet, at x = 6140 - 2140.
check('moving a ridge end sets the pitches of the faces that meet there', () => {
	let h = eave_house()
	let f = h.floors[0]
	let by_dir = eave_sides(f)
	let z = eave_ridge_z(f)
	let faces = [eave_face(by_dir, 'n'), eave_face(by_dir, 's'),
		eave_face(by_dir, 'e')]
	// along the ridge, outward: only the end face changes, steeper.
	let m = f.start_move_faces(faces, z)
	assert.equal(m.move(5000, 2000), true)
	m.stop()
	by_dir = eave_sides(f)
	assert(Math.abs(by_dir.n.pitch - 20) < 1e-9)
	assert(Math.abs(by_dir.s.pitch - 20) < 1e-9)
	assert(by_dir.e.pitch > 20)
	assert.equal(by_dir.w.pitch, 20)
	assert(Math.abs(face_z(eave_face(by_dir, 'e'), 5000, 2000) - z) < 1e-1)
	// past the end wall: a gable.
	assert(h.undo())
	by_dir = eave_sides(f)
	faces = [eave_face(by_dir, 'n'), eave_face(by_dir, 's'),
		eave_face(by_dir, 'e')]
	m = f.start_move_faces(faces, z)
	assert.equal(m.move(6500, 2000), true)
	m.stop()
	by_dir = eave_sides(f)
	assert.equal(by_dir.e.pitch, 90)
	assert.equal(eave_face(by_dir, 'e'), undefined)
	// across the ridge: the side faces change, the end face does not.
	assert(h.undo())
	by_dir = eave_sides(f)
	faces = [eave_face(by_dir, 'n'), eave_face(by_dir, 's'),
		eave_face(by_dir, 'e')]
	m = f.start_move_faces(faces, z)
	assert.equal(m.move(4000, 2500), true)
	m.stop()
	by_dir = eave_sides(f)
	assert(by_dir.n.pitch < 20 && by_dir.s.pitch > 20)
	assert(Math.abs(by_dir.e.pitch - 20) < 1e-9)
	// double-click: back to the roof's pitch.
	by_dir = eave_sides(f)
	f.reset_faces([eave_face(by_dir, 'n'), eave_face(by_dir, 's'),
		eave_face(by_dir, 'e')])
	by_dir = eave_sides(f)
	for (let dir of ['w', 'e', 'n', 's'])
		assert.equal(by_dir[dir].pitch, 20)
})

check('roof cut by the upper wall has no rounding points on the rakes', () => {
	let roof = {pitch: 20, overhang: 600, eave_h: -220,
		max_overhang: 1500, edge_points: []}
	let h = house({
		floor_h: 2500,
		int_wall_thickness: 80,
		ext_wall_thickness: 180,
		slab_thickness: 200,
		roof_thickness: 200,
		floors: [
			{
				points: [[0, 0, 'draw'], [0, 4000, 7],
					[6000, 0, 5], [6000, 4000, 6]],
				lines: [[5, 0, 2, 7, 3, 1, 8, 1, 0, 6, 2, 3]],
				roof: roof,
			},
			{
				points: [[0, 0, 'draw'], [0, 4000, 3],
					[3000, 0, 1], [3000, 4000, 2]],
				lines: [[1, 0, 2, 3, 3, 1, 4, 1, 0, 2, 2, 3]],
				roof: roof,
			},
		],
	})
	let wall
	for (let face of h.make_faces(h.floors[1])) {
		for (let ring of face.rings) {
			assert(ring.length >= 3)
			if (face.tag != 'walls')
				continue
			let on_cut = true
			let max_z = -Infinity
			for (let p of ring) {
				on_cut &&= p[0] == 3140
				max_z = Math.max(max_z, p[2])
			}
			if (on_cut && max_z > 4000)
				wall = ring
		}
	}
	assert(wall)
	assert.equal(wall.length, 5)
	for (let p of wall)
		assert(p[1] == -140 || p[1] == 2000 || p[1] == 4140)
})

// stored geometry precision ------------------------------------------------

check('load snaps stored geometry to mm without changing the input plan', () => {
	let plan = {floor_h: 2500.6, int_wall_thickness: 80.6,
		ext_wall_thickness: 180.6, slab_thickness: 200.6,
		roof_thickness: 200.6, floors: [{h: 2600.6,
			lines: [['connect', [-1000.6, 0.4], [1000.6, 0.4],
				[1000.6, 2000.6], [-1000.6, 2000.6], [-1000.6, 0.4]],
				['connect', [0.4, -1000.6], [0.4, 3000.6]]],
			room_points: [{x: 300.6, y: 400.4, is_open: true}],
			area_points: [{x: 500.6, y: 600.4, kind: 'terrace'}],
			roof: {pitch: 23.456789, overhang: 600.6, eave_h: -220.6,
				max_overhang: 1500.6, edge_points: [{x: 1000.6,
					y: 300.4, pitch: null, overhang: null, eave_h: -120.6}]},
		}]}
	let before = JSON.stringify(plan)
	let h = house(plan)
	assert.equal(JSON.stringify(plan), before)
	assert_near(h.floor_h, 2501)
	assert_near(h.int_wall_thickness, 81)
	assert_near(h.ext_wall_thickness, 181)
	assert_near(h.slab_thickness, 201)
	assert_near(h.roof_thickness, 201)
	let f = h.floors[0]
	assert_near(f.fixed_h, 2601)
	assert.equal(f.h, f.fixed_h)
	for (let p of f.ps) {
		assert.equal(p[0], Math.round(p[0]))
		assert.equal(p[1], Math.round(p[1]))
	}
	assert(f.ps.find(p => p[0] == 0 && p[1] == 0 && p.segs.length == 4))
	assert_near(f.room_points[0].x, 301)
	assert_near(f.room_points[0].y, 400)
	assert_near(f.area_points[0].x, 501)
	assert_near(f.area_points[0].y, 600)
	assert.equal(f.roof.pitch, plan.floors[0].roof.pitch)
	assert_near(f.roof.overhang, 601)
	assert_near(f.roof.eave_h, -221)
	assert_near(f.roof.max_overhang, 1501)
	assert_near(f.roof.edge_points[0].x, 1001)
	assert_near(f.roof.edge_points[0].y, 300)
	assert_near(f.roof.edge_points[0].eave_h, -121)
	assert.equal(f.roof.edge_points[0].overhang, null)
	let saved = JSON.stringify(h.save_state())
	assert.equal(JSON.stringify(house(JSON.parse(saved)).save_state()), saved)
})

check('new walls and resize previews snap to whole mm', () => {
	let h = house({floors: [{}]})
	let f = h.floors[0]
	let m = f.start_resize_seg(null, -1000.6, 2000.6, 600.6, 0, 1, 0)
	assert_near(m.seg[0][0], -1001)
	assert_near(m.seg[0][1], 2001)
	assert_near(m.seg[1][0], -400)
	let p = m.resize(800.6, 0, 0)
	assert_near(p[0], -200)
	assert_near(p[1], 2001)
	m.stop()
	let saved = JSON.stringify(h.save_state())
	assert(h.undo())
	assert.equal(f.ps.length, 0)
	assert(h.redo())
	assert.equal(JSON.stringify(h.save_state()), saved)
	m = f.start_resize_seg(f.ps.find(p => p[0] == -200), -200, 2001,
		100.6, 0, 1, 0)
	assert_near(m.resize(100.6, 0, 0)[0], -99)
	m.cancel()
	assert.equal(JSON.stringify(h.save_state()), saved)
})

check('free and connected wall move previews snap coordinates', () => {
	let f = floor([['connect', [0, 0], [1000, 0]]])
	let m = f.start_move_seg(f.segs[0])
	m.move(106.6, -206.6, 0)
	assert_near(f.segs[0][0][0], 107)
	assert_near(f.segs[0][1][0], 1107)
	assert_near(f.segs[0].axis, -207)
	m.stop()
	f = floor([rect_lines(0, 0, 6000, 4000)])
	let seg = f.segs.find(s => s.is_v && s.axis == 6000)
	m = f.start_move_seg(seg)
	m.move(206.6, 0, 0)
	assert_near(seg.axis, 6207)
	m.stop()
})

check('room creation and room move previews snap their coordinates', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)]}]})
	let f = h.floors[0]
	f.toggle_room(f.comps[0].cycles[0], 1000.6, 2000.6)
	let p = f.room_points[0]
	assert_near(p.x, 1001)
	assert_near(p.y, 2001)
	let m = f.start_move_room_point(p)
	m.move(106.6, -206.6)
	assert_near(p.x, 1108)
	assert_near(p.y, 1794)
	m.stop()
	assert(h.undo())
	assert_near(f.room_points[0].x, 1001)
	assert(h.redo())
	assert_near(f.room_points[0].x, 1108)
})

check('roof points and eave previews snap lengths and keep pitches', () => {
	let h = eave_house()
	let f = h.floors[0]
	f.toggle_gable(eave_sides(f).e, 6500, 2000.6)
	assert_near(f.roof.edge_points[0].y, 2001)
	let m = f.start_move_eave(eave_sides(f).e, 6500, 2000.6)
	m.move(206.6, 0, true)
	assert_near(f.roof.edge_points[0].overhang, 807)
	m.stop()
	let saved = JSON.stringify(h.save_state())
	m = f.start_move_eave(eave_sides(f).w, -500, 3000.6)
	m.move(-106.6, 0, true)
	assert_near(f.roof.edge_points[1].y, 3001)
	assert_near(f.roof.edge_points[1].eave_h, -259)
	assert.equal(f.roof.pitch, 20)
	m.stop()
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), saved)
	assert(h.redo())
	assert_near(f.roof.edge_points[1].eave_h, -259)
})

check('automatically created roof midpoints snap to whole mm', () => {
	let f = house({floors: [{lines: [rect_lines(0, 0, 6000, 4001)],
		roof: roof60()}]}).floors[0]
	let sides = eave_sides(f)
	let m = f.start_move_pitch(eave_face(sides, 'e'))
	m.move(3.123456, true)
	assert_near(f.roof.edge_points[0].y, 2001)
	assert.equal(f.roof.edge_points[0].pitch, 23.123456)
	m.stop()
})

check('moving a floor height moves upper floors and saves one undo', () => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{h: 3000, lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
	let state0 = JSON.stringify(h.save_state())
	let f = h.floors[0]
	let upper = h.floors[1]
	let m = f.start_move_height()
	assert.equal(m.move(700), true)
	assert.equal(m.move(700), false)
	m.move(500)
	assert.equal(f.h, 3000)
	assert.equal(upper.z, 3000)
	assert.equal(upper.h, 3000)
	assert.equal(h.h, 6000)
	m.stop()
	assert.equal(h.edit_no, 1)
	assert.equal(h.save_state().floors[0].h, 3000)
	let state1 = JSON.stringify(h.save_state())
	assert(h.undo())
	assert.equal(h.floors[1], upper)
	assert.equal(upper.z, 2500)
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert(h.redo())
	assert.equal(JSON.stringify(h.save_state()), state1)
})

check('floor height cancel and return to origin preserve inherited height', () => {
	let h = eave_house()
	let f = h.floors[0]
	let state0 = JSON.stringify(h.save_state())
	let m = f.start_move_height()
	m.move(-1e6)
	assert.equal(f.h, h.slab_thickness + 1)
	m.cancel()
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert.equal(h.h, f.h)
	m = f.start_move_height()
	m.move(500)
	m.move(0)
	m.stop()
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert(!h.undo())
})

check('roof height scales slopes and supports save, cancel, undo and redo', () => {
	let h = eave_house()
	let f = h.floors[0]
	f.roof.edge_points.push({x: 6140, y: 2000, pitch: 30})
	let state0 = JSON.stringify(h.save_state())
	let h0 = f.roof_height()
	let m = f.start_move_height(true)
	assert.equal(m.move(500), true)
	assert.equal(m.move(500), false)
	assert(Math.abs(f.roof_height() - h0 - 500) < 1)
	let ratio0 = Math.tan(30*Math.PI/180) / Math.tan(20*Math.PI/180)
	let ratio1 = Math.tan(f.roof.edge_points[0].pitch*Math.PI/180)
		/ Math.tan(f.roof.pitch*Math.PI/180)
	assert(Math.abs(ratio1 - ratio0) < 1e-9)
	assert.equal(f.roof.eave_h, JSON.parse(state0).floors[0].roof.eave_h)
	m.cancel()
	assert.equal(JSON.stringify(h.save_state()), state0)
	m = f.start_move_height(true)
	m.move(500)
	m.stop()
	let state1 = JSON.stringify(h.save_state())
	let loaded = house(JSON.parse(state1))
	assert(Math.abs(loaded.floors[0].roof_height() - f.roof_height()) < 1e-9)
	assert(h.undo())
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert(h.redo())
	assert.equal(JSON.stringify(h.save_state()), state1)
})

check('roof height limits pitches and a return to origin makes no undo', () => {
	let h = eave_house()
	let f = h.floors[0]
	let state0 = JSON.stringify(h.save_state())
	let m = f.start_move_height(true)
	m.move(1e9)
	assert(Math.abs(f.roof.pitch - 89) < 1e-9)
	m.move(-1e9)
	assert(Math.abs(f.roof.pitch - 1) < 1e-9)
	m.move(0)
	m.stop()
	assert.equal(JSON.stringify(h.save_state()), state0)
	assert(!h.undo())
})

// state version ------------------------------------------------------------

check('a state without a version is in cm and loads scaled to mm', () => {
	let cm_state = {
		precision: .1, rotation: 1.5, floor_h: 250, int_wall_thickness: 8,
		floors: [{
			h: 300,
			points: [[0, 0, 'a'], [600, 0, 'b'], [600, 400, 'c']],
			lines: [[1, 0, 1, 2, 1, 2]],
			room_points: [{x: 100, y: 50, is_open: true}],
			area_points: [{x: 200, y: 60, kind: 'terrace'}],
			roof: {pitch: 30, overhang: 60, eave_h: -22, max_overhang: 150,
				edge_points: [{x: 10, y: 20, pitch: 90, overhang: 5,
					eave_h: -3}]},
		}],
	}
	let before = JSON.stringify(cm_state)
	let h = ctx.house_plan(cm_state)
	assert.equal(JSON.stringify(cm_state), before)
	assert.equal(h.floor_h, 2500)
	assert.equal(h.int_wall_thickness, 80)
	assert.equal(h.ext_wall_thickness, 180)
	let f = h.floors[0]
	assert.equal(f.h, 3000)
	assert.deepEqual(Array.from(f.ps, p => [p[0], p[1], p.id]),
		[[0, 0, 'a'], [6000, 0, 'b'], [6000, 4000, 'c']])
	assert.deepEqual({...f.room_points[0]}, {x: 1000, y: 500, is_open: true})
	assert.deepEqual({...f.area_points[0]}, {x: 2000, y: 600, kind: 'terrace'})
	assert.equal(f.roof.pitch, 30)
	assert.equal(f.roof.overhang, 600)
	assert.equal(f.roof.eave_h, -220)
	assert.equal(f.roof.max_overhang, 1500)
	assert.deepEqual({...f.roof.edge_points[0]},
		{x: 100, y: 200, pitch: 90, overhang: 50, eave_h: -30})
	let state = h.save_state()
	assert.equal(state.version, 1)
	assert.equal('precision' in state, false)
	assert.equal('rotation' in state, false)
	// a state with a version is loaded as it is.
	assert.equal(JSON.stringify(ctx.house_plan(state).save_state()),
		JSON.stringify(state))
})

check('a state without floors or settings loads with the mm defaults', () => {
	let h = ctx.house_plan({})
	assert.equal(h.floor_h, 2500)
	assert.equal(h.int_wall_thickness, 80)
	assert.equal(h.ext_wall_thickness, 180)
	assert.equal(h.slab_thickness, 200)
	assert.equal(h.roof_thickness, 200)
})

// settings -----------------------------------------------------------------

check('a wall thickness setting rebuilds the walls and is one undo step', () => {
	let h = house(ctx.house_test_plans.simple)
	let bb0 = [...h.bb]
	let edit_no = h.edit_no
	let s = h.start_edit_setting('ext_wall_thickness')
	s.move(300.4)
	s.move(400)
	assert.equal(h.ext_wall_thickness, 400)
	assert(h.bb[0] < bb0[0])
	assert.equal(h.edit_no, edit_no)
	s.stop()
	assert.equal(h.edit_no, edit_no + 1)
	let bb1 = [...h.bb]
	assert(h.undo())
	assert.equal(h.ext_wall_thickness, 180)
	assert.deepEqual([...h.bb], bb0)
	assert.equal(h.undo(), false)
	assert(h.redo())
	assert.equal(h.ext_wall_thickness, 400)
	assert.deepEqual([...h.bb], bb1)
	assert.equal(JSON.stringify(h.save_state()).includes('"ext_wall_thickness":400'),
		true)
})

check('the floor height setting moves the floors that have no height of their own',
	() => {
	let h = house({floors: [
		{lines: [rect_lines(0, 0, 6000, 4000)]},
		{h: 3000, lines: [rect_lines(0, 0, 6000, 4000)]},
		{lines: [rect_lines(0, 0, 6000, 4000)]},
	]})
	let s = h.start_edit_setting('floor_h')
	s.move(2800)
	s.stop()
	assert.deepEqual(Array.from(h.floors, f => f.h), [2800, 3000, 2800])
	assert.deepEqual(Array.from(h.floors, f => f.z), [0, 2800, 5800])
	assert.equal(h.h, 8600)
	assert(h.undo())
	assert.deepEqual(Array.from(h.floors, f => f.h), [2500, 3000, 2500])
	assert.equal(h.h, 8000)
	assert(h.redo())
	assert.equal(h.h, 8600)
})

check('a setting set back to its start value makes no undo step', () => {
	let h = house(ctx.house_test_plans.simple)
	let edit_no = h.edit_no
	let s = h.start_edit_setting('slab_thickness')
	s.move(300)
	s.move(200)
	s.stop()
	assert.equal(h.edit_no, edit_no)
	assert.equal(h.undo(), false)
})

// objects ------------------------------------------------------------------

function opening_house(objects) {
	return house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)],
		objects: objects}]})
}

// the faces of the north wall's outer side, as polys in (x, z).
function north_outer_polys(h) {
	return wall_polys_at(h, false, -140, -1)
}

let default_n = Object.keys(ctx.house_object_types).length // default objects.

check('a new house has one default object of each type on the ground', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)]}]})
	assert.deepEqual(Array.from(h.ground_objects, o => o.type),
		['window', 'door', 'bed', 'chair', 'wc'])
	assert.equal(h.floors[0].objects.length, 0)
})

check('loading adds the types missing from the ground, in their places', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000)]}],
		ground_objects: [{type: 'door', x: 100, y: 200, rot: 90}]})
	assert.deepEqual(Array.from(h.ground_objects, o => o.type),
		['door', 'window', 'bed', 'chair', 'wc'])
	assert.deepEqual(Array.from(h.ground_objects, o => [o.x, o.y]),
		[[100, 200], [-750, -2000], [2250, -2000], [3750, -2000],
			[5250, -2000]])
	assert.equal(h.ground_objects[0].rot, 90)
	let h2 = house(h.save_state())
	assert.equal(h2.ground_objects.length, default_n)
})

check('objects are saved, loaded and undone with their floor', () => {
	let object = {type: 'window', x: 3000, y: 0, rot: 0, w: 1200}
	let h = opening_house([object])
	let state = h.save_state()
	assert.equal(JSON.stringify(state.floors[0].objects),
		JSON.stringify([object]))
	assert.equal(state.ground_objects.length, default_n)
	let h2 = house(state)
	assert.equal(JSON.stringify(h2.save_state()), JSON.stringify(state))
})

function cut_wall_area(f) {
	let area = 0
	for (let path of f.make_wall_geometry().cut_wall_paths) {
		for (let i = 0; i < path.length; i++) {
			let p = path[i]
			let q = path[(i + 1) % path.length]
			area += p.x * q.y - q.x * p.y
		}
	}
	return Math.abs(area) / (2 * ctx.prism_union.grid_scale ** 2)
}

check('cut wall paths exclude doors and windows and are reused', () => {
	let f0 = opening_house([]).floors[0]
	let f = opening_house([
		{type: 'window', x: 1500, y: 0, rot: 0, w: 1200},
		{type: 'door', x: 4000, y: 0, rot: 0, w: 900},
	]).floors[0]
	assert.equal(cut_wall_area(f0) - cut_wall_area(f), (1200 + 900) * 180)
	let geometry = f.make_wall_geometry()
	assert.equal(f.make_wall_geometry(), geometry)
	f.house.make_faces(f, true)
	assert.equal(f.make_wall_geometry(), geometry)
})

check('cut walls update during opening moves and resizing without fix', () => {
	let h = opening_house([
		{type: 'window', x: 3000, y: 0, rot: 0, w: 1200},
	])
	let f = h.floors[0]
	let area = cut_wall_area(f)
	let fix = f.fix
	f.fix = () => { throw Error('unexpected fix during preview') }
	let move = f.start_move_object(f.objects[0])
	move.move(3000, -2000, 0)
	assert.equal(cut_wall_area(f), area + 1200 * 180)
	move.move(2000, 0, 0)
	assert.equal(cut_wall_area(f), area)
	f.fix = fix
	move.cancel()
	assert.equal(cut_wall_area(f), area)
	let resize = f.start_resize_object(f.objects[0], 1)
	f.fix = () => { throw Error('unexpected fix during preview') }
	resize.resize(300, 0)
	assert.equal(cut_wall_area(f), area - 300 * 180)
	f.fix = fix
	resize.stop()
	assert(h.undo())
	assert.equal(cut_wall_area(f), area)
	assert(h.redo())
	assert.equal(cut_wall_area(f), area - 300 * 180)
	f.remove_object(f.objects[0])
	assert.equal(cut_wall_area(f), area + 1200 * 180)
	assert(h.undo())
	assert.equal(cut_wall_area(f), area - 300 * 180)
})

check('cut wall paths follow a wall and its opening during preview', () => {
	let h = house({floors: [{lines: [[null, [0, 0], [6000, 0]]],
		objects: [{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}]}]})
	let f = h.floors[0]
	let geometry = f.make_wall_geometry()
	let paths = JSON.parse(JSON.stringify(geometry.cut_wall_paths))
	let area = cut_wall_area(f)
	let fix = f.fix
	f.fix = () => { throw Error('unexpected fix during preview') }
	let move = f.start_move_seg(f.segs[0])
	move.move(1000, 500, 0)
	let geometry1 = f.make_wall_geometry()
	assert.notEqual(geometry1, geometry)
	assert.equal(cut_wall_area(f), area)
	let scale = ctx.prism_union.grid_scale
	for (let path of paths)
		for (let p of path) {
			p.x += 1000 * scale
			p.y += 500 * scale
		}
	assert.equal(JSON.stringify(geometry1.cut_wall_paths), JSON.stringify(paths))
	f.fix = fix
	move.cancel()
	assert.equal(JSON.stringify(f.make_wall_geometry().cut_wall_paths),
		JSON.stringify(geometry.cut_wall_paths))
})

check('a window cuts a hole in the wall', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}])
	let polys = north_outer_polys(h)
	let holed = polys.filter(p => p.holes.length)
	assert.equal(holed.length, 1)
	let hole = holed[0].slice(holed[0].holes[0])
	let xs = hole.map(p => p[0])
	let zs = hole.map(p => p[1])
	assert.equal(Math.min(...xs), 2400)
	assert.equal(Math.max(...xs), 3600)
	assert.equal(Math.min(...zs), 1100)
	assert.equal(Math.max(...zs), 2300)
})

check('a window does not raise a wall below its sill', () => {
	for (let height of [600, 1000, 1100]) {
		let h = house({
			floor_h: height,
			floors: [{
				lines: [rect_lines(0, 0, 6000, 4000)],
				objects: [{type: 'window', x: 3000, y: 0, rot: 0}],
			}],
		})
		let polys = north_outer_polys(h)
		assert.equal(polys.length, 1)
		assert.equal(polys[0].holes.length, 0)
		let top_z = -Infinity
		for (let p of polys[0])
			top_z = Math.max(top_z, p[1])
		assert.equal(top_z, height)
	}
})

check('a door cuts a hole from the slab top up', () => {
	let h = opening_house([{type: 'door', x: 3000, y: 0, rot: 0, w: 900}])
	let polys = north_outer_polys(h)
	assert.equal(polys.length, 1)
	assert.equal(polys[0].holes.length, 1)
	let hole = polys[0].slice(polys[0].holes[0])
	let points = Array.from(hole, p => p.join())
	for (let p of ['2550,200', '3450,200', '2550,2300', '3450,2300'])
		assert(points.includes(p), p)
	assert.equal(points.length, 4)
})

check('an object that is not on a wall goes to the ground', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 500, rot: 0, w: 1200}])
	assert.equal(h.floors[0].objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	let h0 = opening_house([])
	assert.equal(h.make_faces(h.floors[0], true).length,
		h0.make_faces(h0.floors[0], true).length)
})

check('moving a wall moves its objects along', () => {
	let h = opening_house([
		{type: 'window', x: 3000, y: 0, rot: 0, w: 1200},
		{type: 'door', x: 6000, y: 2000, rot: 90, w: 900},
	])
	let f = h.floors[0]
	let seg = f.objects[0].seg
	let s = f.start_move_seg(seg)
	s.move(0, 500, 0)
	assert.equal(f.objects[0].y, 500)
	assert.equal(f.objects[0].x, 3000)
	assert.equal(f.objects[1].x, 6000)
	assert.equal(f.objects[1].y, 2000)
	s.stop()
	assert.equal(f.objects.length, 2)
	assert.equal(f.objects[0].seg, seg)
	assert(h.undo())
	assert.equal(f.objects[0].y, 0)
})

check('moving a free wall moves its objects along both axes', () => {
	let h = house({floors: [{lines: [[null, [0, 0], [6000, 0]]],
		objects: [{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}]}]})
	let f = h.floors[0]
	let s = f.start_move_seg(f.segs[0])
	s.move(1000, 500, 0)
	assert.equal(f.objects[0].x, 4000)
	assert.equal(f.objects[0].y, 500)
	s.stop()
	assert.equal(f.objects.length, 1)
	assert.equal(h.ground_objects.length, default_n)
})

check('dragging an object onto a wall snaps it to the floor, undo back', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = h.ground_objects[0] // a window
	let s = f.start_move_object(object)
	s.move(3000, 3000, 200)
	assert.equal(f.objects.length, 0)
	assert.equal(object.y, 3000)
	s.move(3000, 120, 200)
	assert.equal(f.objects.length, 1)
	assert.equal(h.ground_objects.length, default_n - 1)
	assert.equal(object.y, 0)
	assert.equal(object.x, 3000)
	assert.equal(object.rot, 0)
	s.move(6100, 2000, 200)
	assert.equal(object.x, 6000)
	assert.equal(object.y, 2000)
	assert.equal(object.rot, 90)
	s.stop()
	assert.equal(f.objects.length, 1)
	assert(h.undo())
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n)
})

check('a dragged object stops at its neighbor on the wall', () => {
	let h = opening_house([
		{type: 'window', x: 2000, y: 0, rot: 0, w: 1200},
		{type: 'window', x: 4000, y: 0, rot: 0, w: 1200},
	])
	let f = h.floors[0]
	let object = f.objects[1]
	let s = f.start_move_object(object)
	s.move(1500, 0, 200)
	assert.equal(object.x, 800)
	s.move(5990, 0, 200)
	assert.equal(object.x, 5360) // the east wall's face is at 5960.
	s.move(100, 0, 200)
	assert.equal(object.x, 640) // the west wall's face is at 40.
	s.stop()
	assert.equal(f.objects.length, 2)
})

check('neighbors listed out of order still stop a dragged object', () => {
	let h = opening_house([
		{type: 'window', x: 5000, y: 0, rot: 0, w: 1200},
		{type: 'window', x: 2800, y: 0, rot: 0, w: 1200},
		{type: 'door', x: 6000, y: 3000, rot: 90, w: 900},
		{type: 'door', x: 6000, y: 1000, rot: 90, w: 900},
	])
	let f = h.floors[0]
	let s = f.start_move_object(f.objects[0]) // the window at 5000.
	s.move(2500, 0, 200) // into the window at 2800: the gap before it.
	assert.equal(f.objects[0].x, 1600)
	s.cancel()
	s = f.start_move_object(f.objects[2]) // the door at y 3000.
	s.move(6000, 1200, 200) // into the door at y 1000: the gap after it.
	assert.equal(f.objects[2].y, 1900)
	s.cancel()
})

check('a cancelled object move restores both lists', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let s = f.start_move_object(h.ground_objects[0])
	s.move(3000, 0, 200)
	assert.equal(f.objects.length, 1)
	s.cancel()
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n)
})

check('objects are removed and added as one undoable edit each', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}])
	let f = h.floors[0]
	f.remove_object(f.objects[0])
	assert.equal(f.objects.length, 0)
	f.remove_object(h.ground_objects[0])
	assert.equal(h.ground_objects.length, default_n - 1)
	f.add_object({type: 'door', x: 0, y: 0, rot: 0, w: 800}, 100.4, -2000,
		200)
	assert.equal(h.ground_objects.length, default_n)
	assert.equal(JSON.stringify(h.save_object(h.ground_objects.at(-1))),
		JSON.stringify({type: 'door', x: 100, y: -2000, rot: 0, w: 800,
			mirror: false}))
	assert(h.undo())
	assert.equal(h.ground_objects.length, default_n - 1)
	assert(h.undo())
	assert.equal(h.ground_objects.length, default_n)
	assert(h.undo())
	assert.equal(f.objects.length, 1)
})

check('space cycles the four orientations of a door, one edit each', () => {
	let h = opening_house([{type: 'door', x: 3000, y: 0, rot: 0, w: 900}])
	let f = h.floors[0]
	let door = f.objects[0]
	let update = ctx.house_object_types.door.update
	let key = ' '
	ctx.ui = {keydown: k => k == key} // the keys pressed this frame.
	let edit_no = h.edit_no
	let orientations = []
	for (let i = 0; i < 4; i++) {
		update(f, door)
		orientations.push([door.rot, door.mirror])
	}
	assert.deepEqual(orientations,
		[[0, true], [180, false], [180, true], [0, false]])
	assert.equal(h.edit_no, edit_no + 4)
	key = 'a'
	update(f, door)
	assert.equal(h.edit_no, edit_no + 4) // another key changes nothing.
	assert.equal(f.objects[0], door)
	assert(h.undo())
	assert.deepEqual([f.objects[0].rot, f.objects[0].mirror], [180, true])
	assert.equal(ctx.house_object_types.window.update, undefined)
	delete ctx.ui
})

check('mirror is saved and loaded, a window has none', () => {
	let h = opening_house([
		{type: 'door', x: 3000, y: 0, rot: 180, w: 900, mirror: true},
		{type: 'window', x: 1000, y: 0, rot: 0, w: 1200},
	])
	let state = h.save_state()
	assert.equal(state.floors[0].objects[0].mirror, true)
	assert(!('mirror' in state.floors[0].objects[1]))
	assert.equal(JSON.stringify(house(state).save_state()),
		JSON.stringify(state))
	assert.equal(h.ground_objects[1].mirror, false) // the default door.
})

check('a moved door keeps its facing on a wall of the same direction', () => {
	let h = opening_house([{type: 'door', x: 3000, y: 0, rot: 180, w: 900,
		mirror: true}])
	let f = h.floors[0]
	let door = f.objects[0]
	let s = f.start_move_object(door)
	s.move(1500, 0, 200)
	assert.equal(door.rot, 180)
	s.move(6000, 2000, 200) // the east wall: runs along y.
	assert.equal(door.rot, 90)
	s.move(3000, 4000, 200) // the south wall again.
	assert.equal(door.rot, 0)
	assert.equal(door.mirror, true)
	s.cancel()
})

check('deleting a wall moves its objects to the ground, undo back', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}])
	let f = h.floors[0]
	f.delete_seg(f.objects[0].seg)
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	assert(h.undo())
	assert.equal(f.objects.length, 1)
	assert.equal(h.ground_objects.length, default_n)
	assert(h.redo())
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
})

// a free wall from (0, 0) to (6000, 0) with a window centered at x, its
// right end dragged to x2.
function shorten_window_wall(x, x2) {
	let h = house({floors: [{lines: [[null, [0, 0], [6000, 0]]],
		objects: [{type: 'window', x: x, y: 0, rot: 0, w: 1200}]}]})
	let f = h.floors[0]
	let p = f.ps.find(p => p[0] == 6000)
	let r = f.start_resize_seg(p, 6000, 0, x2 - 6000, 0, 1, 0)
	r.resize(x2 - 6000, 0, 20)
	r.stop()
	return h
}

check('a shortened wall pushes its objects along', () => {
	let h = shorten_window_wall(5000, 5200)
	let f = h.floors[0]
	assert.equal(f.segs[0].m2, 5200)
	assert.equal(f.objects.length, 1)
	assert.equal(f.objects[0].x, 4600)
	assert.equal(f.objects[0].seg, f.segs[0])
})

check('an object past the end of a shortened wall goes to the ground', () => {
	let h = shorten_window_wall(5000, 4900)
	assert.equal(h.floors[0].objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	assert.equal(h.ground_objects.at(-1).x, 5000)
})

check('a pasted object goes where a dropped one would', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let state = h.save_object(h.ground_objects[1]) // the door.
	f.add_object(state, 3000, 120, 200)
	assert.equal(f.objects.length, 1)
	assert.equal(f.objects[0].y, 0)
	assert.equal(f.objects[0].x, 3000)
	assert.equal(h.ground_objects.length, default_n)
	assert.throws(() => f.add_object({type: 'sofa'}, 0, 0, 200))
	assert(h.undo())
	assert.equal(f.objects.length, 0)
})

check('a seg has the faces of its wall, lower first', () => {
	let h = opening_house([
		{type: 'window', x: 3000, y: 0, rot: 0, w: 1200},
		{type: 'door', x: 6000, y: 2000, rot: 90, w: 900},
		{type: 'window', x: 3000, y: 4000, rot: 0, w: 1200},
		{type: 'window', x: 0, y: 2000, rot: 90, w: 1200},
	])
	let f = h.floors[0]
	let ranges = []
	for (let object of f.objects)
		ranges.push([object.seg.wall_a1, object.seg.wall_a2])
	assert.equal(JSON.stringify(ranges),
		JSON.stringify([[-140, 40], [5960, 6140], [3960, 4140], [-140, 40]]))
})

check('the saved state of an object has no seg', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}])
	let f = h.floors[0]
	assert(f.objects[0].seg)
	assert(!('seg' in h.save_object(f.objects[0])))
	let edit_no = h.edit_no
	let object = h.ground_objects[0]
	let s = f.start_move_object(object) // moved where it is: no edit.
	s.move(object.x, object.y, 0)
	assert('seg' in object)
	s.stop()
	assert.equal(h.edit_no, edit_no)
})

check('a window resizes from either end, the other end stays', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0, w: 1200}])
	let f = h.floors[0]
	let object = f.objects[0]
	let s = f.start_resize_object(object, 1)
	s.resize(400, 0) // the right end at 3600 moves to 4000.
	assert.equal(object.w, 1600)
	assert.equal(object.x, 3200) // the left end stays at 2400.
	s.resize(-200, 0) // the move is from the press, not from the last move.
	assert.equal(object.w, 1000)
	assert.equal(object.x, 2900)
	s.stop()
	assert(h.undo())
	object = f.objects[0] // undo rebuilds the objects.
	assert.equal(object.w, 1200)
	assert.equal(object.x, 3000)
	s = f.start_resize_object(object, -1)
	s.resize(-400, 0) // the left end at 2400 moves to 2000.
	assert.equal(object.w, 1600) // the right end stays at 3600.
	assert.equal(object.x, 2800)
	s.cancel()
	assert.equal(f.objects[0].w, 1200)
})

check('a window resize stops at its neighbor and at the wall end', () => {
	let h = opening_house([
		{type: 'window', x: 3000, y: 0, rot: 0, w: 1200},
		{type: 'window', x: 5000, y: 0, rot: 0, w: 1200},
	])
	let f = h.floors[0]
	let object = f.objects[0]
	let s = f.start_resize_object(object, 1)
	s.resize(5400, 0)
	assert.equal(object.w, 2000) // up to the neighbor's edge at 4400.
	assert.equal(object.x, 3400)
	s.cancel()
	object = f.objects[0] // cancel rebuilds the objects.
	s = f.start_resize_object(object, -1)
	s.resize(-3400, 0)
	assert.equal(object.w, 3560) // up to the west wall's face at 40.
	assert.equal(object.x, 1820)
	s.cancel()
})

check('an opening stays off the face of a wall that meets its wall', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000),
		rect_lines(3000, 0, 0, 4000)]}]})
	let f = h.floors[0]
	f.add_object({type: 'window', x: 0, y: 0, rot: 0}, 3050, 0, 200)
	assert.equal(f.objects.length, 1)
	assert.equal(f.objects[0].x, 3640) // the partition's face is at 3040.
	f.add_object({type: 'window', x: 0, y: 0, rot: 0}, 2950, 0, 200)
	assert.equal(f.objects.at(-1).x, 2360) // its other face is at 2960.
})

check('a door resizes in 10 cm steps between 60 and 110 cm', () => {
	let h = opening_house([{type: 'door', x: 6000, y: 2000, rot: 90, w: 900}])
	let f = h.floors[0]
	let object = f.objects[0]
	let s = f.start_resize_object(object, 1)
	s.resize(0, 250)
	assert.equal(object.w, 1100)
	s.resize(0, -200)
	assert.equal(object.w, 700)
	assert.equal(object.y, 1900) // the end at 1550 stays.
	assert.equal(object.x, 6000)
	s.resize(0, -1450)
	assert.equal(object.w, 600)
	s.stop()
	s = f.start_resize_object(object, -1) // rot 90: the end at larger y stays.
	s.resize(0, -550)
	assert.equal(object.w, 1100)
	assert.equal(object.y, 1600) // the end at 2150 stays.
	s.cancel()
})

check('an object off the wall resizes with no limit', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = h.ground_objects[0] // a window
	let s = f.start_resize_object(object, 1)
	s.resize(4400, 0)
	assert.equal(object.w, 5600)
	s.stop()
	assert(h.undo())
	assert.equal(h.ground_objects[0].w, 1200)
})

// furniture: the room of opening_house has its faces at 40 and 5960 (x), 40
// and 3960 (y).
function add_furniture(f, type, rot, x, y, snap_d) {
	f.add_object({type: type, x: 0, y: 0, rot: rot}, x, y, snap_d)
	return f.objects.at(-1)
}

check('furniture rests its snapping face against the wall it is near', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 3000, 1100, 200)
	assert.equal(f.objects.length, 1)
	assert.equal(object.rot, 0)
	assert.equal(object.y, 1040) // the head against the north face at 40.
	assert.equal(object.x, 3000)
	assert(object.on_floor)
	assert(!object.seg)
})

check('furniture turns to a snapping face when pushed against a wall', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 5200, 2000, 200)
	assert.equal(object.rot, 90) // the head is at the east wall.
	assert.equal(object.x, 4960)
	assert.equal(object.y, 2000)
	let s = f.start_move_object(object)
	s.move(3000, 2000, 200)
	assert.equal(object.rot, 90) // it stays turned off the wall.
	assert.equal(object.x, 3000)
	assert.equal(f.objects.length, 1)
	s.cancel()
})

check('furniture snaps to two walls in a corner', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 90, 5000, 780, 200)
	assert.equal(object.x, 4960)
	assert.equal(object.y, 740)
	assert(object.on_floor)
})

check('furniture not fully inside a room goes to the ground', () => {
	let h = opening_house([])
	let f = h.floors[0]
	add_furniture(f, 'bed', 0, 3000, -2000, 200)
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	let object = h.ground_objects.at(-1)
	assert(!object.on_floor)
	let s = f.start_move_object(object)
	s.move(3000, 100, 0) // its head is in the north wall.
	assert.equal(f.objects.length, 0)
	s.move(3000, 2000, 0)
	assert.equal(f.objects.length, 1)
	s.stop()
})

check('furniture across a partition is on the ground', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 4000),
		rect_lines(3000, 0, 0, 4000)]}]})
	let f = h.floors[0]
	let chair = add_furniture(f, 'chair', 0, 1500, 2000, 0)
	assert.equal(f.objects.length, 1)
	assert(chair.on_floor)
	let s = f.start_move_object(chair)
	s.move(3000, 2000, 0)
	assert.equal(f.objects.length, 0)
	s.move(4500, 2000, 0)
	assert.equal(f.objects.length, 1)
	s.cancel()
})

check('furniture goes to the ground with its room, undo back', () => {
	let h = opening_house([])
	let f = h.floors[0]
	add_furniture(f, 'chair', 0, 3000, 2000, 0)
	assert.equal(f.objects.length, 1)
	f.delete_seg(f.segs[0])
	assert.equal(f.objects.length, 0)
	assert.equal(h.ground_objects.length, default_n + 1)
	assert(h.undo())
	assert.equal(f.objects.length, 1)
	assert.equal(h.ground_objects.length, default_n)
})

check('furniture is saved with its depth and loaded back in the room', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 3000, 2000, 0)
	assert.equal(JSON.stringify(h.save_object(object)),
		JSON.stringify({type: 'bed', x: 3000, y: 2000, rot: 0, w: 1400,
			l: 2000}))
	let h2 = house(h.save_state())
	assert.equal(h2.floors[0].objects.length, 1)
	assert(h2.floors[0].objects[0].on_floor)
	let h0 = opening_house([]) // a bed in a room cuts no hole in a wall.
	assert.equal(h.make_faces(f, true).length,
		h0.make_faces(h0.floors[0], true).length)
})

check('a bed resizes through its width list', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 3000, 2000, 0)
	let s = f.start_resize_object(object, 1)
	s.resize(200, 0)
	assert.equal(object.w, 1600)
	assert.equal(object.x, 3100)
	s.resize(5300, 0)
	assert.equal(object.w, 1800)
	s.resize(-3700, 0)
	assert.equal(object.w, 900)
	s.cancel()
})

check('a rect touches the house when it meets an outline or is inside', () => {
	let f = opening_house([]).floors[0] // the outer faces are at -140 and 6140.
	assert(!f.is_rect_touching_house(2000, -2500, 3000, -1500))
	assert(!f.is_rect_touching_house(2000, -300, 3000, -141))
	assert(f.is_rect_touching_house(2000, -300, 3000, -140)) // touching.
	assert(f.is_rect_touching_house(2000, -300, 3000, -100)) // across a wall.
	assert(f.is_rect_touching_house(2000, 1000, 3000, 2000)) // inside.
	assert(f.is_rect_touching_house(-1000, -1000, 7000, 5000)) // around it.
})

check('a bed resize stops at the walls of its room', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 2500, 4000)]}]})
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 1500, 2000, 0)
	let s = f.start_resize_object(object, 1) // the left end stays at 800.
	s.resize(6800, 0)
	assert.equal(object.w, 1600) // 1800 would reach 2600, past the face at 2460.
	assert(object.on_floor)
	s.stop()
	object = add_furniture(f, 'bed', 0, 1500, 2000, 0)
	s = f.start_resize_object(object, -1) // the right end stays at 2200.
	s.resize(-9800, 0)
	assert.equal(object.w, 1800)
	assert.equal(object.x, 1300) // the left end is at 400: 1800 fits.
	s.cancel()
})

check('a bed resizes along its length from the foot only', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let object = add_furniture(f, 'bed', 0, 3000, 2000, 0) // head at y 1000.
	let s = f.start_resize_object(object, 1, 'l')
	s.resize(0, -100)
	assert.equal(object.l, 1900)
	assert.equal(object.y, 1950) // the head stays at 1000.
	s.resize(0, 500)
	assert.equal(object.l, 2000)
	assert.equal(object.y, 2000)
	s.cancel()
})

check('a bed length resize stops at the wall of its room', () => {
	let h = house({floors: [{lines: [rect_lines(0, 0, 6000, 1990)]}]})
	let f = h.floors[0] // the faces are at 40 and 1950 (y).
	f.add_object({type: 'bed', x: 0, y: 0, rot: 0, l: 1900}, 3000, 980, 200)
	let object = f.objects.at(-1)
	assert(object.on_floor)
	assert.equal(object.y, 990) // the head against the north face.
	let s = f.start_resize_object(object, 1, 'l')
	s.resize(0, 500)
	assert.equal(object.l, 1900) // 2000 would reach 2040.
	s.cancel()
})

check('a snapped bed can change length while its head stays at the wall', () => {
	let h = opening_house([])
	let f = h.floors[0]
	f.add_object({type: 'bed', rot: 0, l: 1900}, 3000, 980, 200)
	let object = f.objects.at(-1)
	let s = f.start_resize_object(object, 1, 'l')
	s.resize(0, 100)
	assert.equal(object.l, 2000)
	assert.equal(object.y - object.l / 2, 40)
	s.resize(0, 0)
	assert.equal(object.l, 1900)
	assert.equal(object.y - object.l / 2, 40)
	s.cancel()
})

check('a chair in a corner turns by 45 degrees and keeps its measured box', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let chair = add_furniture(f, 'chair', 0, 300, 300, 200)
	assert.equal(chair.rot, 315) // its back to the north-west corner.
	assert.equal(chair.x, 265) // the measured square stays against both walls.
	assert.equal(chair.y, 265)
	assert(chair.on_floor)
	assert.equal(chair.side_x[1], 40)
	assert.equal(chair.side_y[1], 40)
	let s = f.start_move_object(chair)
	for (let i = 0; i < 8; i++) {
		s.move(300, 300, 200)
		assert.equal(chair.x, 265)
		assert.equal(chair.y, 265)
		assert.equal(chair.rot, 315)
		assert(chair.side_x && chair.side_y)
	}
	s.stop()
	chair = add_furniture(f, 'chair', 0, 5700, 3700, 200)
	assert.equal(chair.rot, 135) // south-east.
	assert.equal(chair.x, 5735)
	assert.equal(chair.y, 3735)
	chair = add_furniture(f, 'chair', 0, 5700, 300, 200)
	assert.equal(chair.rot, 45) // north-east.
	chair = add_furniture(f, 'chair', 0, 300, 3700, 200)
	assert.equal(chair.rot, 225) // south-west.
})

check('a diagonal chair turns back to a wall and stays turned off it', () => {
	let h = opening_house([])
	let f = h.floors[0]
	let chair = add_furniture(f, 'chair', 0, 300, 300, 200)
	let s = f.start_move_object(chair)
	s.move(3000, 2000, 0)
	assert.equal(chair.rot, 315) // stays turned.
	assert(chair.on_floor)
	s.move(3000, 300, 200)
	assert.equal(chair.rot, 0) // the back at the north wall.
	assert.equal(chair.y, 265)
	assert(!chair.side_x)
	assert.equal(chair.side_y[0], 0)
	s.cancel()
})

check('furniture records the room sides it rests against', () => {
	let f = opening_house([]).floors[0]
	let bed = add_furniture(f, 'bed', 0, 3000, 1100, 200)
	assert(!bed.side_x)
	assert.deepEqual(Array.from(bed.side_y), [0, 40, 5960, 40])
	let calls = []
	let draw_length = (cx, view, x1, y1, x2, y2) => calls.push([x1, y1, x2, y2])
	ctx.house_object_types.bed.draw_wall_dims(null, null, f, bed, draw_length)
	assert.deepEqual(calls, [[5960, 40, 3700, 40], [2300, 40, 40, 40]])
	calls.length = 0
	ctx.house_object_types.bed.draw_sizes(null, null, f, bed, draw_length)
	assert.deepEqual(calls, [[3700, 2040, 2300, 2040], [3700, 40, 3700, 2040]])
})

check('a window shows its width and its distances to the wall ends', () => {
	let h = opening_house([{type: 'window', x: 3000, y: 0, rot: 0}])
	let f = h.floors[0]
	let window = f.objects[0]
	let calls = []
	let draw_length = (cx, view, x1, y1, x2, y2) => calls.push([x1, y1, x2, y2])
	let type = ctx.house_object_types.window
	type.draw_sizes(null, null, f, window, draw_length)
	assert.deepEqual(calls, [[2400, -140, 3600, -140]])
	calls.length = 0
	type.draw_wall_dims(null, null, f, window, draw_length)
	assert.deepEqual(calls,
		[[40, -140, 2400, -140], [3600, -140, 5960, -140]])
})

console.log(n_checks + ' house plan checks passed')
