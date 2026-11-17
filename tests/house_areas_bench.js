// run: node tests/house_areas_bench.js (add --jitless for the interpreter)
// times floor.make_areas() on a grid of rooms with a smaller floor above,
// for the cost of computing the roof areas on every frame in the editor.
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

// a cols x rows grid of 3000 x 3000 rooms.
function grid_lines(cols, rows) {
	let w = cols * 3000
	let h = rows * 3000
	let lines = [['draw', 0, 0, w, h, -w, -h]]
	for (let i = 1; i < cols; i++)
		lines.push(['draw', i * 3000, 0, 0, h])
	for (let j = 1; j < rows; j++)
		lines.push(['draw', 0, j * 3000, w])
	return lines
}

for (let [cols, rows] of [[3, 2], [6, 4], [10, 6]]) {
	let house = ctx.house_plan({version: 1, floors: [
		{lines: grid_lines(cols, rows)},
		{lines: grid_lines(cols - 1, rows - 1)},
	]})
	let floor = house.floors[0]
	let n = 200
	let areas
	let t0 = performance.now()
	for (let i = 0; i < n; i++)
		areas = floor.make_areas()
	let dt = (performance.now() - t0) / n
	console.info(cols+'x'+rows+' rooms: '+dt.toFixed(3)
		+' ms per make_areas, '+areas.length+' areas')
	let faces
	t0 = performance.now()
	for (let i = 0; i < n; i++)
		faces = floor.make_roof_faces(areas)
	dt = (performance.now() - t0) / n
	console.info(cols+'x'+rows+' rooms: '+dt.toFixed(3)
		+' ms per make_roof_faces, '+faces.length+' faces')
}
