// run: node tests/model3_test.mjs [path/to/model3.js]
import {chromium} from '/usr/local/lib/node_modules/playwright/index.mjs'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const sdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const www = f => path.join(sdk, 'www', f)
const files = {
	'/glue.js': www('glue.js'),
	'/earcut.js': www('earcut.js'),
	'/3d.js': www('3d.js'),
	'/gl.js': www('gl.js'),
	'/gl-renderer.js': www('gl-renderer.js'),
	'/model3.js': process.argv[2] ?? www('model3.js'),
}
const page_html = `<!DOCTYPE html><canvas id=c width=16 height=16></canvas>
<script src=glue.js global></script>
<script src=earcut.js></script>
<script src=3d.js global></script>
<script src=gl.js></script>
<script src=gl-renderer.js></script>
<script src=model3.js></script>`

const server = http.createServer(async (req, res) => {
	if (req.url == '/') {
		res.setHeader('content-type', 'text/html')
		return res.end(page_html)
	}
	if (!files[req.url]) {
		res.statusCode = 404
		return res.end()
	}
	res.setHeader('content-type', 'text/javascript')
	res.end(await fs.readFile(files[req.url]))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))

const browser = await chromium.launch({channel: 'chrome', headless: true,
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']})
const page = await browser.newPage()
page.on('pageerror', e => console.log('PAGE ERROR', e.message))
await page.goto(`http://127.0.0.1:${server.address().port}/`)

const results = await page.evaluate(() => {
	const results = []
	const canvas = document.getElementById('c')
	const gl = canvas.getContext('webgl2', {antialias: false})
	canvas.cw = 16
	canvas.ch = 16
	let n_checks = 0
	// a bug that is understood but not fixed yet: reported, doesn't fail the run.
	let known = []
	function known_bug(name, f) {
		let failed
		try {
			failed = f() !== true
		} catch (e) {
			failed = true
		}
		known.push([name, failed])
	}
	function check(name, f) {
		n_checks++
		let r
		if (gl.active_vao)
			gl.active_vao.unuse()
		if (gl.active_program)
			gl.active_program.unuse()
		try {
			r = f()
		} catch (e) {
			r = 'threw: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3)
				.map(s => s.trim().replace(/http:\/\/[^/]+\//, '')).join(' | ')
		}
		while (gl.getError()) {}
		if (r !== true)
			results.push([name, r === false ? '' : String(r)])
	}
	const near = (a, b) => Math.abs(a - b) < 1e-6
	const veq = (a, b) => Array.from(a).length == b.length &&
		Array.from(a).every((x, i) => near(x, b[i]))

	// a mock of the editor's undo stack, same shape as model3-editor.js.
	function make_editor() {
		let undo_stack = [], undo_groups = [], redo_stack = [], redo_groups = []
		let ed = {gl}
		ed.default_material = {name: 'mat', uv: v2(1, 1), diffuse_color: 0xffffff}
		ed.default_layer = {name: 'layer'}
		ed.child_added = ed.child_removed = ed.layer_changed = () => {}
		ed.push_undo = (f, ...args) => undo_stack.push(...args, args.length, f)
		ed.start_group = () => undo_groups.push(undo_stack.length)
		ed.undo = () => {
			let stack = undo_stack, groups = undo_groups
			let start = groups.pop()
			undo_groups = redo_groups
			undo_stack = redo_stack
			undo_groups.push(undo_stack.length)
			while (stack.length > start) {
				let f = stack.pop()
				let argc = stack.pop()
				f(...stack.splice(-argc))
			}
			undo_groups = groups
			undo_stack = stack
		}
		return ed
	}
	let next_id = 0
	function make_comp() {
		let ed = make_editor()
		let c = model3_component({name: 'c'}, ed)
		c.id = next_id++
		c.editor = ed
		return c
	}
	const live_faces = c => c.faces.filter(f => f.length)

	// a square in the z = 0 plane, counter-clockwise seen from +z.
	function add_square(c, x0, y0, s) {
		let pis = [
			c.add_point_xyz(x0    , y0    , 0),
			c.add_point_xyz(x0 + s, y0    , 0),
			c.add_point_xyz(x0 + s, y0 + s, 0),
			c.add_point_xyz(x0    , y0 + s, 0),
		]
		return c.add_face(pis)
	}

	check('points: add, get, ref counts, free list', () => {
		let c = make_comp()
		let a = c.add_point_xyz(1, 2, 3)
		let p = c.get_point(a, v3())
		return veq(p, [1, 2, 3]) && c.point_rc(a) == 0 && p.i == a
	})

	check('add_face creates the edge lines with rc 2', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		return c.line_count() == 4 && f.lis.every(li => c.line_rc(li) == 2) ||
			'rcs ' + f.lis.map(li => c.line_rc(li))
	})

	check('add_line / each_line', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		c.add_line(a, b)
		let n = 0
		c.each_line(l => n++)
		return n == 1
	})

	known_bug('undo of add_face leaves no live face', () => {
		let c = make_comp()
		c.editor.start_group()
		add_square(c, 0, 0, 1)
		c.editor.undo()
		return live_faces(c).length == 0 && c.face_renderer && true ||
			'live faces ' + live_faces(c).length
	})

	check('remove_face then add_face reuses a free index once', () => {
		let c = make_comp()
		let f1 = add_square(c, 0, 0, 1), f2 = add_square(c, 2, 0, 1)
		c.remove_face(f1)
		let f3 = add_square(c, 4, 0, 1)
		let f4 = add_square(c, 6, 0, 1)
		return f3.i != f4.i && f3.i != f2.i && f4.i != f2.i ||
			`indices ${f2.i} ${f3.i} ${f4.i}`
	})

	check('face.is_flat', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		return f.is_flat() === true
	})

	check('set_line_smoothness on an edge shared by two faces and back', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		let p = [c.add_point_xyz(0, 1, 0), c.add_point_xyz(1, 1, 0)]
		let q = [c.add_point_xyz(0, -1, 0), c.add_point_xyz(1, -1, 0)]
		let f1 = c.add_face([a, b, p[1], p[0]])
		let f2 = c.add_face([b, a, q[0], q[1]])
		let shared = f1.lis[0]
		c.set_line_smoothness(shared, 1)
		c.set_line_smoothness(shared, 0)
		return c.line_smoothness(shared) == 0
	})

	check('set_line_smoothness on a standalone line', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		let li = c.add_line(a, b)
		c.set_line_smoothness(li, 1)
		c.set_line_smoothness(li, 0)
		return true
	})

	check('set_line_smoothness stores a value that keeps the same category', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		let li = c.add_line(a, b)
		c.set_line_smoothness(li, 1)
		c.set_line_smoothness(li, 2)
		return c.line_smoothness(li) == 2 || 'smoothness ' + c.line_smoothness(li)
	})

	check('set_line_opacity stores a value that keeps the same category', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		let li = c.add_line(a, b)
		c.set_line_opacity(li, .5)
		return c.line_opacity(li) == .5 || 'opacity ' + c.line_opacity(li)
	})

	check('set_child_layer', () => {
		let c = make_comp(), child = make_comp()
		let node = c.add_child(child, mat4())
		c.set_child_layer(node, {name: 'l2'})
		return node.layer.name == 'l2'
	})

	check('bbox of a component with only a child', () => {
		let c = make_comp(), child = make_comp()
		let a = child.add_point_xyz(0, 0, 0), b = child.add_point_xyz(1, 1, 1)
		child.add_line(a, b)
		c.add_child(child, mat4())
		let bb = c.bbox()
		return !bb.is_empty() || 'bbox is empty'
	})

	check('point_hit_edge', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		let p = c.point_hit_edge(v3(.5, .05, 0), f, .1, (p1, p2) => p1.distance2(p2))
		return !!p && near(p[1], 0)
	})

	check('draw_line splits at an existing point', () => {
		let c = make_comp()
		let m = c.add_point_xyz(1, 0, 0)
		let q = c.add_point_xyz(1, 1, 0)
		c.add_line(m, q)
		c.draw_line(line3(v3(0, 0, 0), v3(2, 0, 0)))
		let n = 0
		c.each_line(l => n++)
		let used = 0
		for (let i = 0; i < c.point_count(); i++)
			if (c.point_rc(i))
				used++
		return (n == 3 && used == 4) ||
			`lines ${n}, used points ${used} (want 3 and 4: m-q and two halves, no duplicate of m)`
	})

	check('line_hit_points ignores points that no line or face uses', () => {
		let c = make_comp()
		c.add_point_xyz(1, 1, 0) // unused (rc 0), but lies on the line below.
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(2, 0, 0)
		c.add_line(a, b)
		let n = 0
		c.draw_line(line3(v3(0, 1, 0), v3(2, 1, 0)))
		c.each_line(l => n++)
		return n == 2 || 'lines: ' + n + ' (want 2: the new line is not split)'
	})

	known_bug('undo of add_line frees the line and its points', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		c.editor.start_group()
		let li = c.add_line(a, b)
		c.editor.undo()
		return c.line_rc(li) == 0 && c.point_rc(a) == 0 && c.point_rc(b) == 0 ||
			`line rc ${c.line_rc(li)}, point rcs ${c.point_rc(a)} ${c.point_rc(b)}`
	})

	check('draw_line crossing an existing line cuts both', () => {
		let c = make_comp()
		let a = c.add_point_xyz(1, -1, 0), b = c.add_point_xyz(1, 1, 0)
		c.add_line(a, b)
		c.draw_line(line3(v3(0, 0, 0), v3(2, 0, 0)))
		let n = 0
		c.each_line(l => n++)
		return n == 4 || 'lines: ' + n + ' (want 4)'
	})

	check('remove_selection of a selected face', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		c.select_face(f, 'add')
		c.remove_selection()
		return live_faces(c).length == 0
	})

	check('remove_selection of a selected line removes its faces', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		c.select_line(f.lis[0], 'add')
		c.remove_selection()
		return live_faces(c).length == 0
	})

	check('select_all does not select freed lines or faces', () => {
		let c = make_comp()
		let f1 = add_square(c, 0, 0, 1), f2 = add_square(c, 2, 0, 1)
		c.remove_face(f1)
		c.select_all(true, false)
		// removing a face leaves its 4 edges as standalone lines.
		let live_lines = 0
		c.each_line(l => live_lines++)
		return c.selected_face_count() == 1 && c.selected_line_count() == live_lines ||
			`faces ${c.selected_face_count()}, lines ${c.selected_line_count()} (want 1, ${live_lines})`
	})

	check('add(poly) uses the right point indices', () => {
		let c = make_comp()
		let p = poly3(0, 1, 2, 3)
		p.points = [0,0,0, 1,0,0, 1,1,0, 0,1,0]
		let f = c.add(p)
		return Array.from(f).every(pi => Number.isInteger(pi)) && f.length == 4 ||
			'face ' + Array.from(f)
	})

	check('update() of a component with a face', () => {
		let c = make_comp()
		add_square(c, 0, 0, 1)
		c.update(gl.mat4_instance_buffer(mat4f32()), gl.f32_instance_buffer(new Float32Array([0])))
		return true
	})

	check('remove_face makes update() report a change', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		let models = gl.mat4_instance_buffer(mat4f32())
		let disabled = gl.f32_instance_buffer(new Float32Array([0]))
		c.update(models, disabled)
		c.remove_face(f)
		return c.update(models, disabled) === true
	})

	check('update() with a smooth mesh', () => {
		let c = make_comp()
		let a = c.add_point_xyz(0, 0, 0), b = c.add_point_xyz(1, 0, 0)
		let p = [c.add_point_xyz(0, 1, 0), c.add_point_xyz(1, 1, 0)]
		let q = [c.add_point_xyz(0, 0, 1), c.add_point_xyz(1, 0, 1)]
		let f1 = c.add_face([a, b, p[1], p[0]])
		let f2 = c.add_face([b, a, q[0], q[1]])
		c.set_line_smoothness(f1.lis[0], 1)
		c.update(gl.mat4_instance_buffer(mat4f32()), gl.f32_instance_buffer(new Float32Array([0])))
		return true
	})

	check('start_pull on a lone square builds four side faces', () => {
		let c = make_comp()
		let f = add_square(c, 0, 0, 1)
		let p = v3(.5, .5, 0)
		p.face = f
		let pull = c.start_pull(p)
		pull.pull(2)
		let n = live_faces(c).length
		let zs = Array.from(f).map(pi => c.get_point(pi, v3())[2])
		return n == 5 && zs.every(z => near(z, 2)) ||
			`live faces ${n} (want 5), top z ${zs}`
	})

	return [n_checks, results, known]
})

const [n_checks, failures, known] = results
console.log(`${n_checks} checks`)
for (let [name, msg] of failures)
	console.log('FAIL', name, msg)
for (let [name, failed] of known)
	console.log(failed ? 'KNOWN BUG' : 'KNOWN BUG NOW PASSES', name)
console.log(failures.length ? `${failures.length} failed` : 'all passed')
await browser.close()
server.close()
process.exit(failures.length ? 1 : 0)
