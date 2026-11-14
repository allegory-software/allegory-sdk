// run: node tests/house_faces_compare_test.js
// compares make_faces() (prism_union) with make_polys() of commit ae94aeea,
// the cell-grid and edge-cancelling code it replaced: same polygons per
// plane on the sample plans, open rooms, islands and room grids, cut at each
// floor (the old code always had a slab on top of the whole house).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const {execSync} = require('node:child_process')

const sdk = path.resolve(__dirname, '..')

function make_ctx(house_plan_src) {
	let ctx = {
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
		'roof_skeleton.js', 'clipper2.js', 'prism_union.js']) {
		let file = path.join(sdk, 'www', name)
		vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
	}
	vm.runInContext(house_plan_src, ctx, {filename: 'house_plan.js'})
	vm.runInContext(fs.readFileSync(path.join(sdk, 'www/ui-demo.html'), 'utf8')
		.match(/<script id=house_test_plans>([\s\S]*?)<\/script>/)[1], ctx)
	return ctx
}

const new_ctx = make_ctx(fs.readFileSync(
	path.join(sdk, 'www/house_plan.js'), 'utf8'))
const old_ctx = make_ctx(execSync('git show ae94aeea:www/house_plan.js',
	{cwd: sdk, encoding: 'utf8'}))

// canonical text of a loop: points from the lowest one, in loop order.
function loop_key(ps) {
	let min_i = 0
	for (let i = 1; i < ps.length; i++) {
		let [m, z] = ps[i]
		let [min_m, min_z] = ps[min_i]
		if (z < min_z || z == min_z && m < min_m)
			min_i = i
	}
	return JSON.stringify([...ps.slice(min_i), ...ps.slice(0, min_i)])
}

// canonical text of a poly2 with holes, ccw outline in 2D.
function poly_key(plane_key, poly) {
	let loops = []
	let ends = [...(poly.holes ?? []), poly.length]
	let i1 = 0
	for (let i2 of ends) {
		let ps = []
		for (let i = i1; i < i2; i++)
			ps.push([poly[i][0], poly[i][1]])
		loops.push(loop_key(ps))
		i1 = i2
	}
	let [outline, ...holes] = loops
	holes.sort()
	return plane_key+' '+outline+' '+holes.join(' ')
}

// cut at top_floor: no slab on top, which make_faces() no longer has.
function old_keys(h, top_floor) {
	let [wall_polys, horizontal_polys] = h.make_polys(top_floor, true)
	let keys = []
	for (let poly of wall_polys)
		keys.push(poly_key('w '+poly.is_v+' '+poly.axis+' '+poly.normal, poly))
	for (let poly of horizontal_polys)
		keys.push(poly_key('h '+poly.z+' '+poly.normal, poly))
	return keys.sort()
}

// faces to 2D polys: same conversion as house_plan_test.js face_poly().
// cut at top_floor: no roof.
function new_keys(h, top_floor) {
	let keys = []
	for (let face of h.make_faces(top_floor, true)) {
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
		let is_ccw = area > 0
		let poly = []
		poly.holes = []
		for (let ring2 of rings2) {
			if (poly.length)
				poly.holes.push(poly.length)
			if (!is_ccw)
				ring2.reverse()
			for (let p of ring2)
				poly.push(p)
		}
		let plane_key = is_flat
			? 'h '+z0+' '+(is_ccw ? 1 : -1)
			: 'w '+is_x+' '+(is_x ? x0 : y0)+' '+((is_ccw == is_x) ? 1 : -1)
		keys.push(poly_key(plane_key, poly))
	}
	return keys.sort()
}

function rect_lines(x, y, w, h) {
	return ['draw', x, y, w, h, -w, -h]
}

function grid_lines(cols, rows) {
	let w = cols * 300
	let h = rows * 300
	let lines = [rect_lines(0, 0, w, h)]
	for (let i = 1; i < cols; i++)
		lines.push(['draw', i * 300, 0, 0, h])
	for (let j = 1; j < rows; j++)
		lines.push(['draw', 0, j * 300, w])
	return lines
}

let houses = [] // [[name, state], ...]
for (let name in new_ctx.house_test_plans)
	houses.push([name, new_ctx.house_test_plans[name]])
houses.push(['grid 3x2x2', {floors: [
	{lines: grid_lines(3, 2)},
	{lines: grid_lines(3, 2)},
]}])
houses.push(['open rooms over a grid', {floors: [
	{lines: grid_lines(3, 2)},
	{lines: grid_lines(3, 2), room_points: [
		{x: 100, y: 100, is_open: true},
		{x: 400, y: 400, is_open: true},
	]},
	{lines: [rect_lines(0, 0, 600, 600)]},
]}])
houses.push(['island in an open room', {floors: [
	{lines: [rect_lines(0, 0, 600, 400)]},
	{lines: [rect_lines(0, 0, 600, 400), rect_lines(200, 100, 100, 100)],
		room_points: [{x: 100, y: 200, is_open: true}]},
]}])
houses.push(['overflow and underflow', {floors: [
	{lines: [rect_lines(0, 0, 600, 400)]},
	{lines: [rect_lines(300, 200, 600, 400)]},
	{lines: [rect_lines(0, 0, 200, 400), rect_lines(400, 0, 200, 400)]},
]}])

let n = 0
for (let [name, state] of houses) {
	let old_h = old_ctx.house_plan(JSON.parse(JSON.stringify(state)))
	let new_h = new_ctx.house_plan(JSON.parse(JSON.stringify(state)))
	let floor_n = new_h.floors.length
	for (let i = 0; i < floor_n; i++) {
		let msg = name+', floors 0..'+i+' cut'
		assert.deepEqual(new_keys(new_h, new_h.floors[i]),
			old_keys(old_h, old_h.floors[i]), msg)
		n++
	}
}
console.log(n + ' house face comparisons passed')
