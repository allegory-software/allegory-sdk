// run: node tests/roof_eave_drag_probe_test.js
// investigation: drags eaves of the demo plans (all eaves, then each eave
// alone) to many overhangs and prints the cases where make_roof_faces()
// fails. env PLAN=name limits the plans.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const sdk = path.resolve(__dirname, '..')
const ctx = {
	console: {...console, log() {}, group() {}, groupCollapsed() {},
		groupEnd() {}},
	setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
	ui: {keypressed: k => false},
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let name of ['glue.js', 'earcut.js', '3d.js', 'plane_graph.js',
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js', 'house_plan.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}
vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
	.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)

function roof_sides(floor) {
	let areas = []
	for (let area of floor.make_areas())
		if (area.kind == 'roof')
			areas.push(area)
	let sides = []
	if (areas.length)
		floor.make_roof_faces(areas, sides)
	return sides
}

// a 20 cm step in one wall: a short side between an inside and an outside
// corner.
ctx.house_test_plans.step20 = {floors: [{lines: [['draw', 0, 0,
	600, 400, -300, -20, -300, -380]]}]}

let overhangs = [0, 1, 5, 10, 20, 40, 59, 61, 80, 100, 150, 200, 300, 500]
// fractional overhangs, as the editor makes from pointer moves / view scale.
for (let i = 1; i < 400; i += 7)
	overhangs.push(i / 1.4475235901201562)
let n_fails = 0
for (let name in ctx.house_test_plans) {
	if (process.env.PLAN && name != process.env.PLAN)
		continue
	let h = ctx.house_plan(ctx.house_test_plans[name])
	for (let floor of h.floors) {
		let sides
		try {
			sides = roof_sides(floor)
		} catch (e) {
			console.info('FAIL', name, 'floor', floor.i, 'as loaded')
			n_fails++
			continue
		}
		for (let side_i = -1; side_i < sides.length; side_i++) {
			for (let overhang of overhangs) {
				let side = sides[side_i < 0 ? 0 : side_i]
				if (!side)
					continue
				let is_one = side_i >= 0
				let roof = floor.roof
				let mid = (side.m1 + side.m2) / 2 / ctx.prism_union.grid_scale
				let m = floor.start_move_eave(side, mid, mid)
				let overhang0 = is_one
					? side.edge_point?.overhang ?? roof.overhang : roof.overhang
				let dd = overhang - overhang0
				m.move(dd * side.nx, dd * side.ny, is_one)
				try {
					roof_sides(floor)
				} catch (e) {
					n_fails++
					console.info('FAIL', name, 'floor', floor.i,
						is_one ? 'side '+side_i : 'all', 'overhang', overhang,
						JSON.stringify(floor.save_state().roof))
				}
				m.cancel()
				sides = roof_sides(floor)
			}
		}
	}
}
console.info(n_fails+' fails')
if (n_fails)
	process.exitCode = 1
