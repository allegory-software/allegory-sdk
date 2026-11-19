// run: node tests/house_plan_bench.js
// times house_plan() fixes on a grid of rooms, for the cost of the walls and
// horizontal faces rebuilt on every fix.
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
	'house_plan.js']) {
	// env SDK=dir loads dir/www/prism_union.js instead (a changed copy).
	let file = path.join(name == 'prism_union.js' && process.env.SDK || sdk,
		'www', name)
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

for (let [cols, rows, floor_n] of [[3, 2, 2], [6, 4, 3], [10, 6, 3]]) {
	let floors = []
	for (let i = 0; i < floor_n; i++)
		floors.push({lines: grid_lines(cols, rows)})
	let house = ctx.house_plan({version: 1, floors: floors})
	let floor = house.floors[0]
	let top_floor = house.floors[floor_n-1]
	let n = 20
	let faces
	let t0 = performance.now()
	for (let i = 0; i < n; i++) {
		floor.fix()
		faces = house.make_faces(top_floor, false)
	}
	let dt = (performance.now() - t0) / n
	console.info(cols+'x'+rows+' rooms, '+floor_n+' floors: '
		+dt.toFixed(2)+' ms per fix and make_faces, '
		+faces.length+' faces')
}
