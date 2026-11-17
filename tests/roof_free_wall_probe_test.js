// run: node tests/roof_free_wall_probe_test.js
// Cosmin's house with an L-shaped wall outside the ground floor. its inner
// side faces floor 1's wall 137.1 away: from overhang 138 its strip passed
// that wall and make_roof_faces() asserted in find_side() (fixed: a
// perimeter side from no area side is vertical). env FROM, TO, STEP:
// overhang sweep.
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
	'roof_skeleton.js', 'clipper2.js', 'prism_union.js',
	'house_plan_objects.js', 'house_plan.js']) {
	let file = path.join(sdk, 'www', name)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}

let state = {"rotation":4.71238898038469,"floor_h":250,"int_wall_thickness":8,"ext_wall_thickness":18,"slab_thickness":20,"roof_thickness":20,"floors":[{"points":[[-502.45658537899385,33.85981487060741,5],[-502.45658537899385,185.2882774723354,2],[-337.387141988658,-253.71603798898704,1],[-337.387141988658,185.2882774723354,7],[-337.387141988658,248.42134224814137,1],[-337.387141988658,579.1435520401468,7],[-235.47903139638808,579.1435520401468,7],[-235.47903139638808,990.9671498078355,5],[-78.95719583682137,-253.71603798898704,19],[-78.95719583682137,-5.472138867882414,3],[38.410175544852805,-5.472138867882414,107],[38.410175544852805,248.42134224814137,1],[38.410175544852805,348.12355918293235,1],[38.410175544852805,693.8877203178178,20],[38.410175544852805,990.9671498078355,2],[282.99669185585424,-5.472138867882414,6],[282.99669185585424,348.12355918293235,2],[282.99669185585424,693.8877203178178,1]],"lines":[[4,2,8,2,9,10,336,10,15,1,3,1,2,4,11,1,12,16,5,6,5,3,17,13,3,14,7,3,1,0,1,2,3,4,4,3,4,4,5,4,7,6,16,9,8,15,10,11,12,11,12,2,12,13,18,13,14,3,16,15,3,16,17]],"room_points":[],"area_points":[],"roof":{"pitch":20,"overhang":60,"edge_points":[]}},{"points":[[-337.387141988658,-144.30577653149416,1],[-337.387141988658,248.42134224814137,1],[-337.387141988658,579.1435520401468,7],[-235.47903139638808,579.1435520401468,7],[-235.47903139638808,774.1359043738951,5],[38.410175544852805,-144.30577653149416,19],[38.410175544852805,-5.472138867882414,3],[38.410175544852805,248.42134224814137,1],[38.410175544852805,348.12355918293235,6],[38.410175544852805,543.6579756685286,20],[38.410175544852805,774.1359043738951,2],[167.61859795522537,348.12355918293235,9],[414.4502181175354,-5.472138867882414,6],[414.4502181175354,543.6579756685286,1]],"lines":[[4,0,5,2,6,12,2,1,7,4,11,8,3,13,9,5,3,2,3,10,4,1,0,1,4,1,2,4,4,3,16,6,5,15,6,7,12,7,8,5,8,9,18,9,10,3,13,12]],"room_points":[{"x":-190.97063818035122,"y":71.61398931763216,"is_open":true},{"x":185.00280573721517,"y":190.97063818035167,"is_open":true}],"area_points":[],"roof":{"pitch":20,"overhang":60,"edge_points":[]}},{"points":[[-337.387141988658,248.42134224814137,1],[-337.387141988658,579.1435520401468,7],[38.410175544852805,248.42134224814137,1],[38.410175544852805,579.1435520401468,2]],"lines":[[4,0,2,3,3,1,4,0,1,18,2,3]],"room_points":[{"x":-190.97063818035122,"y":71.61398931763216,"is_open":true},{"x":185.00280573721517,"y":190.97063818035167,"is_open":true}],"area_points":[],"roof":{"pitch":20,"overhang":60,"edge_points":[]}}]}

let h = ctx.house_plan(state)
function roof_faces(floor) {
	let areas = []
	for (let area of floor.make_areas())
		if (area.kind == 'roof')
			areas.push(area)
	return areas.length ? floor.make_roof_faces(areas) : []
}
let from = Number(process.env.FROM ?? 0)
let to = Number(process.env.TO ?? 4000)
let step = Number(process.env.STEP ?? 10)
for (let floor of h.floors) {
	let first_fail
	let n_fails = 0
	for (let overhang = from; overhang <= to; overhang += step) {
		floor.roof.overhang = overhang
		try {
			roof_faces(floor)
		} catch (e) {
			first_fail ??= overhang
			n_fails++
		}
	}
	floor.roof.overhang = 600
	console.info('floor', floor.i, n_fails+' fails', 'first at', first_fail)
	if (n_fails)
		process.exitCode = 1
}
