// run: node tests/model3_test.mjs [path/to/model3.js]
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'
import {fileURLToPath} from 'node:url'

const sdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const www = f => path.join(sdk, 'www', f)

// the browser globals that the scripts use when they load.
globalThis.window = globalThis
globalThis.navigator = {userAgent: '', language: 'en-US'}
globalThis.addEventListener = () => {}
globalThis.document = {currentScript: {hasAttribute: k => k == 'global'}}

// load the scripts as the browser would, in global scope.
const scripts = [ // [[file, name],...]
	[www('glue.js'), 'glue.js'],
	[www('earcut.js'), 'earcut.js'],
	[www('3d.js'), '3d.js'],
	[process.argv[2] ?? www('model3.js'), 'model3.js'],
]
for (let [file, name] of scripts)
	vm.runInThisContext(await fs.readFile(file, 'utf8'), {filename: name})

// geometry needs no WebGL: buffers and renderers that store nothing.
const gl_obj = {set() {}, free() {}}
const gl_factories = ['dyn_arr_v3_buffer', 'dyn_arr_u32_index_buffer',
	'points_renderer', 'faces_renderer', 'solid_lines_renderer',
	'dashed_lines_renderer', 'fat_lines_renderer']
const gl = {}
for (let k of gl_factories)
	gl[k] = () => gl_obj

const results = (function() {
	const results = []
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
		try {
			r = f()
		} catch (e) {
			r = 'threw: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3)
				.map(s => s.trim()).join(' | ')
		}
		if (r !== true)
			results.push([name, r === false ? '' : String(r)])
	}
	const near = (a, b) => Math.abs(a - b) < 1e-6
	const veq = (a, b) => Array.from(a).length == b.length &&
		Array.from(a).every((x, i) => near(x, b[i]))

	// a mock of the editor's undo stack, same shape as model3_editor.js.
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
		ed.redo = () => {
			let start = redo_groups.pop()
			undo_groups.push(undo_stack.length)
			while (redo_stack.length > start) {
				let f = redo_stack.pop()
				let argc = redo_stack.pop()
				f(...redo_stack.splice(-argc))
			}
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

	check('undo of add_face leaves no live face', () => {
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

	check('undo of add_line frees the line and its points', () => {
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

	// ref count errors: a face edge must join its points, a line's rc is
	// 1 + the faces using it, a point's rc is the faces and lines using it.
	function check_rcs(c) {
		let errs = []
		let lrc = new Map() // {li -> faces using it}
		let prc = new Map() // {pi -> faces and lines using it}
		for (let f of live_faces(c)) {
			for (let ei = 0; ei < f.length; ei++) {
				let li = f.lis[ei]
				let l = c.get_line(li, line3())
				let a = f[ei]
				let b = f[f.next_i(ei)]
				if (!(l[0].i == a && l[1].i == b || l[0].i == b && l[1].i == a))
					errs.push(`face ${f.i} edge ${ei}: line ${li} doesn't join ${a}-${b}`)
				lrc.set(li, (lrc.get(li) ?? 0) + 1)
			}
			for (let pi of f)
				prc.set(pi, (prc.get(pi) ?? 0) + 1)
		}
		for (let li = 0; li < c.line_count(); li++) {
			if (!c.line_rc(li))
				continue
			if (c.line_rc(li) != (lrc.get(li) ?? 0) + 1)
				errs.push(`line ${li}: rc ${c.line_rc(li)}, faces ${lrc.get(li) ?? 0}`)
			let l = c.get_line(li, line3())
			prc.set(l[0].i, (prc.get(l[0].i) ?? 0) + 1)
			prc.set(l[1].i, (prc.get(l[1].i) ?? 0) + 1)
		}
		for (let pi = 0; pi < c.point_count(); pi++)
			if (c.point_rc(pi) != (prc.get(pi) ?? 0))
				errs.push(`point ${pi}: rc ${c.point_rc(pi)}, users ${prc.get(pi) ?? 0}`)
		return errs.slice(0, 4).join('; ')
	}

	// the used points, lines and faces, for comparing before/after undo.
	function model_state(c) {
		let pts = []
		let ls = []
		let fs = []
		for (let pi = 0; pi < c.point_count(); pi++)
			if (c.point_rc(pi))
				pts.push(pi, c.point_rc(pi), ...c.get_point(pi, v3()))
		for (let li = 0; li < c.line_count(); li++)
			if (c.line_rc(li)) {
				let l = c.get_line(li, line3())
				ls.push(li, c.line_rc(li), l[0].i, l[1].i,
					c.line_smoothness(li), c.line_opacity(li))
			}
		for (let f of live_faces(c))
			fs.push(f.i, Array.from(f).join(), f.lis.join(), (f.holes ?? []).join())
		return JSON.stringify([pts, ls, fs])
	}

	// a face's cached plane must follow its points.
	function check_planes(c) {
		for (let f of live_faces(c))
			for (let pi of f)
				if (!near(f.plane().distance_to_point(c.get_point(pi, v3())), 0))
					return `face ${f.i} plane misses point ${pi}`
	}

	// pull `face` with a few live moves, then check rcs, undo and redo.
	function check_pull_undo(c, face, distance) {
		let state0 = model_state(c)
		c.editor.start_group()
		let p = face.center(v3())
		p.face = face
		let pull = c.start_pull(p)
		pull.pull(distance / 2)
		pull.pull(distance)
		pull.stop()
		let errs = check_rcs(c)
		if (errs)
			return 'after pull: ' + errs
		let state1 = model_state(c)
		errs = check_planes(c) // caches the planes, as drawing does.
		if (errs)
			return 'after pull: ' + errs
		c.editor.undo()
		if (model_state(c) != state0)
			return 'undo did not restore the model'
		errs = check_planes(c)
		if (errs)
			return 'after undo: ' + errs
		c.editor.redo()
		if (model_state(c) != state1)
			return 'redo did not restore the pull'
		return true
	}

	check('pull a lone square: rcs, undo, redo', () => {
		let c = make_comp()
		return check_pull_undo(c, add_square(c, 0, 0, 1), 2)
	})

	check('pull a box top: rcs, undo, redo', () => {
		let c = make_comp()
		let P = [[0,0,0], [2,0,0], [2,2,0], [0,2,0], [0,0,2], [2,0,2], [2,2,2],
			[0,2,2]].map(p => c.add_point_xyz(...p))
		let F = [[1,0,3,2], [4,5,6,7], [7,6,2,3], [4,0,1,5], [0,4,7,3],
			[5,1,2,6]].map(f => c.add_face(f.map(i => P[i])))
		return check_pull_undo(c, F[1], 1)
	})

	check('pull a sloped face: rcs, undo, redo', () => {
		let c = make_comp()
		let P = [[0,0,-1], [2,0,-1], [2,2,0], [0,2,0], [0,0,2], [2,0,2], [2,2,2],
			[0,2,2]].map(p => c.add_point_xyz(...p))
		let F = [[1,0,3,2], [4,5,6,7], [7,6,2,3], [4,0,1,5], [0,4,7,3],
			[5,1,2,6]].map(f => c.add_face(f.map(i => P[i])))
		return check_pull_undo(c, F[0], 1)
	})

	check('poly next_i/prev_i wrap within each contour', () => {
		let p = poly3(0, 1, 2, 3, 4, 5, 6)
		p.holes = [4]
		let next = [0, 1, 2, 3, 4, 5, 6].map(i => p.next_i(i)).join()
		let prev = [0, 1, 2, 3, 4, 5, 6].map(i => p.prev_i(i)).join()
		return next == '1,2,3,0,5,6,4' && prev == '3,0,1,2,6,4,5' ||
			`next ${next}, prev ${prev}`
	})

	check('pull a square with a hole: rcs, undo, redo', () => {
		let c = make_comp()
		let pis = [[0,0,0], [3,0,0], [3,3,0], [0,3,0], [1,1,0], [1,2,0], [2,2,0],
			[2,1,0]].map(p => c.add_point_xyz(...p))
		return check_pull_undo(c, c.add_face(pis, null, null, [4]), 1)
	})

	// the sloped x = 0 wall makes the pull insert an edge at (0,0,2) into
	// the side face that has a hole.
	check('pull next to a side face with a hole: rcs, undo, redo', () => {
		let c = make_comp()
		let P = [[-1,0,0], [2,0,0], [2,2,0], [-1,2,0], [0,0,2], [2,0,2], [2,2,2],
			[0,2,2], [.5,0,.5], [1.5,0,.5], [1.5,0,1.5],
			[.5,0,1.5]].map(p => c.add_point_xyz(...p))
		let F = [[1,0,3,2], [4,5,6,7], [7,6,2,3], [0,4,7,3],
			[5,1,2,6]].map(f => c.add_face(f.map(i => P[i])))
		let holed = c.add_face([4,0,1,5, 8,11,10,9].map(i => P[i]), null, null, [4])
		let err = check_pull_undo(c, F[1], 1)
		if (err !== true)
			return err
		return holed.length == 9 || 'holed face length ' + holed.length + ' (want 9)'
	})

	// the ledge is coplanar with the top and shares its x = 2 edge with the top
	// and the wall below: the wall stays and the pull adds a face above it.
	check('pull a box top that shares an edge with a ledge: rcs, undo, redo', () => {
		let c = make_comp()
		let P = [[0,0,0], [2,0,0], [2,2,0], [0,2,0], [0,0,2], [2,0,2], [2,2,2],
			[0,2,2], [3,0,2], [3,2,2]].map(p => c.add_point_xyz(...p))
		let F = [[1,0,3,2], [4,5,6,7], [7,6,2,3], [4,0,1,5], [0,4,7,3],
			[5,1,2,6]].map(f => c.add_face(f.map(i => P[i])))
		c.add_face([5, 8, 9, 6].map(i => P[i]))
		let wall = F[5]
		let wall_pis0 = Array.from(wall).join()
		let err = check_pull_undo(c, F[1], 1)
		if (err !== true)
			return err
		return Array.from(wall).join() == wall_pis0 ||
			`wall points ${Array.from(wall)}, want ${wall_pis0}`
	})

	// the y = 0 and x = 0 walls are pp but each has a sloped side edge of its
	// own at (0,0,2), so that corner needs a new pp side edge.
	check('pull a top whose corner has two sloped side edges: rcs, undo', () => {
		let c = make_comp()
		let P = [[0,0,2], [2,0,2], [2,2,2], [0,2,2], [-1,0,0], [2,0,0], [2,2,0],
			[0,2,0], [0,-1,0]].map(p => c.add_point_xyz(...p))
		let top = c.add_face([0,1,2,3].map(i => P[i]))
		for (let f of [[4,5,1,0], [5,6,2,1], [6,7,3,2], [7,8,0,3]])
			c.add_face(f.map(i => P[i]))
		return check_pull_undo(c, top, 1)
	})

	// a box with outward faces; `extra_pts` go after its 8 points.
	function add_box(c, extra_pts) {
		let P = [[0,0,0], [2,0,0], [2,2,0], [0,2,0], [0,0,2], [2,0,2], [2,2,2],
			[0,2,2], ...(extra_pts ?? [])].map(p => c.add_point_xyz(...p))
		return P
	}
	const box_faces = [[1,0,3,2], [4,5,6,7], [7,6,2,3], [4,0,1,5], [0,4,7,3],
		[5,1,2,6]]

	// the top's x = 2 edge is split at (2,1,2), and so is the wall's.
	check('pull a box top whose edge is split: the wall gets the split point once', () => {
		let c = make_comp()
		let P = add_box(c, [[2,1,2]])
		let faces = [[1,0,3,2], [4,5,8,6,7], [7,6,2,3], [4,0,1,5], [0,4,7,3],
			[5,1,2,6,8]]
		let F = faces.map(f => c.add_face(f.map(i => P[i])))
		return check_pull_undo(c, F[1], 1)
	})

	// M13: the line is disconnected from the split point (P1); after the
	// pull only the two halves use the split point, so they are joined (L2).
	check('pull a box top split at a line: the halves are joined', () => {
		let c = make_comp()
		let P = add_box(c, [[2,1,2], [3,1,2]])
		let faces = [[1,0,3,2], [4,5,8,6,7], [7,6,2,3], [4,0,1,5], [0,4,7,3],
			[5,1,2,6,8]]
		let F = faces.map(f => c.add_face(f.map(i => P[i])))
		c.add_line(P[8], P[9])
		let err = check_pull_undo(c, F[1], 1)
		if (err !== true)
			return err
		if (F[1].includes(P[8]) || F[5].includes(P[8]))
			return 'a face still uses the split point'
		return c.point_rc(P[8]) == 0 || 'the split point is still used'
	})

	check('pull a box top: a standalone line at a corner stays', () => {
		let c = make_comp()
		let P = add_box(c, [[-1,-1,2]])
		let F = box_faces.map(f => c.add_face(f.map(i => P[i])))
		let li = c.add_line(P[4], P[8])
		let err = check_pull_undo(c, F[1], 1)
		if (err !== true)
			return err
		let l = c.get_line(li, line3())
		if (!veq(l[0], [0, 0, 2]))
			return 'line moved to ' + Array.from(l[0])
		// reconnected: the line and both halves of the cut corner edge.
		let pi = l[0].i
		let n = 0
		c.each_line(l => {
			if (l[0].i == pi || l[1].i == pi)
				n++
		})
		return n == 3 || `${n} lines at the line's end (want 3)`
	})

	// the top slides past the line: the walls shrink and the line stays.
	check('push a box top down: a standalone line at a corner stays', () => {
		let c = make_comp()
		let P = add_box(c, [[-1,-1,2]])
		let F = box_faces.map(f => c.add_face(f.map(i => P[i])))
		let li = c.add_line(P[4], P[8])
		let err = check_pull_undo(c, F[1], -1)
		if (err !== true)
			return err
		let l = c.get_line(li, line3())
		if (!veq(l[0], [0, 0, 2]))
			return 'line moved to ' + Array.from(l[0])
		for (let f of [F[2], F[3], F[4], F[5]])
			for (let pi of f)
				if (c.get_point(pi, v3())[2] > 1 + 1e-6)
					return `wall ${f.i} point ${pi} above 1`
		return true
	})

	// the line is where the top's y = 0 edge ends up: its points merge with
	// the top's corners and the top uses the line as its edge.
	check('pull a box top onto a line: the top uses the line', () => {
		let c = make_comp()
		let P = add_box(c, [[0,0,3], [2,0,3]])
		let F = box_faces.map(f => c.add_face(f.map(i => P[i])))
		let li = c.add_line(P[8], P[9])
		let err = check_pull_undo(c, F[1], 1)
		if (err !== true)
			return err
		return F[1].lis.includes(li) || 'the top does not use the line'
	})

	// the fin is coplanar with the y = 0 wall and attached along its edge 1-5.
	check('pull a box top: a fin at a corner stays', () => {
		let c = make_comp()
		let P = add_box(c, [[3,0,0], [3,0,2]])
		let F = box_faces.map(f => c.add_face(f.map(i => P[i])))
		let fin = c.add_face([1, 8, 9, 5].map(i => P[i]))
		let err = check_pull_undo(c, F[1], 1)
		if (err !== true)
			return err
		let zs = Array.from(fin).map(pi => c.get_point(pi, v3())[2])
		return zs.join() == '0,0,2,2' || 'fin zs ' + zs
	})

	// the side faces have zero height: they are removed (F3) and the rest is
	// merged (L1).
	check('pull by 0 gives back the starting face: rcs, undo, redo', () => {
		let c = make_comp()
		let err = check_pull_undo(c, add_square(c, 0, 0, 1), 0)
		if (err !== true)
			return err
		let n_faces = live_faces(c).length
		let n_lines = 0
		c.each_line(l => n_lines++)
		return n_faces == 1 && n_lines == 4 ||
			`faces ${n_faces}, lines ${n_lines} (want 1, 4)`
	})

	// draw `lines` ([[p1, p2],...]) in one undo group, then check rcs, undo
	// and redo. the points have no indices, as the editor sends them.
	function check_draw_undo(c, lines) {
		let state0 = model_state(c)
		c.editor.start_group()
		for (let [p1, p2] of lines)
			c.draw_line(line3(v3(...p1), v3(...p2)))
		let errs = check_rcs(c)
		if (errs)
			return errs
		let state1 = model_state(c)
		c.editor.undo()
		if (model_state(c) != state0)
			return 'undo did not restore the model'
		c.editor.redo()
		return model_state(c) == state1 || 'redo did not restore the lines'
	}

	// the two squares use the cut edge in opposite directions.
	check('draw_line across a shared face edge: rcs, undo, redo', () => {
		let c = make_comp()
		let P = [[0,0,0], [2,0,0], [2,2,0], [0,2,0], [4,0,0],
			[4,2,0]].map(p => c.add_point_xyz(...p))
		let f1 = c.add_face([0, 1, 2, 3].map(i => P[i]))
		let f2 = c.add_face([1, 4, 5, 2].map(i => P[i]))
		let err = check_draw_undo(c, [[[1,1,0], [3,1,0]]])
		if (err !== true)
			return err
		return f1.length == 5 && f2.length == 5 ||
			`face lengths ${f1.length} ${f2.length} (want 5 5)`
	})

	check('draw_line starting on a line cuts it there: rcs, undo, redo', () => {
		let c = make_comp()
		c.add_line(c.add_point_xyz(0, 0, 0), c.add_point_xyz(2, 0, 0))
		let err = check_draw_undo(c, [[[1,0,0], [1,-1,0]]])
		if (err !== true)
			return err
		let n = 0
		let short = 0
		c.each_line(l => {
			n++
			if (l[0].distance2(l[1]) < 1e-12)
				short++
		})
		return n == 3 && !short || `lines ${n}, zero-length ${short} (want 3, 0)`
	})

	check('draw_line over a face edge merges into it: rcs, undo, redo', () => {
		let c = make_comp()
		add_square(c, 0, 0, 2)
		let state0 = model_state(c)
		let err = check_draw_undo(c, [[[0,0,0], [2,0,0]]])
		if (err !== true)
			return err
		return model_state(c) == state0 || 'the model changed'
	})

	check('draw_line crossing a line: rcs, undo, redo', () => {
		let c = make_comp()
		c.add_line(c.add_point_xyz(1, -1, 0), c.add_point_xyz(1, 1, 0))
		return check_draw_undo(c, [[[0,0,0], [2,0,0]]])
	})

	// M10, F1.
	check('draw a cycle of lines: a face: rcs, undo, redo', () => {
		let c = make_comp()
		let err = check_draw_undo(c, [[[0,0,0], [1,0,0]], [[1,0,0], [1,1,0]],
			[[1,1,0], [0,1,0]], [[0,1,0], [0,0,0]]])
		if (err !== true)
			return err
		let F = live_faces(c)
		return F.length == 1 && F[0].length == 4 ||
			`faces ${F.length}, points ${F[0]?.length} (want 1, 4)`
	})

	// F1: the line goes from edge to edge below the hole.
	check('draw a line across a face with a hole: rcs, undo, redo', () => {
		let c = make_comp()
		let pis = [[0,0,0], [3,0,0], [3,3,0], [0,3,0], [1,1,0], [1,2,0], [2,2,0],
			[2,1,0]].map(p => c.add_point_xyz(...p))
		let mat = {name: 'mat2', uv: v2(1, 1), diffuse_color: 0xff0000}
		c.add_face(pis, null, mat, [4])
		let err = check_draw_undo(c, [[[0,.5,0], [3,.5,0]]])
		if (err !== true)
			return err
		let F = live_faces(c)
		if (F.length != 2)
			return `faces ${F.length} (want 2)`
		let n_holes = 0
		for (let f of F) {
			if (f.mat_inst.material != mat)
				return `face ${f.i} lost the material`
			if (!veq(f.plane().normal, [0, 0, 1]))
				return `face ${f.i} normal ${Array.from(f.plane().normal)}`
			n_holes += f.holes?.length ?? 0
		}
		return n_holes == 1 || `holes ${n_holes} (want 1)`
	})

	// F1: drawn over an edge of an open box: the top is added back, facing
	// out like the walls.
	check('draw over an edge of an open box: the top: rcs, undo, redo', () => {
		let c = make_comp()
		let P = add_box(c)
		for (let f of box_faces)
			if (f != box_faces[1])
				c.add_face(f.map(i => P[i]))
		let err = check_draw_undo(c, [[[0,0,2], [2,0,2]]])
		if (err !== true)
			return err
		let F = live_faces(c)
		if (F.length != 6)
			return `faces ${F.length} (want 6)`
		let top = F[F.length-1]
		return veq(top.plane().normal, [0, 0, 1]) ||
			`top normal ${Array.from(top.plane().normal)}`
	})

	// F1 islands: a cycle drawn inside a face is a filled island: a face,
	// and a hole in the face around it.
	check('draw a cycle inside a face: an island: rcs, undo, redo', () => {
		let c = make_comp()
		add_square(c, 0, 0, 3)
		let err = check_draw_undo(c, [[[1,1,0], [2,1,0]], [[2,1,0], [2,2,0]],
			[[2,2,0], [1,2,0]], [[1,2,0], [1,1,0]]])
		if (err !== true)
			return err
		let F = live_faces(c)
		if (F.length != 2)
			return `faces ${F.length} (want 2)`
		let outer = F.find(f => f.holes?.length)
		let inner = F.find(f => !f.holes?.length)
		return outer && inner && outer.length == 8 && inner.length == 4 ||
			`face lengths ${F.map(f => f.length)} (want 8 4)`
	})

	// F1 islands: an island next to an island: one hole around both.
	check('draw an island next to an island: one hole: rcs, undo, redo', () => {
		let c = make_comp()
		add_square(c, 0, 0, 4)
		c.draw_line(line3(v3(1,1,0), v3(2,1,0)))
		c.draw_line(line3(v3(2,1,0), v3(2,2,0)))
		c.draw_line(line3(v3(2,2,0), v3(1,2,0)))
		c.draw_line(line3(v3(1,2,0), v3(1,1,0)))
		let err = check_draw_undo(c, [[[2,1,0], [3,1,0]], [[3,1,0], [3,2,0]],
			[[3,2,0], [2,2,0]]])
		if (err !== true)
			return err
		let F = live_faces(c)
		if (F.length != 3)
			return `faces ${F.length} (want 3)`
		let outer = F.find(f => f.holes?.length)
		return outer?.holes.length == 1 && outer.length == 10 ||
			`face lengths ${F.map(f => f.length)} (want 10 4 4, one hole)`
	})

	// F1 islands: a cycle drawn around a face gets a hole there.
	known_bug('draw a cycle around a face: a hole: rcs, undo, redo', () => {
		let c = make_comp()
		add_square(c, 1, 1, 1)
		let err = check_draw_undo(c, [[[0,0,0], [3,0,0]], [[3,0,0], [3,3,0]],
			[[3,3,0], [0,3,0]], [[0,3,0], [0,0,0]]])
		if (err !== true)
			return err
		let F = live_faces(c)
		if (F.length != 2)
			return `faces ${F.length} (want 2)`
		let outer = F.find(f => f.holes?.length)
		return outer?.length == 8 ||
			`face lengths ${F.map(f => f.length)} (want 8 4)`
	})

	return [n_checks, results, known]
})()

const [n_checks, failures, known] = results
console.log(`${n_checks} checks`)
for (let [name, msg] of failures)
	console.log('FAIL', name, msg)
for (let [name, failed] of known)
	console.log(failed ? 'KNOWN BUG' : 'KNOWN BUG NOW PASSES', name)
console.log(failures.length ? `${failures.length} failed` : 'all passed')
process.exit(failures.length ? 1 : 0)
