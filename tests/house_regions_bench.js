// run: node tests/house_regions_bench.js (add --jitless for the interpreter)
// times floor.fix() against the per-floor regions of the whole house:
// make_areas() and slab_paths() of every floor. answers what recomputing
// the regions of all floors after every fix would add to a wall drag.
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
	let src = fs.readFileSync(file, 'utf8')
	if (name == 'house_plan.js') // reach the module-local slab_paths().
		src = src.replace('house.make_faces = function',
			'house.slab_paths = slab_paths; house.make_faces = function')
	vm.runInContext(src, ctx, {filename: file})
}

// a cols x rows grid of 300 x 300 rooms.
function grid_lines(cols, rows) {
	let w = cols * 300
	let h = rows * 300
	let lines = [['draw', 0, 0, w, h, -w, -h]]
	for (let i = 1; i < cols; i++)
		lines.push(['draw', i * 300, 0, 0, h])
	for (let j = 1; j < rows; j++)
		lines.push(['draw', 0, j * 300, w])
	return lines
}

function time(n, f) {
	let t0 = performance.now()
	for (let i = 0; i < n; i++)
		f()
	return (performance.now() - t0) / n
}

for (let [cols, rows, floor_n] of [[3, 2, 2], [6, 4, 3], [10, 6, 3]]) {
	let floors = []
	for (let i = 0; i < floor_n; i++)
		floors.push({lines: grid_lines(cols - i, rows),
			room_points: [{x: 150, y: 150, is_open: true}]})
	let house = ctx.house_plan({floors: floors})
	let floor = house.floors[0]
	let n = 50
	let fix_dt = time(n, () => floor.fix())
	let regions_dt = time(n, () => {
		let roof_paths0 = []
		for (let f of house.floors) {
			let areas = f.make_areas()
			house.slab_paths(house.floors[f.i-1], f, roof_paths0)
			roof_paths0 = []
			for (let area of areas)
				if (area.kind == 'roof')
					for (let p of area.paths)
						roof_paths0.push(p)
		}
	})
	console.info(cols+'x'+rows+' rooms, '+floor_n+' floors: fix '
		+fix_dt.toFixed(2)+' ms, regions of all floors '
		+regions_dt.toFixed(2)+' ms')
}
