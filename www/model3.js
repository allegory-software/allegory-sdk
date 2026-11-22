/*

	Polygon-based editable 3D model components.
	Written by Cosmin Apreutesei. Public Domain.

	Components are made primarily of polygons enclosed and connected by
	lines defined over a common point cloud. A component can contain instances
	of other components at relative transforms. A component can also contain
	standalone lines.

	The editing API implements the direct manipulation UI and performs
	automatic creation/removal/intersection of points/lines/polygons
	while keeping the model numerically stable and clean. In particular:
	- editing operations never leave duplicate points/lines/polygons.
	- existing points are never moved when adding new geometry.
	- when existing lines are cut, straightness is preserved to best accuracy.

*/

(function() {
"use strict"

const {
	abs, clamp, lerp, return_true, assert, log, push_log, pop_log,
	callable_constructor, inherit_properties,
	extend, insert, remove, remove_value, map, set, assign, attr, json,
} = glue

const {NEAR, v3, mat4, line3, box3, poly3, pseudo_angle, angle_sweep} = Math3D

window.DEBUG_MODEL3 ??= 0

let LOG = DEBUG_MODEL3

window.model3_component = function(opt, editor) {

	assert(editor)
	let e = {name: opt.name}
	let push_undo = editor.push_undo

	// model (as in MVC and as in 3D model) -----------------------------------

	let points    = [] // [(x, y, z), ...]
	let normals   = [] // [(x, y, z), ...]; normals for smooth meshes.
	let free_pis  = [] // [p1i,...]; freelist of point indices.
	let prc       = [] // [rc1,...]; ref counts of points.
	let lines     = [] // [(p1i, p2i, rc, sm, op), ...]; rc=refcount, sm=smoothness, op=opacity.
	let free_lis  = [] // [l1i,...]; freelist of line indices.
	let faces     = [] // [poly3([p1i, p2i, ..., holes: [hole1_start_pi,...], lis: [line1i,...], selected:, material:, ]),...]
	let free_fis  = [] // [face1_index,...]
	let meshes    = set() // {{face},...}; meshes are sets of all faces connected by smooth lines.

	let children  = [] // [mat1,...]

	// the points and lines changed by the current operation. the rest of the
	// model is already clean, so repair() checks only these.
	let touched_pis = set() // {pi}; moved points.
	let touched_lis = set() // {li}; created lines and lines with a new endpoint.

	// model-to-view info (as in MVC).
	let used_points_changed     // time to reload the used_pis buffer.
	let used_lines_changed      // time to reload the *_edge_lis buffers.
	let faces_changed           // time to rebuild faces geometry.
	let edge_line_count = 0     // number of face edge lines.
	let nonedge_line_count = 0  // number of standalone lines.
	let bbox_changed            // time to recompute the bbox.
	let sel_child_count = 0

	// low-level model editing API that:
	// - records undo ops in the undo stack.
	// - updates and/or invalidates any affected view buffers.

	let point_count = () => prc.length

	let get_point
	{
	let _v0 = v3()
	get_point = function(pi, out) {
		out ??= _v0
		out[0] = points[3*pi+0]
		out[1] = points[3*pi+1]
		out[2] = points[3*pi+2]
		out.i = pi
		return out
	}}

	let add_point_xyz
	{
	let _v0 = v3()
	add_point_xyz = function(x, y, z, expect_pi) {
		return add_point(_v0.set(x, y, z), expect_pi)
	}}

	function add_point(p, expect_pi) {
		assert(p.is_v3)
		let pi = free_pis.pop()
		if (pi == null) {
			points.push(p[0], p[1], p[2])
			normals.push(0, 0, 0)
			pi = prc.length
		} else {
			p.to_v3_array(points, pi)
		}
		prc[pi] = 0
		assert(expect_pi == null || pi == expect_pi)

		update_point(pi, p)

		if (LOG) log('+point', pi, ':', p.x, p.y, p.z)

		return pi
	}

	let unref_point = function(pi, expect_rc) {

		let rc0 = prc[pi]--
		assert(rc0 > 0)
		assert(expect_rc == null || expect_rc == rc0)

		push_undo(ref_point, pi, rc0 - 1)

		// last ref: free the point. undo re-adds it before re-reffing it.
		if (rc0 == 1) {

			free_pis.push(pi)
			used_points_changed = true

			let p = get_point(pi)
			push_undo(add_point_xyz, p[0], p[1], p[2], pi)

		}

		// if (LOG) log('unref_point', pi, prc[pi])
	}

	let ref_point = function(pi, expect_rc) {

		let rc0 = prc[pi]++
		assert(expect_rc == null || expect_rc == rc0)

		if (rc0 == 0)
			used_points_changed = true

		push_undo(unref_point, pi, rc0 + 1)

		// if (LOG) log('ref_point', pi, prc[pi])
	}

	let move_point_xyz
	{
	let _v0 = v3()
	move_point_xyz = function(pi, x, y, z, x0, y0, z0) {
		return move_point(pi, _v0.set(x, y, z), x0, y0, z0)
	}}

	function move_point(pi, p, expect_x, expect_y, expect_z) {
		let p0 = get_point(pi)
		let x0 = p0[0]
		let y0 = p0[1]
		let z0 = p0[2]
		if (expect_x != null) {
			assert(expect_x == x0)
			assert(expect_y == y0)
			assert(expect_z == z0)
		}
		p.to_v3_array(points, pi)
		update_point(pi, p)
		touched_pis.add(pi)
		// NOTE: pulling a 4-point face in a component with 10,000 quads
		// does 2 × 4 × 40,000 = 320,000 comparisons per mouse move.
		// That’s roughly a millisecond in JS.
		for (let face of faces)
			if (face.includes(pi)) {
				if (face.mesh)
					face.mesh.normals_valid = false
				face.invalidate()
			}
		push_undo(move_point_xyz, pi, x0, y0, z0, p[0], p[1], p[2])
	}

	let line_count = () => lines.length / 5

	let get_line
	{
	let _line = line3()
	get_line = function(li, out) {
		out = out || _line
		let p1i = lines[5*li+0]
		let p2i = lines[5*li+1]
		get_point(p1i, out[0])
		get_point(p2i, out[1])
		out.i = li
		return out
	}}

	function line_rc         (li) { return lines[5*li+2] }
	function line_smoothness (li) { return lines[5*li+3] }
	function line_opacity    (li) { return lines[5*li+4] }

	function each_line(f) {
		for (let li = 0, n = line_count(); li < n; li++)
			if (line_rc(li))
				f(get_line(li))
	}

	// undo runs only the primitives below, which record their exact opposite
	// and call no other recording function. composed ops record nothing.

	// primitive: create a line with rc 1, without reffing its points.
	function create_line(p1i, p2i, expect_li, sm, op) {

		sm ??= 0
		op ??= 1

		let li = free_lis.pop()
		if (li == null) {
			li = lines.push(p1i, p2i, 1, sm, op)
			li = (lines.length / 5) - 1
		} else {
			lines[5*li+0] = p1i
			lines[5*li+1] = p2i
			lines[5*li+2] = 1  // ref. count
			lines[5*li+3] = sm // smoothness
			lines[5*li+4] = op // opacity
		}
		assert(expect_li == null || expect_li == li)

		nonedge_line_count++
		used_lines_changed = true
		bbox_changed = true
		touched_lis.add(li)

		push_undo(unref_line, li, 1)

		if (LOG) log('+line', li, ':', p1i, p2i)

		return li
	}

	function add_line(p1i, p2i) {
		ref_point(p1i)
		ref_point(p2i)
		return create_line(p1i, p2i)
	}

	// primitive: the last unref frees the line, without unreffing its points.
	function unref_line(li, expect_rc) {

		let rc = --lines[5*li+2]
		assert(rc >= 0)
		assert(expect_rc == null || expect_rc == rc + 1)

		if (rc == 0) {

			nonedge_line_count--
			used_lines_changed = true
			bbox_changed = true

			free_lis.push(li)

			push_undo(create_line,
				lines[5*li+0],
				lines[5*li+1],
				li,
				lines[5*li+3],
				lines[5*li+4])

			if (LOG) log('-line', li)

		} else {

			if (rc == 1) {
				nonedge_line_count++
				edge_line_count--
				used_lines_changed = true
			} else {
				edge_line_count--
			}

			push_undo(ref_line, li, rc)

		}

		// if (LOG) log('unref_line', li, rc)
	}

	function ref_line(li, expect_rc) {

		let rc0 = lines[5*li+2]++
		assert(expect_rc == null || expect_rc == rc0)

		if (rc0 == 1) {
			nonedge_line_count--
			edge_line_count++
			used_lines_changed = true
		} else {
			assert(rc0 > 1)
			edge_line_count++
		}

		push_undo(unref_line, li, rc0 + 1)

		// if (LOG) log('ref_line', li, rc0 + 1)
	}

	// unref the line and, if that freed it, its points.
	function release_line(li) {
		unref_line(li)
		if (!line_rc(li)) {
			unref_point(lines[5*li+0])
			unref_point(lines[5*li+1])
		}
	}

	// primitive: set endpoint `i` (0 or 1), without reffing or unreffing.
	function set_line_endpoint(li, i, pi) {
		let pi0 = lines[5*li+i]
		lines[5*li+i] = pi
		used_lines_changed = true
		bbox_changed = true
		touched_lis.add(li)
		push_undo(set_line_endpoint, li, i, pi0)
	}

	function cut_line(li1, pi) {
		let pi2 = lines[5*li1+1] // pi2
		let sm1 = lines[5*li1+3] // smoothness
		let op1 = lines[5*li1+4] // opacity

		if (LOG) log('cut_line', li1, pi)

		let li2 = add_line(pi, pi2)
		replace_line_endpoint(li1, pi, pi2)
		// faces using the line: insert the cut point and the second half,
		// in the direction of the face's edge.
		each_line_face(li1, function(face) {
			let ei = face.lis.indexOf(li1)
			ref_point(pi)
			ref_line(li2)
			insert_edge(face, ei + 1, pi, face[ei] == pi2, li2)
		})
		set_line_smoothness (li2, sm1)
		set_line_opacity    (li2, op1)
	}

	function replace_line_endpoint(li, new_pi, old_pi) {

		let pi0 = lines[5*li+0]
		let pi1 = lines[5*li+1]

		let i = (old_pi == pi0) ? 0 : ((old_pi == pi1) ? 1 : assert(false))

		ref_point(new_pi)
		set_line_endpoint(li, i, new_pi)
		unref_point(old_pi)

		if (LOG) log('replace_line_endpoint', li, '@', i, old_pi, '->', new_pi)
	}

	let face3 = callable_constructor(class face3 extends poly3.class {

		is_face3 = true

		get_point3(i, out) {
			return get_point(this[i], out)
		}

		get_normal(i, out) {
			if (this.mesh)
				return out.from_v3_array(normals, this[i])
			else
				return this.plane().normal
		}

		get_edge(ei, out) {
			out = get_line(this.lis[ei], out)
			out.ei = ei // edge index.
			if (out[1].i == this[ei]) { // fix edge endpoints order.
				let p1 = out[0]
				let p2 = out[1]
				out[0] = p2
				out[1] = p1
			}
			return out
		}

		each_edge(f) {
			for (let ei = 0, n = this.length; ei < n; ei++)
				f(this.get_edge(ei))
		}

		get points() { return points } // the component's points, by index.

		is_flat() {
			for (let li of this.lis)
				if (lines[5*li+3])
					return false
			return true
		}

	})
	inherit_properties(face3.class)

	let mat_faces_map = map() // {material -> [face1,...]}

	function material_instance(mat) {
		mat = mat || editor.default_material
		let mat_insts = attr(mat_faces_map, mat, Array)
		mat_insts.material = mat
		return mat_insts
	}

	// primitive: create a face, without reffing its points and lines.
	function create_face(pis, lis, material, holes, expect_fi) {
		let face
		let fi = free_fis.pop()
		if (fi == null) {
			fi = faces.length
			face = face3()
			face.lis = []
			face.i = fi
			faces[fi] = face
		} else {
			face = faces[fi]
		}
		assert(expect_fi == null || expect_fi == fi)
		if (pis)
			extend(face, pis)
		if (holes) { // [hole1_i1, hole2_i1, ...]
			if (!face.holes)
				face.holes = []
			extend(face.holes, holes)
		}
		if (lis)
			extend(face.lis, lis)
		material = material || editor.default_material
		face.mat_inst = material_instance(material)
		face.mat_inst.push(face)
		face.invalidate() // reused slot: drop the previous face's caches.
		faces_changed = true
		push_undo(free_face, face)
		return face
	}

	// primitive: free a face, without unreffing its points and lines.
	function free_face(face) {
		push_undo(create_face,
			Array.from(face),
			face.lis.slice(),
			face.mat_inst.material,
			face.holes && face.holes.length ? face.holes.slice() : null,
			face.i)
		face_set_selected(face, false)
		faces_changed = true
		free_fis.push(face.i)
		face.length = 0
		if (face.holes)
			face.holes.length = 0
		face.lis.length = 0
		remove_value(face.mat_inst, face)
		face.mat_inst = null
	}

	function add_face(pis, lis, material, holes) {
		if (pis)
			for (let pi of pis)
				ref_point(pi)
		if (lis)
			for (let li of lis)
				ref_line(li)
		let face = create_face(pis, lis, material, holes)
		// free_face() records the lis, so undo and redo restore them.
		if (!lis)
			update_face_lis(face)
		if (LOG) log('+face', face.i, 'pis', ...face, 'lis', ...face.lis,
			'mat', face.mat_inst.material.name)
		return face
	}

	function remove_face(face) {
		for (let li of face.lis)
			unref_line(li)
		for (let pi of face)
			unref_point(pi)
		free_face(face)
		if (LOG) log('-face', face.i)
	}

	function set_material(face, material) {
		let m_inst0 = face.mat_inst
		let m0 = m_inst0.material
		let m_inst = material_instance(material)
		if (m_inst == m_inst0)
			return

		remove_value(m_inst0, face)
		face.mat_inst = m_inst
		face.mat_inst.push(face)
		faces_changed = true

		if (LOG) log('set_material', face.i, material.i)

		push_undo(set_material, face, m0)
	}

	function ref_or_add_line(p1i, p2i) {
		let found_li
		for (let li = 0, n = line_count(); li < n; li++) {
			// freed: skip. it keeps its points, which can be reused.
			if (!line_rc(li))
				continue
			let _p1i = lines[5*li+0]
			let _p2i = lines[5*li+1]
			if ((_p1i == p1i && _p2i == p2i) || (_p1i == p2i && _p2i == p1i)) {
				found_li = li
				break
			}
		}
		if (found_li == null)
			found_li = add_line(p1i, p2i)
		ref_line(found_li)
		return found_li
	}

	function update_face_lis_for_poly(face, i1, i2) {
		let p0i = face[i1]
		let p1i = p0i
		for (let i = i1+1; i < i2; i++) {
			let p2i = face[i]
			face.lis.push(ref_or_add_line(p1i, p2i))
			p1i = p2i
		}
		face.lis.push(ref_or_add_line(p1i, p0i))
	}

	function update_face_lis(face) {
		face.lis.length = 0
		update_face_lis_for_poly(face, 0, face.point_count_without_holes())
		if (face.holes)
			for (let i = 0, n = face.holes.length; i < n; i++) {
				let i1 = face.hole_i1(i)
				let i2 = face.hole_i2(i)
				update_face_lis_for_poly(face, i1, i2)
			}
		faces_changed = true
	}

	function insert_edge(face, ei, pi, line_before_point, li) {
		let line_ei = ei - (line_before_point ? 1 : 0)
		assert(line_ei >= 0) // can't use ei=0 and line_before_point=true with this function.
		if (LOG) log('insert_edge', face.i, '@', ei, 'pi', pi, '@', line_ei, 'li', li, 'before_pi', face[ei])
		insert(face, ei, pi)
		insert(face.lis, line_ei, li)
		// holes starting at `ei` move too: the point goes to the end of the
		// contour before them.
		if (face.holes)
			for (let k = 0; k < face.holes.length; k++)
				if (face.holes[k] >= ei)
					face.holes[k]++
		if (face.mesh)
			face.mesh.normals_valid = false
		face.invalidate()
		faces_changed = true
		push_undo(remove_edge, face, ei, line_before_point)
	}

	// primitive: the opposite of insert_edge(), without unreffing.
	function remove_edge(face, ei, line_before_point) {
		let line_ei = ei - (line_before_point ? 1 : 0)
		let pi = remove(face, ei)
		let li = remove(face.lis, line_ei)
		if (face.holes)
			for (let k = 0; k < face.holes.length; k++)
				if (face.holes[k] > ei)
					face.holes[k]--
		if (face.mesh)
			face.mesh.normals_valid = false
		face.invalidate()
		faces_changed = true
		push_undo(insert_edge, face, ei, pi, line_before_point, li)
	}

	function replace_edge(face, ei, li, expect_li) {
		let li0 = face.lis[ei]
		assert(expect_li == null || expect_li == li0)
		face.lis[ei] = li

		if (LOG) log('replace_edge', face.i, '@', ei, li0, '->', li)

		push_undo(replace_edge, face, ei, li0, li)
	}

	function replace_face_point(face, ei, pi) {
		let pi0 = face[ei]
		face[ei] = pi
		if (face.mesh)
			face.mesh.normals_valid = false
		face.invalidate()

		if (LOG) log('replace_face_point', face.i, '@', ei, pi0, '->', pi)

		push_undo(replace_face_point, face, ei, pi0)
	}

	function each_line_face(li, f) {
		for (let face of faces)
			if (face.lis.includes(li))
				f(face)
	}

	let set_line_smoothness
	{
	let common_meshes = set()
	let nomesh_faces = []
	set_line_smoothness = function(li, sm) {

		let sm0 = lines[5*li+3]
		if (sm == sm0)
			return

		push_undo(set_line_smoothness, li, sm0)

		lines[5*li+3] = sm

		if (!sm0 == !sm) // smoothness category hasn't changed.
			return

		if (sm > 0) { // line has gotten smooth.

			each_line_face(li, function(face) {
				if (face.mesh)
					common_meshes.add(face.mesh)
				else
					nomesh_faces.push(face)
			})

			let target_mesh

			if (common_meshes.size == 0) {
				if (nomesh_faces.length) {
					// none of the faces are part of a mesh, so make one.
					let mesh = set()
					meshes.add(mesh)
					common_meshes.add(mesh)
					target_mesh = mesh
				}
			} else {
				// merge all meshes into the first one and remove the rest.
				for (let mesh of common_meshes) {
					if (!target_mesh) {
						target_mesh = mesh
					} else {
						for (let face of mesh) {
							target_mesh.add(face)
							face.mesh = target_mesh
						}
						meshes.delete(mesh)
					}
				}
			}

			// add flat faces to the target mesh.
			for (let face of nomesh_faces) {
				target_mesh.add(face)
				face.mesh = target_mesh
			}

			if (target_mesh)
				target_mesh.normals_valid = false

		} else { // line has gotten non-smooth.

			// remove faces containing `li` from their smooth mesh.
			let target_mesh
			each_line_face(li, function(face) {
				assert(!target_mesh || target_mesh == face.mesh) // one mesh only.
				target_mesh = face.mesh
				if (face.is_flat())
					face.mesh.delete(face)
				face.mesh = null
			})

			// remove the mesh if it became empty.
			if (target_mesh && target_mesh.size == 0)
				meshes.delete(target_mesh)

		}

		common_meshes.clear()
		nomesh_faces.length = 0

		faces_changed = true
	}}

	function set_line_opacity(li, op) {

		let op0 = lines[5*li+4]
		if (op == op0)
			return

		push_undo(set_line_opacity, li, op0)

		lines[5*li+4] = op

		if (!op0 == !op) // opacity category hasn't changed.
			return

		used_lines_changed = true
	}

	// component children

	function add_child(comp, mat, layer) {
		assert(mat.is_mat4)
		mat.comp = comp
		mat.layer = layer ?? editor.default_layer
		children.push(mat)
		bbox_changed = true
		editor.child_added(e, mat)
		if (LOG) log('+child', comp.name, 'layer', mat.layer.name)
		return mat
	}

	function remove_child(mat) {
		assert(remove_value(children, mat) >= 0)
		bbox_changed = true
		editor.child_removed(e, mat)
	}

	function set_child_layer(node, layer) {
		assert(children.includes(node))
		node.layer = layer
		editor.layer_changed(e, node)
		return node
	}

	// public API

	e.point_count = point_count
	e.point_rc    = i => prc[i]
	e.get_point   = get_point
	e.add_point   = add_point
	e.add_point_xyz = add_point_xyz

	e.line_count      = line_count
	e.line_rc         = line_rc
	e.line_smoothness = line_smoothness
	e.line_opacity    = line_opacity
	e.get_line        = get_line
	e.each_line       = each_line
	e.add_line        = add_line
	e.set_line_smoothness = set_line_smoothness
	e.set_line_opacity = set_line_opacity

	e.faces       = faces
	e.add_face    = add_face
	e.remove_face = remove_face

	e.set_material = set_material

	e.each_line_face = each_line_face

	e.children        = children
	e.add_child       = add_child
	e.remove_child    = remove_child
	e.set_child_layer = set_child_layer

	e.add = function(t) {

		if (t.is_plane_graph) {

			push_log('add plane graph to', e.name, 'pg', t.id)

			for (let p of t.ps) {
				let [x, y, z] = t.plane.transform_xy_xyz(p[0], p[1])
				p.i = add_point_xyz(x, y, z)
			}

			for (let comp of t) {
				for (let cycle of comp.cycles) {
					if (!cycle.outer)
						continue
					let mat = cycle.material ?? t.material
					// TODO: cycles don't have holes, they have islands which
					// may or may not be holes (they need to be marked at such).
					// the islands have an outer edge which is the hole contour
					// and also have 1..n cycles which also need to be added.
					let face = add_face(cycle.map(p => p.i), null, mat, cycle.holes)
				}
			}

			pop_log()

		} else if (t.is_poly) {

			let _v0 = v3()
			let pis = []
			for (let i = 0, n = t.point_count(); i < n; i++) {
				let p = t.get_point3(i, _v0)
				pis.push(add_point(p))
			}
			return add_face(pis, null, t.material, t.holes)

		} else {

			if (t.points) {
				let p = v3()
				for (let i = 0, n = t.points.length; i < n; i += 3)
					add_point(p.from_array(t.points, i))
			}

			if (t.faces)
				for (let ft of t.faces)
					add_face(ft.pis, ft.lis, ft.material, ft.holes)

			if (t.lines)
				for (let i = 0, n = t.lines.length; i < n; i += 2)
					add_line(t.lines[i], t.lines[i+1])

		}
	}

	// hit testing & snapping -------------------------------------------------

	// return the point on closest line from target point.
	function point_hit_lines(p, max_d, p2p_distance2, f, each_line_f) {
		let min_ds = 1/0
		let line = line3()
		let int_p = v3()
		let min_int_p
		each_line_f = each_line_f || each_line
		each_line_f(function(line) {
			line.project_point(p, true, int_p)
			let ds = p2p_distance2(p, int_p)
			if (ds <= max_d ** 2) {
				if (!(f && f(int_p, line) === false)) {
					if (ds < min_ds) {
						min_ds = ds
						min_int_p = assign(min_int_p || v3(), int_p)
					}
				}
			}
		})
		return min_int_p
	}

	// return the point on closest face line from target point.
	function point_hit_edge(p, face, max_d, p2p_distance2, f) {
		return point_hit_lines(p, max_d, p2p_distance2, f, f => face.each_edge(f))
	}

	// return the projected point on closest line from target line.
	let line_hit_lines
	{
	let _l0 = line3()
	let _l1 = line3()
	let _l2 = line3()
	let _v0 = v3()
	line_hit_lines = function(model, target_line, max_d, p2p_distance2, int_mode, is_line_valid, is_int_line_valid) {
		let min_ds = 1/0
		let min_int_p
		is_line_valid = is_line_valid || return_true
		is_int_line_valid = is_int_line_valid || return_true
		for (let li = 0, n = line_count(); li < n; li++) {
			if (lines[5*li+2]) { // ref count: used.
				let line = get_line(li)
				if (model)
					line.transform(model)
				if (is_line_valid(line)) {
					let p1i = line[0].i
					let p2i = line[1].i
					let q1i = target_line[0].i
					let q2i = target_line[1].i
					let touch1 = p1i == q1i || p1i == q2i
					let touch2 = p2i == q1i || p2i == q2i
					if (touch1 != touch2) {
						// skip lines with a single endpoint common with the target line.
					} else if (touch1 && touch2) {
						//
					} else {
						let int_line = target_line.intersect_line(line, _l0, int_mode)
						if (int_line) {
							let ds = p2p_distance2(int_line[0], int_line[1])
							if (ds <= max_d ** 2) {
								let int_p = int_line[1]
								int_p.line = line
								int_p.int_line = int_line
								int_p.li = li
								if (is_int_line_valid(int_p)) {
									if (ds < min_ds) {
										min_ds = ds
										min_int_p = min_int_p || _v0
										min_int_p.assign(int_p)
										min_int_p.line = _l1.assign(line)
										min_int_p.int_line = _l2.assign(int_line)
									}
								}
							}
						}
					}
				}
			}
		}
		return min_int_p
	}}

	e.point_hit_lines = point_hit_lines
	e.point_hit_edge = point_hit_edge
	e.line_hit_lines = line_hit_lines

	// selection --------------------------------------------------------------

	{
	let _bb0 = box3()
	let _bb1 = box3()
	e.bbox = function() {
		let bb = _bb0
		if (bbox_changed) {
			bb.reset()
			each_line(line => bb.add(line))
			for (let child of children) {
				let cbb = child.comp.bbox().to(_bb1).transform(child)
				bb.add(cbb)
			}
			bbox_changed = false
		}
		return bb
	}}

	let sel_lines = set() // {l1i,...}
	let sel_lines_changed

	{
	let _line = line3()
	e.each_selected_line = function(f) {
		for (let li of sel_lines) {
			get_line(li, _line)
			f(_line)
		}
	}}

	function select_all_lines(sel) {
		if (sel)
			for (let i = 0, n = e.line_count(); i < n; i++) {
				if (line_rc(i))
					sel_lines.add(i)
			}
		else
			sel_lines.clear()
		sel_lines_changed = true
	}

	let sel_face_count = 0

	function face_set_selected(face, sel) {
		if (!face.selected == !sel)
			return
		face.selected = sel
		sel_face_count += (sel ? 1 : -1)
		faces_changed = true
	}

	function select_all_faces(sel) {
		for (let face of faces)
			if (face.length)
				face_set_selected(face, sel)
	}

	function select_edges(face, mode) {
		face.each_edge(function(line) {
			e.select_line(line.i, mode)
		})
	}

	function select_line_faces(li, mode) {
		e.each_line_face(li, function(face) {
			e.select_face(face, mode)
		})
	}

	e.select_face = function(face, mode, with_lines) {
		if (mode == 'add' || mode == 'remove') {
			face_set_selected(face, mode == 'add')
			if (mode == 'add' && with_lines) {
				select_edges(face, mode)
				sel_lines_changed = true
			}
		} else if (mode == 'toggle') {
			e.select_face(face, face.selected ? 'remove' : 'add', with_lines)
		} else
			assert(false)
	}

	e.select_line = function(li, mode, with_faces) {
		if (mode == 'add') {
			sel_lines.add(li)
			if (with_faces)
				select_line_faces(li, 'add')
		} else if (mode == 'remove') {
			sel_lines.delete(li)
		} else if (mode == 'toggle') {
			e.select_line(li, sel_lines.has(li) ? 'remove' : 'add', with_faces)
		} else
			assert(false)
		sel_lines_changed = true
	}

	e.is_line_selected = function(li) {
		return sel_lines.has(li)
	}

	e.selected_child = null

	e.select_child = function(child, mode) {
		let sel = mode == 'toggle' ? !child.selected : mode == 'add'
		if (sel == !!child.selected)
			return
		child.selected = sel
		sel_child_count += (sel ? 1 : -1)
		e.selected_child = sel_child_count == 1 ? child : null
		sel_lines_changed = true
	}

	function select_all_children(sel) {
		for (let child of children)
			e.select_child(child, sel ? 'add' : 'remove')
	}

	e.select_all = function(sel, with_children) {
		if (sel == null) sel = true
		select_all_faces(sel)
		select_all_lines(sel)
		if (with_children !== false)
			select_all_children(sel)
	}

	e.remove_selection = function() {

		// remove all faces that selected lines are sides of.
		for (let li of sel_lines)
			e.each_line_face(li, remove_face)

		// remove all selected faces.
		for (let face of faces)
			if (face.length && face.selected)
				remove_face(face)

		// remove all selected lines.
		for (let li of sel_lines)
			while (line_rc(li))
				release_line(li)

		// TODO: merge faces.

		select_all_lines(false)
	}

	e.selected_face_count = () => sel_face_count
	e.selected_line_count = () => sel_lines.size
	e.selected_child_count = () => sel_child_count

	// repair -----------------------------------------------------------------

	// at the end of each operation, repair() fixes the lines changed by it,
	// so that the next operation starts from a clean model: touching or
	// crossing lines are cut at that point and share it, points at the same
	// place are merged, a line with the same two points as another is merged
	// into it, and two straight lines with a point used by no other line are
	// joined into one.

	// merge `pi` into `into_pi`, a point at the same place: `pi` is replaced
	// with `into_pi` in every line and face using it.
	function merge_point(pi, into_pi) {
		// lines ending at `pi`: move that end.
		for (let li = 0, n = line_count(); li < n; li++)
			if (line_rc(li) && (lines[5*li+0] == pi || lines[5*li+1] == pi))
				replace_line_endpoint(li, into_pi, pi)
		// faces using `pi`: replace the point.
		for (let face of faces) {
			let ei = face.indexOf(pi)
			if (ei == -1)
				continue
			ref_point(into_pi)
			replace_face_point(face, ei, into_pi)
			unref_point(pi)
		}
	}

	// remove each filament of `face`: two edges in a row on one line, going
	// out to a point and back. they enclose no area (F3), so both edges and
	// the point between them are removed.
	function remove_filaments(face) {
		let ei = 0
		while (ei < face.length) {
			let next_ei = face.next_i(ei)
			let li = face.lis[ei]
			// a contour of one point: its edge is next to itself.
			if (next_ei == ei || face.lis[next_ei] != li) {
				ei++
				continue
			}
			let pi = face[ei]
			let far_pi = face[next_ei]
			// the far point and the edge back.
			remove_edge(face, next_ei, false)
			unref_line(li)
			unref_point(far_pi)
			// the point left twice in a row, and the edge out, now between
			// those two. removing the far point moved it down if that came
			// first (the edge back closed the contour).
			remove_edge(face, next_ei < ei ? ei - 1 : ei, false)
			unref_line(li)
			unref_point(pi)
			// the edges at the point left can be a filament now.
			ei = 0
		}
	}

	// merge `li` into `into_li`, a line with the same two points: the faces
	// using `li` are moved to `into_li`, and `li` is freed.
	function merge_line(li, into_li) {
		each_line_face(li, function(face) {
			let ei = face.lis.indexOf(li)
			ref_line(into_li)
			replace_edge(face, ei, into_li, li)
			unref_line(li)
		})
		release_line(li)
		// marked as touched because it is the only line left when a line is
		// drawn exactly over it, and faces are made for a traced line
		// (make_cycle_faces()).
		touched_lis.add(into_li)
	}

	// join `li2` into `li` at `pi`, the point used only by the two lines,
	// which lie on one straight line. `li` then ends at `other_pi`, the other
	// end of `li2`. so a line is not left split at a point with nothing else
	// there.
	function join_line(li, pi, li2, other_pi) {
		set_line_smoothness (li, max(line_smoothness(li), line_smoothness(li2)))
		set_line_opacity    (li, max(line_opacity(li), line_opacity(li2)))
		// each face at `pi`: put `li` on the edge before `pi`, then remove
		// `pi` and the edge after it.
		for (let face of faces) {
			let ei = face.indexOf(pi)
			if (ei == -1)
				continue
			let prev_ei = face.prev_i(ei)
			if (face.lis[prev_ei] == li2)
				replace_edge(face, prev_ei, li, li2)
			remove_edge(face, ei, false)
			unref_line(li2)
			unref_point(pi)
		}
		replace_line_endpoint(li, other_pi, pi)
		release_line(li2)
	}

	// make one fix to line `li`: merge, cut or join it at the points and lines
	// on it. return true if anything was changed, so that repair() calls it
	// again until the line needs no fix.
	let repair_line
	{
	let _l0 = line3()
	let _l1 = line3()
	let _l2 = line3()
	let _v0 = v3()
	let _v1 = v3()
	repair_line = function(li) {
		let p1i = lines[5*li+0]
		let p2i = lines[5*li+1]

		// zero length: remove it, and its edge and repeated point from the
		// faces that use it. the edges on each side of it can go out and back
		// on one line: remove that filament. a face left with fewer than 3
		// points has no area: remove it too.
		if (p1i == p2i) {
			each_line_face(li, function(face) {
				remove_edge(face, face.lis.indexOf(li), false)
				unref_line(li)
				unref_point(p1i)
				remove_filaments(face)
				if (face.point_count_without_holes() < 3)
					remove_face(face)
			})
			release_line(li)
			return true
		}

		let line = get_line(li, _l0)

		// both points at one place: merge the second into the first. the
		// point scan below skips our own points, so they aren't merged there.
		if (line[0].distance2(line[1]) <= NEAR ** 2) {
			merge_point(p2i, p1i)
			return true
		}

		// the line's bounding box grown by NEAR: points and lines outside it
		// are skipped before any distance math.
		let x1 = min(line[0][0], line[1][0]) - NEAR
		let y1 = min(line[0][1], line[1][1]) - NEAR
		let z1 = min(line[0][2], line[1][2]) - NEAR
		let x2 = max(line[0][0], line[1][0]) + NEAR
		let y2 = max(line[0][1], line[1][1]) + NEAR
		let z2 = max(line[0][2], line[1][2]) + NEAR

		// points first, so that the line checks below never add a point
		// where one already is: find the closest point on the line.
		let hit_pi
		let hit_ds = 1/0
		for (let pi = 0, n = point_count(); pi < n; pi++) {
			// unused point or one of our ends: skip.
			if (pi == p1i || pi == p2i || !prc[pi])
				continue
			// outside the box: skip.
			let x = points[3*pi+0]
			let y = points[3*pi+1]
			let z = points[3*pi+2]
			if (x < x1 || x > x2 || y < y1 || y > y2 || z < z1 || z > z2)
				continue
			// on the line and closest so far: keep.
			let p = get_point(pi, _v1)
			line.project_point(p, true, _v0)
			let ds = _v0.distance2(p)
			if (ds <= NEAR ** 2 && ds < hit_ds) {
				hit_pi = pi
				hit_ds = ds
			}
		}

		// point at one of our ends: merge the end into it. else: cut there.
		if (hit_pi != null) {
			let p = get_point(hit_pi, _v1)
			if (p.distance2(line[0]) <= NEAR ** 2)
				merge_point(p1i, hit_pi)
			else if (p.distance2(line[1]) <= NEAR ** 2)
				merge_point(p2i, hit_pi)
			else
				cut_line(li, hit_pi)
			return true
		}

		// lines: fix the first one found.
		let p1_li2 // the only other line at our first end; -1: more than one.
		let p2_li2 // the only other line at our second end; -1: more than one.
		for (let li2 = 0, n = line_count(); li2 < n; li2++) {
			// freed line or this line: skip.
			if (li2 == li || !line_rc(li2))
				continue

			// same two points: merge ours into it.
			let q1i = lines[5*li2+0]
			let q2i = lines[5*li2+1]
			if (q1i == p1i && q2i == p2i || q1i == p2i && q2i == p1i) {
				merge_line(li, li2)
				return true
			}

			// outside the box: skip.
			let a = 3*q1i
			let b = 3*q2i
			if (min(points[a+0], points[b+0]) > x2) continue
			if (max(points[a+0], points[b+0]) < x1) continue
			if (min(points[a+1], points[b+1]) > y2) continue
			if (max(points[a+1], points[b+1]) < y1) continue
			if (min(points[a+2], points[b+2]) > z2) continue
			if (max(points[a+2], points[b+2]) < z1) continue

			// one of our ends inside it: cut it there.
			let line2 = get_line(li2, _l1)
			for (let i = 0; i < 2; i++) {
				let p = line[i]
				if (q1i == p.i || q2i == p.i)
					continue
				line2.project_point(p, true, _v0)
				if (_v0.distance2(p) <= NEAR ** 2) {
					cut_line(li2, p.i)
					return true
				}
			}

			// shares an end with ours, so they meet only there; remember it,
			// to join the two lines if no other line uses that end.
			if (q1i == p1i || q2i == p1i) {
				p1_li2 = p1_li2 == null ? li2 : -1
				continue
			}
			if (q1i == p2i || q2i == p2i) {
				p2_li2 = p2_li2 == null ? li2 : -1
				continue
			}

			// crossing inside both: cut both at a new point.
			let int_line = line.intersect_line(line2, _l2, 'clamp')
			if (int_line && int_line[0].distance2(int_line[1]) <= NEAR ** 2) {
				let pi = add_point(int_line[1])
				cut_line(li, pi)
				cut_line(li2, pi)
				return true
			}
		}

		// when only one other line uses an end, and it continues ours in a
		// straight line, join it into ours.
		for (let i = 0; i < 2; i++) {
			let li2 = i ? p2_li2 : p1_li2
			if (li2 == null || li2 == -1)
				continue
			let pi = line[i].i
			let q1i = lines[5*li2+0]
			let other_pi = q1i == pi ? lines[5*li2+1] : q1i
			let joined_line = _l1
			get_point(line[1-i].i, joined_line[0])
			get_point(other_pi, joined_line[1])
			joined_line.project_point(line[i], true, _v0)
			if (_v0.distance2(line[i]) <= NEAR ** 2) {
				join_line(li, pi, li2, other_pi)
				return true
			}
		}

		return false
	}}

	// called when an operation starts: the model follows the rules then, so
	// anything recorded before (undo, add_face(), loading) needs no check.
	function clear_touched() {
		touched_pis.clear()
		touched_lis.clear()
	}

	// fix the touched lines until none is left. return the lines checked in
	// all rounds: faces are made and merged for them afterwards.
	function repair() {
		let checked_lis = set() // {li}; checked in all rounds; some freed.
		let lis = []
		while (touched_lis.size || touched_pis.size) {
			// take the touched lines and the lines using touched points.
			for (let li of touched_lis)
				lis.push(li)
			if (touched_pis.size)
				for (let li = 0, n = line_count(); li < n; li++)
					if (line_rc(li) && (touched_pis.has(lines[5*li+0])
							|| touched_pis.has(lines[5*li+1])))
						lis.push(li)
			touched_lis.clear()
			touched_pis.clear()
			// fix each line until it needs no fix. the fixes record what they
			// touch, which is checked in the next round.
			for (let li of lis) {
				checked_lis.add(li)
				while (line_rc(li) && repair_line(li)) {}
			}
			lis.length = 0
		}
		return checked_lis
	}

	// faces from cycles of lines ---------------------------------------------

	// find the smallest cycle on the left of line `li` going from `p1i` to
	// `p2i`, in the plane through `p1i` with `normal`, to make a face for it:
	// take the sharpest left turn at each point and walk back out of
	// filaments. fill `pis` and `lis`; return false when there is no area on
	// that side: the cycle doesn't have `li` once (`li` is a filament), or is
	// clockwise in total (it goes around the outside).
	let walk_cycle
	{
	let _v0 = v3()
	let _v1 = v3()
	let _v2 = v3()
	let _v3 = v3()
	let _v4 = v3()
	walk_cycle = function(li, p1i, p2i, normal, pis, lis) {
		let p1 = get_point(p1i, _v0)
		let x_axis = get_point(p2i, _v1).sub(p1).normalize()
		let y_axis = _v2.set(normal).cross(x_axis)
		let plane_const = -normal.dot(p1)
		pis.length = 0
		lis.length = 0
		pis.push(p1i, p2i)
		lis.push(li)
		let from_pi = p1i
		let cur_pi = p2i
		let turn_angle = 0 // pseudo-angles: 4 for a cycle, -4 for an outer one.
		while (1) {
			let cur_p = get_point(cur_pi, _v3)
			let back_dir = get_point(from_pi, _v4).sub(cur_p)
			let back_angle =
				pseudo_angle(back_dir.dot(x_axis), back_dir.dot(y_axis))
			// take the line with the smallest clockwise angle from the way
			// back. the way back has the largest angle, so it's taken only at
			// the end of a filament.
			let next_li
			let next_pi
			let min_cw_angle = 1/0
			for (let li2 = 0, n = line_count(); li2 < n; li2++) {
				if (!line_rc(li2))
					continue
				let q1i = lines[5*li2+0]
				let q2i = lines[5*li2+1]
				let other_pi = q1i == cur_pi ? q2i : (q2i == cur_pi ? q1i : null)
				if (other_pi == null)
					continue
				let other_p = get_point(other_pi, _v4)
				// other end out of the plane: skip.
				if (abs(normal.dot(other_p) + plane_const) > NEAR)
					continue
				let dir = other_p.sub(cur_p)
				let angle = pseudo_angle(dir.dot(x_axis), dir.dot(y_axis))
				let cw_angle = angle_sweep(angle, back_angle, true) || 4
				if (cw_angle < min_cw_angle) {
					min_cw_angle = cw_angle
					next_li = li2
					next_pi = other_pi
				}
			}
			turn_angle += 2 - min_cw_angle
			// at the start line again: the cycle is closed.
			if (cur_pi == p1i && next_li == li)
				break
			// walking back the line we came on: drop it.
			let n = pis.length
			if (n >= 2 && pis[n-2] == next_pi && lis[n-2] == next_li) {
				pis.pop()
				lis.pop()
			} else {
				pis.push(next_pi)
				lis.push(next_li)
			}
			from_pi = cur_pi
			cur_pi = next_pi
		}
		pis.pop() // `p1i` again.
		return lis[0] == li && lis.indexOf(li, 1) == -1 && turn_angle > 0
	}}

	// a new face drawn around faces in its plane gets a hole around each group
	// of them, so that no area is covered by two faces. append to `pis`, `lis`
	// the outer outlines of the groups of faces in `face_list` as holes,
	// going clockwise around `normal`, or counter-clockwise with
	// `want_reverse`. an outline is made of the edges that only one of the
	// faces uses. a counter-clockwise one is a hole; a clockwise one goes
	// around an empty area, and the holes inside empty areas are dropped.
	// return the holes: [hole1_i1, hole2_i1, ...], or undefined.
	let push_group_holes
	{
	let _v0 = v3()
	let _v1 = v3()
	let _v2 = v3()
	let inner_face  = face3() // a clockwise outline, for hit-testing.
	let edge_counts = new Map() // {li -> number of uses by the faces}
	let first_eis   = new Map() // {p1i -> first edge from p1i}
	let from_pis    = [] // the outline edges: their first points,
	let to_pis      = [] // their second points,
	let edge_lis    = [] // their lines,
	let next_eis    = [] // the next edge from the same point,
	let is_used     = [] // and whether an outline took them.
	let outline_pis = [] // the outlines, one after another: their points,
	let outline_lis = [] // their lines,
	let outline_i1s = [] // where each one starts,
	let outline_kinds = [] // and what each is: 'hole', 'empty' or 'dropped'.
	push_group_holes = function(face_list, normal, want_reverse, pis, lis) {

		edge_counts.clear()
		for (let face of face_list)
			for (let li of face.lis)
				edge_counts.set(li, (edge_counts.get(li) ?? 0) + 1)

		// the edges that only one face uses, with the face on their left.
		first_eis.clear()
		from_pis.length = 0
		to_pis.length = 0
		edge_lis.length = 0
		next_eis.length = 0
		is_used.length = 0
		for (let face of face_list) {
			let is_reversed = face.plane().normal.dot(normal) < 0
			for (let i = 0; i < face.length; i++) {
				let li = face.lis[i]
				if (edge_counts.get(li) != 1)
					continue
				let p1i = face[is_reversed ? face.next_i(i) : i]
				let p2i = face[is_reversed ? i : face.next_i(i)]
				next_eis.push(first_eis.get(p1i))
				first_eis.set(p1i, from_pis.length)
				from_pis.push(p1i)
				to_pis.push(p2i)
				edge_lis.push(li)
				is_used.push(false)
			}
		}

		// chain the edges into outlines.
		outline_pis.length = 0
		outline_lis.length = 0
		outline_i1s.length = 0
		outline_kinds.length = 0
		for (let ei = 0; ei < from_pis.length; ei++) {
			if (is_used[ei])
				continue
			outline_i1s.push(outline_pis.length)
			let area = 0 // twice the area around `normal`.
			let cur_ei = ei
			while (cur_ei != null) {
				is_used[cur_ei] = true
				outline_pis.push(from_pis[cur_ei])
				outline_lis.push(edge_lis[cur_ei])
				let p1 = get_point(from_pis[cur_ei], _v0)
				let p2 = get_point(to_pis[cur_ei], _v1)
				area += _v2.set(p1).cross(p2).dot(normal)
				let next_ei = first_eis.get(to_pis[cur_ei])
				while (next_ei != null && is_used[next_ei])
					next_ei = next_eis[next_ei]
				cur_ei = next_ei
			}
			outline_kinds.push(area > 0 ? 'hole' : 'empty')
		}

		// drop the holes inside an empty area.
		let n = outline_i1s.length
		for (let k = 0; k < n; k++) {
			if (outline_kinds[k] != 'empty')
				continue
			let i1 = outline_i1s[k]
			let i2 = outline_i1s[k+1] ?? outline_pis.length
			inner_face.length = 0
			for (let i = i1; i < i2; i++)
				inner_face.push(outline_pis[i])
			inner_face.invalidate()
			let plane = inner_face.plane()
			for (let k2 = 0; k2 < n; k2++) {
				if (outline_kinds[k2] != 'hole')
					continue
				let p = get_point(outline_pis[outline_i1s[k2]], _v0)
				let xy = plane.transform32(p, _v1)
				if (inner_face.hit(xy[0], xy[1]))
					outline_kinds[k2] = 'dropped'
			}
		}

		let holes
		for (let k = 0; k < n; k++) {
			if (outline_kinds[k] != 'hole')
				continue
			let i1 = outline_i1s[k]
			let i2 = outline_i1s[k+1] ?? outline_pis.length
			holes ??= []
			holes.push(pis.length)
			if (want_reverse) {
				for (let i = i1; i < i2; i++) {
					pis.push(outline_pis[i])
					lis.push(outline_lis[i])
				}
			} else {
				pis.push(outline_pis[i1])
				for (let i = i2-1; i > i1; i--)
					pis.push(outline_pis[i])
				for (let i = i2-1; i >= i1; i--)
					lis.push(outline_lis[i])
			}
		}
		return holes
	}}

	// whether the outline of `face` has the same points as the first `n` of
	// `pis`: used to find a cycle that already has a face, and two faces
	// covering the same area.
	function has_outline(face, pis, n) {
		if (face.point_count_without_holes() != n)
			return false
		for (let j = 0; j < n; j++) {
			let i = pis.indexOf(face[j])
			if (i == -1 || i >= n)
				return false
		}
		return true
	}

	// add a face for the cycle `pis`, `lis`, which goes counter-clockwise
	// around `normal`. splitting `split_face`: keep its side and material,
	// and take its holes that are inside the cycle. else: skip a cycle that
	// has a face, and use shared edges the opposite way to the face across,
	// so that the new face has the same front side as its neighbours.
	let add_cycle_face
	{
	let cycle_face = face3() // the cycle, for hit-testing.
	let _v0 = v3()
	let _v1 = v3()
	let enclosed_faces = [] // the faces in the plane inside the cycle.
	add_cycle_face = function(pis, lis, normal, split_face) {
		cycle_face.length = 0
		extend(cycle_face, pis)
		cycle_face.invalidate()
		enclosed_faces.length = 0
		let want_reverse
		if (split_face) {
			want_reverse = split_face.plane().normal.dot(normal) < 0
		} else {
			let plane = cycle_face.plane()
			for (let face of faces) {
				let i = 0
				while (i < lis.length && !face.lis.includes(lis[i]))
					i++
				if (i == lis.length) {
					// a face in the plane inside the cycle makes a hole.
					let p = face.length ? get_point(face[0], _v0) : null
					if (p && abs(face.plane().normal.dot(normal)) >= 1 - NEAR
							&& abs(plane.distance_to_point(p)) <= NEAR) {
						let xy = plane.transform32(p, _v1)
						if (cycle_face.hit(xy[0], xy[1]))
							enclosed_faces.push(face)
					}
					continue
				}
				// the cycle is this face's outline, so it already has a face.
				if (has_outline(face, pis, pis.length))
					return
				want_reverse ??= face[face.lis.indexOf(lis[i])] == pis[i]
			}
		}
		if (want_reverse) {
			pis.reverse()
			pis.unshift(pis.pop())
			lis.reverse()
		}
		let holes
		if (enclosed_faces.length)
			holes = push_group_holes(enclosed_faces, normal, want_reverse,
				pis, lis)
		if (split_face?.holes?.length) {
			for (let h = 0; h < split_face.holes.length; h++) {
				let i1 = split_face.hole_i1(h)
				let i2 = split_face.hole_i2(h)
				let hole_p = get_point(split_face[i1], _v0)
				let hole_xy = cycle_face.plane().transform32(hole_p, _v1)
				if (!cycle_face.hit(hole_xy[0], hole_xy[1]))
					continue
				holes ??= []
				holes.push(pis.length)
				for (let i = i1; i < i2; i++) {
					pis.push(split_face[i])
					lis.push(split_face.lis[i])
				}
			}
		}
		return add_face(pis, lis, split_face?.mat_inst.material, holes)
	}}

	// a cycle drawn inside a face becomes a filled island: the island gets its
	// own face and the face gets a hole around it, so that no area is covered
	// by two faces. add a face for the cycle `pis`, `lis`, an island inside
	// `face`, and replace `face` with a copy that has `outer_pis`, `outer_lis`
	// as a hole
	// instead of its holes on it or taken by the island. the outer walk goes
	// clockwise around `normal`, around the island and the lines connected
	// to it, so an island next to a hole gives one hole around both.
	let add_island
	{
	let face_pis   = [] // the points of the copy of `face`.
	let face_lis   = [] // its lines.
	let face_holes = [] // its holes: [hole1_i1, hole2_i1, ...]
	add_island = function(pis, lis, outer_pis, outer_lis, normal, face) {
		let island_face = add_cycle_face(pis, lis, normal, face)
		face_pis.length = 0
		face_lis.length = 0
		face_holes.length = 0
		let n = face.point_count_without_holes()
		for (let i = 0; i < n; i++) {
			face_pis.push(face[i])
			face_lis.push(face.lis[i])
		}
		for (let h = 0; h < face.hole_count(); h++) {
			let i1 = face.hole_i1(h)
			let i2 = face.hole_i2(h)
			if (outer_pis.includes(face[i1]) || island_face.includes(face[i1]))
				continue
			face_holes.push(face_pis.length)
			for (let i = i1; i < i2; i++) {
				face_pis.push(face[i])
				face_lis.push(face.lis[i])
			}
		}
		// a hole goes the opposite way to the outline.
		if (face.plane().normal.dot(normal) < 0) {
			outer_pis.reverse()
			outer_pis.unshift(outer_pis.pop())
			outer_lis.reverse()
		}
		face_holes.push(face_pis.length)
		extend(face_pis, outer_pis)
		extend(face_lis, outer_lis)
		add_face(face_pis, face_lis, face.mat_inst.material, face_holes)
		remove_face(face)
	}}

	// make faces where a region is cut in two by line `li`: walk the cycles
	// on both sides of `li` in each plane of `li` and a line at its ends. a
	// face crossed by `li` is split into the two cycles; else a face is added
	// for each cycle without one.
	let make_line_faces
	{
	let _v0 = v3()
	let _v1 = v3()
	let _v2 = v3()
	let _v3 = v3()
	let left_pis  = [] // the points of the cycle on the left of `li`.
	let left_lis  = [] // its lines.
	let right_pis = [] // the points of the cycle on the right of `li`.
	let right_lis = [] // its lines.
	make_line_faces = function(li) {
		let p1i = lines[5*li+0]
		let p2i = lines[5*li+1]
		let p1 = get_point(p1i, _v0)
		let p2 = get_point(p2i, _v1)
		let line_len = p1.distance(p2)

		// one plane for each line at our ends that isn't along our line.
		let normals = []
		for (let li2 = 0, n = line_count(); li2 < n; li2++) {
			if (li2 == li || !line_rc(li2))
				continue
			let q1i = lines[5*li2+0]
			let q2i = lines[5*li2+1]
			let other_pi = (q1i == p1i || q1i == p2i) ? q2i
				: ((q2i == p1i || q2i == p2i) ? q1i : null)
			if (other_pi == null)
				continue
			let other_dir = get_point(other_pi, _v3).sub(p1)
			let normal = _v2.set(p2).sub(p1).cross(other_dir)
			// a line along ours makes no plane.
			if (normal.len() <= NEAR * line_len)
				continue
			normal.normalize()
			let i = 0
			while (i < normals.length && abs(normals[i].dot(normal)) < 1 - NEAR)
				i++
			if (i == normals.length)
				normals.push(normal.clone())
		}

		let mid = _v2.set(p1).add(p2).muls(.5)
		for (let normal of normals) {

			let has_left_cycle =
				walk_cycle(li, p1i, p2i, normal, left_pis, left_lis)
			let has_right_cycle =
				walk_cycle(li, p2i, p1i, normal, right_pis, right_lis)

			// the face that `li` crosses: in the plane, not using `li`, and
			// containing its middle.
			let split_face
			for (let face of faces) {
				if (!face.length || face.lis.includes(li))
					continue
				let plane = face.plane()
				if (abs(plane.normal.dot(normal)) < 1 - NEAR)
					continue
				if (abs(plane.distance_to_point(mid)) > NEAR)
					continue
				let mid_xy = plane.transform32(mid, _v3)
				if (face.hit(mid_xy[0], mid_xy[1])) {
					split_face = face
					break
				}
			}

			if (split_face) {
				if (has_left_cycle && has_right_cycle) {
					add_cycle_face(left_pis, left_lis, normal, split_face)
					add_cycle_face(right_pis, right_lis, normal, split_face)
					remove_face(split_face)
				} else if (has_left_cycle) {
					add_island(left_pis, left_lis, right_pis, right_lis, normal,
						split_face)
				} else if (has_right_cycle) {
					add_island(right_pis, right_lis, left_pis, left_lis, normal,
						split_face)
				}
			} else {
				if (has_left_cycle)
					add_cycle_face(left_pis, left_lis, normal)
				if (has_right_cycle)
					add_cycle_face(right_pis, right_lis, normal)
			}

		}
	}}

	// make faces for the drawn `line`. faces are made only where a region is
	// cut in two by an added line, so make_line_faces() is called only for
	// the lines on `line`: its pieces and the lines it was drawn over. no
	// region is cut by a line drawn over an existing one, but faces are made
	// for its cycles: that is how the user makes a face for an existing
	// cycle. the lines on `line` are among `lis`, the lines that repair()
	// checked; the halves of an edge cut by `line` are skipped, so an erased
	// face on that edge is not brought back.
	let make_cycle_faces
	{
	let _v0 = v3()
	let _v1 = v3()
	make_cycle_faces = function(line, lis) {
		let line_len = line[0].distance(line[1])
		let dir = _v0.set(line[1]).sub(line[0]).muls(1 / line_len)
		// make_line_faces() changes only faces, so it can be called during
		// the scan.
		for (let li of lis) {
			if (!line_rc(li))
				continue
			// skip lines with an end off the drawn line; t1 and t2 are the
			// ends' distances along it.
			let dp1 = get_point(lines[5*li+0], _v1).sub(line[0])
			let t1 = dp1.dot(dir)
			if (dp1.len2() - t1 * t1 > NEAR ** 2)
				continue
			let dp2 = get_point(lines[5*li+1], _v1).sub(line[0])
			let t2 = dp2.dot(dir)
			if (dp2.len2() - t2 * t2 > NEAR ** 2)
				continue
			// make faces for the lines that overlap the drawn line by more
			// than a point.
			let t_min = max(min(t1, t2), 0)
			let t_max = min(max(t1, t2), line_len)
			if (t_max - t_min > NEAR)
				make_line_faces(li)
		}
	}}

	// make faces after a pull. no lines are added by a pull, so no region is
	// cut; but when a face is moved onto part of another face, or across its
	// edge, the two faces are left overlapping. both are split along each
	// other's lines, so that the overlap is a face of each, with the same
	// outline, for merge_faces(). `lis` are the lines that repair() checked;
	// make_line_faces() is called only for a line inside a face in its plane
	// that doesn't use it, so cycles are walked only where faces overlap.
	let make_overlap_faces
	{
	let _v0 = v3()
	let _v1 = v3()
	let _v2 = v3()
	let _v3 = v3()
	make_overlap_faces = function(lis) {
		for (let li of lis) {
			if (!line_rc(li))
				continue
			let p1 = get_point(lines[5*li+0], _v0)
			let p2 = get_point(lines[5*li+1], _v1)
			let mid = _v2.set(p1).add(p2).muls(.5)
			// a face in the line's plane, not using it, and containing its
			// middle.
			for (let face of faces) {
				if (!face.length || face.lis.includes(li))
					continue
				let plane = face.plane()
				if (abs(plane.distance_to_point(p1)) > NEAR)
					continue
				if (abs(plane.distance_to_point(p2)) > NEAR)
					continue
				let mid_xy = plane.transform32(mid, _v3)
				if (face.hit(mid_xy[0], mid_xy[1])) {
					make_line_faces(li)
					break
				}
			}
		}
	}}

	// faces with the same outline --------------------------------------------

	// two faces with the same outline cover the same area, so one of them is
	// removed: the second one found, among the faces on `lis`, the lines that
	// repair() checked. with `want_remove_both` (after a pull), both are
	// removed: they are the wall between two volumes, so the volumes are
	// joined, or a hole is made. their outline lines left without a face
	// (rc 1) are released, so a box pushed onto its own bottom is removed
	// completely. the faces and lines inside the holes of the two faces are
	// kept.
	function merge_faces(lis, want_remove_both) {
		let line_faces = [] // the faces using a line.
		for (let li of lis) {
			if (!line_rc(li))
				continue
			line_faces.length = 0
			each_line_face(li, function(face) {
				line_faces.push(face)
			})
			for (let i = 0; i < line_faces.length; i++) {
				let face1 = line_faces[i]
				// removed as a copy of an earlier face: skip.
				if (!face1.length)
					continue
				let n = face1.point_count_without_holes()
				for (let j = i + 1; j < line_faces.length; j++) {
					let face2 = line_faces[j]
					// removed, or another outline: skip.
					if (!face2.length || !has_outline(face2, face1, n))
						continue
					if (want_remove_both) {
						let outline_lis = face1.lis.slice(0, n)
						remove_face(face1)
						remove_face(face2)
						for (let li2 of outline_lis)
							if (line_rc(li2) == 1)
								release_line(li2)
						break
					} else {
						remove_face(face2)
					}
				}
			}
		}
	}

	// draw line --------------------------------------------------------------

	e.draw_line = function(line) {

		let p1 = line[0]
		let p2 = line[1]

		// check for min. line length for lines with new endpoints.
		if (p1.i == null || p2.i == null) {
			if (p1.distance2(p2) <= NEAR ** 2)
				return
		} else if (p1.i == p2.i) {
			// check if end point was snapped to start end point.
			return
		}

		// add the line as given: repair() splits it and what it touches.
		clear_touched()
		let p1i = p1.i ?? add_point(p1)
		let p2i = p2.i ?? add_point(p2)
		add_line(p1i, p2i)
		make_cycle_faces(line, repair())

	}

	// push/pull --------------------------------------------------------------

	e.start_pull = function(p) {

		clear_touched()

		let pull = {}

		// pulled face.
		pull.face = p.face

		// pull direction line, starting on the plane and with unit length.
		pull.line = line3(p.to(v3()), p.to(v3()).add(pull.face.plane().normal))
		pull.origin = pull.line[0]

		// faces and lines to exclude when hit-testing while pulling.
		// all moving geometry must be added here.
		let moving_faces = set() // {face->true}
		let moving_lis = set() // {li->true}

		moving_faces.add(pull.face)

		let min_distance = -1/0
		let max_distance =  1/0

		// pulling only works if the pulled face is connected exclusively to
		// perpendicular (pp) side faces with pp edges at the connection points.
		// when that's not the case, we extend the geometry around the pulled
		// face by either creating new pp faces with pp edges or extending
		// existing pp faces with pp edges. after that, pulling on the face
		// becomes just a matter of moving its points in the pull direction.

		// the setup takes two steps: 1) record what needs to be done with
		// the side geometry at each point of the pulled face, 2) perform the
		// modifications, avoiding making duplicate pp edges.
		{
			let new_pp_edge = map() // {pull_ei->true}
			let new_pp_face = map() // {pull_ei->true}
			let ins_edge = map() // {pp_face->[[pull_li, line_before_point, pull_ei, pp_side_li|null],...]}

			let pull_edge = line3()
			let side_edge = line3()
			let normal = v3()
			let _v0 = v3()
			let _v1 = v3()

			let en = pull.face.length

			let pp_side_faces = [] // [face1, face1_ei, ...]; pp faces containing the pulled edge.

			// for each edge of the pulled face, find all faces that also
			// contain that edge and are pp to the pulled face. there should be
			// at most two such faces per edge, one on each side of the pulled face.
			// also check for any other non-pp faces connected to the pulled face's points.
			for (let pull_ei = 0; pull_ei < en; pull_ei++) {

				let pp_faces_found = 0
				pull.face.get_edge(pull_ei, pull_edge)
				let pull_li = pull.face.lis[pull_ei]
				let non_pp_face_has_edge = false
				pp_side_faces.length = 0

				for (let face of faces) {

					if (face.length && face != pull.face) { // not freed or pulled.

						if (abs(face.plane().normal.dot(pull.face.plane().normal)) < NEAR) { // face is pp.

							let face_ei = face.lis.indexOf(pull_li)
							if (face_ei != -1) // face contains our pulled edge, so it's a pp side face.
								pp_side_faces.push(face, face_ei)

						} else { // face is not pp, check if it contains our pulled edge.

							if (face.lis.includes(pull_li))
								non_pp_face_has_edge = true

						}

					}

				}

				// a non-pp face keeps the pulled edge in place, so the pp side faces
				// can't stretch along with it: make a new pp face on the edge instead.
				if (!non_pp_face_has_edge) {
					let j = 0
					while (j < pp_side_faces.length) {
						let face    = pp_side_faces[j+0]
						let face_ei = pp_side_faces[j+1]

						pp_faces_found++

						pull_edge.delta(normal).normalize()

						// iterate exactly twice: for prev pp edge and for next pp edge,
						// each of which connects to one of the endpoints of our pulled edge,
						// and we don't know which one, we need to find out.
						for (let i = 0; i <= 1; i++) {

							let side_ei = i ? face.next_i(face_ei) : face.prev_i(face_ei)
							face.get_edge(side_ei, side_edge)

							let is_side_edge_pp = abs(side_edge.delta(_v0).dot(normal)) < NEAR

							// figure out which endpoint of the pulled edge this side edge connects to.
							let is_first  = side_edge[0].i == pull_edge[0].i || side_edge[1].i == pull_edge[0].i
							let is_second = side_edge[0].i == pull_edge[1].i || side_edge[1].i == pull_edge[1].i
							assert(is_first || is_second)
							let endpoint_ei = is_first ? pull_ei : pull.face.next_i(pull_ei)

							if (is_side_edge_pp) {
								moving_lis.add(side_edge.i)
							} else if (!pull.face.lis.includes(side_edge.i)) {
								// non-pp side edge: new pp side edge at that corner.
								// the other half of a split pulled edge moves along.
								new_pp_edge.set(endpoint_ei, true)
							}

							moving_faces.add(face)

							// add a command to extend this face with a pp edge if it turns out
							// that the point at `endpoint_ei` will have a pp edge.
							// NOTE: can't call insert_edge() with ei=0. luckily, we don't have to.
							attr(ins_edge, face, Array).push([pull_li, i == 0, endpoint_ei,
								is_side_edge_pp ? side_edge.i : null])

						}

						j += 2
					}
				}

				if (!pp_faces_found) { // no pp faces found: create one along with its two edges.
					new_pp_face.set(pull_ei, true)
					new_pp_edge.set(pull_ei, true)
					new_pp_edge.set(pull.face.next_i(pull_ei), true)
				}

			}

			// the lines and faces using a corner that moves in place, but not
			// moving with the pull, would be dragged along: they are given
			// their own point at the corner instead. when the pull stops,
			// repair() reconnects them to the geometry still at their points.
			let in_place_pis = map() // {pi->new_pi}; corners that move in place.
			for (let ei = 0; ei < en; ei++)
				if (!new_pp_edge.has(ei)) // no new pp side edge: moves in place.
					in_place_pis.set(pull.face[ei], null)

			// the corner's new point, added on first use.
			function disconnected_pi(pi) {
				let new_pi = in_place_pis.get(pi)
				if (new_pi == null) {
					new_pi = add_point(get_point(pi, _v0))
					in_place_pis.set(pi, new_pi)
				}
				return new_pi
			}

			// pp side edges and the pulled face's edges.
			let is_moving_li = li =>
				moving_lis.has(li) || pull.face.lis.includes(li)

			// lines that don't move: move their ends off in-place corners.
			for (let li = 0, n = line_count(); li < n; li++) {
				if (!line_rc(li) || is_moving_li(li))
					continue
				for (let i = 0; i < 2; i++) {
					let pi = lines[5*li+i]
					if (in_place_pis.has(pi))
						replace_line_endpoint(li, disconnected_pi(pi), pi)
				}
			}

			// faces that don't move: replace in-place corners with the new point.
			for (let face of faces) {
				if (moving_faces.has(face))
					continue
				for (let ei = 0, n = face.length; ei < n; ei++) {
					let pi = face[ei]
					if (!in_place_pis.has(pi))
						continue
					let new_pi = disconnected_pi(pi)
					ref_point(new_pi)
					replace_face_point(face, ei, new_pi)
					unref_point(pi)
					// a moving edge at the corner (a fin on a pp side edge):
					// the face gets its own copy of it.
					for (let edge_ei of [ei, face.prev_i(ei)]) {
						let li = face.lis[edge_ei]
						if (!is_moving_li(li))
							continue
						let q1i = lines[5*li+0]
						let other_pi = q1i == pi ? lines[5*li+1] : q1i
						let new_li = ref_or_add_line(new_pi, other_pi)
						replace_edge(face, edge_ei, new_li, li)
						unref_line(li)
					}
				}
			}

			if (LOG)
				log('pull.start', pull.face.i,
					'edges:', ...new_pp_edge.keys(),
					'faces:', ...new_pp_face.keys(),
					'insert:', json(ins_edge).replaceAll('"', '')
				)

			// create pp side edges and adjust pulled face points & edge endpoints.
			let old_points = {} // {ei: pi}
			for (let ei of new_pp_edge.keys()) {
				let old_pi = pull.face[ei]

				// create pp side edge at `ei`.
				let p = get_point(old_pi, _v0)
				let new_pi = add_point(p)
				let li = add_line(old_pi, new_pi)
				new_pp_edge.set(ei, li)
				moving_lis.add(li)

				// replace point in pulled face.
				old_points[ei] = old_pi
				ref_point(new_pi)
				replace_face_point(pull.face, ei, new_pi)
				unref_point(old_pi)

				// update the endpoint of pulled face edges that are connected to this point.
				let next_ei = ei
				let prev_ei = pull.face.prev_i(ei)
				let next_li = pull.face.lis[next_ei]
				let prev_li = pull.face.lis[prev_ei]
				if (!new_pp_face.get(next_ei)) replace_line_endpoint(next_li, new_pi, old_pi)
				if (!new_pp_face.get(prev_ei)) replace_line_endpoint(prev_li, new_pi, old_pi)
			}

			// create pp side faces using newly created pp side edges.
			for (let e1i of new_pp_face.keys()) {
				let e2i = pull.face.next_i(e1i)
				let p1i = pull.face[e1i]
				let p2i = pull.face[e2i]
				let side1_li = new_pp_edge.get(e1i)
				let side2_li = new_pp_edge.get(e2i)
				let old_pull_li = pull.face.lis[e1i]
				let old_p1i = old_points[e1i]
				let old_p2i = old_points[e2i]

				// create pp side face.
				let pull_li = add_line(p1i, p2i)
				let face = add_face(
					[old_p1i, old_p2i, p2i, p1i],
					[old_pull_li, side2_li, pull_li, side1_li]
				)
				moving_faces.add(face)

				// replace edge in pulled face.
				ref_line(pull_li)
				replace_edge(pull.face, e1i, pull_li, old_pull_li)
				unref_line(old_pull_li)
			}

			// extend pp side faces with newly created pp side edges.
			// the edge's index is looked up at each insert: earlier inserts
			// move it, and a face's edges aren't recorded in its own order.
			// a face whose own side edge at the corner is pp is stretched there
			// instead (P4): it takes the moving point, and a line from it along
			// its side edge. the old side line is left to the faces keeping the
			// old point.
			for (let [pp_face, t] of ins_edge) {
				for (let [pull_li, line_before_point, pull_ei, pp_side_li] of t) {
					let pull_pi = pull.face[pull_ei]
					let pp_li = new_pp_edge.get(pull_ei)
					if (pp_li == null)
						continue
					if (pp_side_li != null) {
						let old_pi = old_points[pull_ei]
						ref_point(pull_pi)
						replace_face_point(pp_face, pp_face.indexOf(old_pi), pull_pi)
						unref_point(old_pi)
						let q1i = lines[5*pp_side_li+0]
						let other_pi = q1i == old_pi ? lines[5*pp_side_li+1] : q1i
						let new_li = ref_or_add_line(pull_pi, other_pi)
						replace_edge(pp_face, pp_face.lis.indexOf(pp_side_li), new_li, pp_side_li)
						unref_line(pp_side_li)
						moving_lis.add(new_li)
					} else {
						ref_point(pull_pi)
						ref_line(pp_li)
						let pp_ei = pp_face.lis.indexOf(pull_li) + 1
						insert_edge(pp_face, pp_ei, pull_pi, line_before_point, pp_li)
					}
				}
			}

			// mark final pulled face's edges as non-hittable.
			for (let li of pull.face.lis)
				moving_lis.add(li)

			// limit the pull distance to where a side face would cross itself
			// (P2). check each moving edge against the part of each fixed edge
			// within its span. a side face with all its fixed points at one
			// height along the pull only flips: no limit.
			let pull_dir = pull.line.delta(normal) // unit length.
			let moving_h = get_point(pull.face[0], _v0).dot(pull_dir)
			let u_dir = _v1
			// an end within NEAR of the u range's end is on it: a fin's edge
			// there is met, a sloped edge leaving the corner is not.
			function snap_u(u, u_min, u_max) {
				if (abs(u - u_min) <= NEAR)
					return u_min
				if (abs(u - u_max) <= NEAR)
					return u_max
				return u
			}
			for (let face of moving_faces) {
				if (face == pull.face)
					continue

				let fixed_h0 // h of the first fixed point.
				let is_flipping = true
				for (let pi of face) {
					if (pull.face.includes(pi))
						continue
					let h = get_point(pi, _v0).dot(pull_dir)
					fixed_h0 ??= h
					if (abs(h - fixed_h0) > NEAR) {
						is_flipping = false
						break
					}
				}
				if (is_flipping)
					continue

				for (let mei = 0; mei < face.length; mei++) {
					if (!pull.face.includes(face[mei]))
						continue
					if (!pull.face.includes(face[face.next_i(mei)]))
						continue
					face.get_edge(mei, pull_edge).delta(u_dir).normalize()
					let u_min = pull_edge[0].dot(u_dir)
					let u_max = pull_edge[1].dot(u_dir)

					for (let ei = 0; ei < face.length; ei++) {
						if (pull.face.includes(face[ei]))
							continue
						if (pull.face.includes(face[face.next_i(ei)]))
							continue
						face.get_edge(ei, side_edge)
						let u1 = snap_u(side_edge[0].dot(u_dir), u_min, u_max)
						let u2 = snap_u(side_edge[1].dot(u_dir), u_min, u_max)
						if (max(u1, u2) < u_min || min(u1, u2) > u_max)
							continue

						let t1 = side_edge[0].dot(pull_dir) - moving_h
						let t2 = side_edge[1].dot(pull_dir) - moving_h
						let ua = clamp(u1, u_min, u_max)
						let ub = clamp(u2, u_min, u_max)
						let ta = ua == u1 ? t1 : lerp(ua, u1, u2, t1, t2)
						let tb = ub == u2 ? t2 : lerp(ub, u1, u2, t1, t2)
						let t_min = min(ta, tb)
						let t_max = max(ta, tb)

						// met on a side of 0: the pull can go that way up to the
						// first meeting, and not at all if that is at 0.
						if (t_max > NEAR)
							max_distance = min(max_distance, max(t_min, 0))
						if (t_min < -NEAR)
							min_distance = max(min_distance, min(t_max, 0))
					}
				}
			}

		}

		pull.can_hit = function(p) {
			if (!p.comp)
				return false
			if (p.comp != e)
				return true
			return (!(moving_faces.has(p.face) || moving_lis.has(p.li)))
		}

		{
		let initial_ps = pull.face.map(pi => get_point(pi, v3()))
		let _v0 = v3()
		let _v1 = v3()
		pull.pull = function(distance) {

			distance = clamp(distance, min_distance, max_distance)
			let delta = pull.line.delta(_v0).set_len(distance)

			let i = 0
			for (let pi of pull.face) {
				let p = initial_ps[i++].to(_v1).add(delta)
				move_point(pi, p)
			}

		}}

		pull.stop = function() {
			if (LOG) log('pull.stop')
			let lis = repair()
			make_overlap_faces(lis)
			// after a pull, two faces with the same outline are both removed:
			// the volumes on both sides are joined, or a hole is made.
			merge_faces(lis, true)
		}

		return pull
	}

	// rendering --------------------------------------------------------------

	let gl = assert(editor.gl)

	let points_dab           = gl.dyn_arr_v3_buffer() // coords for points and lines
	let used_pis_dab         = gl.dyn_arr_u32_index_buffer() // points index buffer
	let vis_edge_lis_dab     = gl.dyn_arr_u32_index_buffer() // black thin lines
	let inv_edge_lis_dab     = gl.dyn_arr_u32_index_buffer() // black dashed lines
	let sel_inv_edge_lis_dab = gl.dyn_arr_u32_index_buffer() // blue dashed lines

	let points_rr             = gl.points_renderer()
	let faces_rr              = gl.faces_renderer()
	let black_thin_lines_rr   = gl.solid_lines_renderer()
	let black_dashed_lines_rr = gl.dashed_lines_renderer({dash: 5, gap: 3})
	let blue_dashed_lines_rr  = gl.dashed_lines_renderer({dash: 5, gap: 3, base_color: 0x0000ff})
	let black_fat_lines_rr    = gl.fat_lines_renderer()
	let blue_fat_lines_rr     = gl.fat_lines_renderer({base_color: 0x0000ff})

	e.free = function() {

		points_dab            .free()
		used_pis_dab          .free()
		vis_edge_lis_dab      .free()
		inv_edge_lis_dab      .free()
		sel_inv_edge_lis_dab  .free()

		points_rr             .free()
		faces_rr              .free()
		black_thin_lines_rr   .free()
		black_dashed_lines_rr .free()
		blue_dashed_lines_rr  .free()
		black_fat_lines_rr    .free()
		blue_fat_lines_rr     .free()

	}

	function update_point(pi, p) {
		points_dab.set(pi, p)
		bbox_changed = true
	}

	e.show_invisible_lines = true

	e.toggle_invisible_lines = function() {
		e.show_invisible_lines = !e.show_invisible_lines
		used_lines_changed = true
	}

	function each_nonedge_line(f) {
		for (let li = 0, n = line_count(); li < n; li++)
			if (lines[5*li+2] == 1) // rc: is standalone.
				f(get_line(li))
	}

	function each_sel_vis_line(f) {
		for (let li of sel_lines)
			if (lines[5*li+4] > 0) // opacity: is visible.
				f(get_line(li))
	}

	let each_bbox_line
	{
	let _m0 = mat4()
	let _v0 = v3()
	each_bbox_line = function(node, f) {
		let bbox = node.comp.bbox()
		let m = _m0.reset()
			.mul(node)
			.translate(bbox[0])
			.scale(bbox.delta(_v0))
			.translate(.5, .5, .5)
		box3.each_line(function(line) {
			f(line.transform(m))
		})
	}}

	function each_blue_fat_line(f) {
		each_sel_vis_line(f)
		for (let node of children)
			if (node.selected)
				each_bbox_line(node, f)
	}

	function blue_fat_line_count() {
		return sel_lines.size + sel_child_count * 12
	}

	function update(models_buf, disabled_buf) {

		let points_changed = points_dab.invalid

		if (points_changed) {
			points_dab.upload_invalid()
			points_rr             .pos = points_dab.buffer
			black_thin_lines_rr   .pos = points_dab.buffer
			black_dashed_lines_rr .pos = points_dab.buffer
			blue_dashed_lines_rr  .pos = points_dab.buffer
		}

		if (used_points_changed) {

			let pn = point_count()
			used_pis_dab.grow(pn, false)

			let i = 0
			let is = used_pis_dab.array
			for (let pi = 0; pi < pn; pi++)
				if (prc[pi]) // is used
					is[i++] = pi

			used_pis_dab.setlen(i).upload()

			points_rr.index = used_pis_dab.buffer

		}

		if (used_lines_changed) {

			let vln = edge_line_count
			let iln = e.show_invisible_lines ? vln : 0

			let vdab  = vis_edge_lis_dab
			let idab  = inv_edge_lis_dab

			vdab.grow(2 * vln, false)
			idab.grow(2 * iln, false)

			let vi = 0
			let ii = 0
			let vs = vdab.array
			let is = idab.array
			for (let i = 0, n = lines.length; i < n; i += 5) {
				if (lines[i+2] >= 2) { // refcount: is edge
					let p1i = lines[i+0]
					let p2i = lines[i+1]
					if (lines[i+4] > 0) { // opacity: is not invisible
						vs[vi++] = p1i
						vs[vi++] = p2i
					} else if (is) {
						is[ii++] = p1i
						is[ii++] = p2i
					}
				}
			}

			vdab.setlen(vi).upload()
			idab.setlen(ii).upload()

			black_thin_lines_rr   .index = vdab.buffer
			black_dashed_lines_rr .index = idab.buffer
		}

		if (e.show_invisible_lines && (used_lines_changed || sel_lines_changed)) {

			let max_ln = e.show_invisible_lines ? sel_lines.size : 0
			let dab = sel_inv_edge_lis_dab
			dab.grow(max_ln * 2, false)
			let i = 0
			let is = dab.array
			if (is) {
				for (let li of sel_lines) {
					if (lines[5*li+4] == 0) { // opacity: is invisible.
						let p1i = lines[5*li+0]
						let p2i = lines[5*li+1]
						is[i++] = p1i
						is[i++] = p2i
					}
				}
			}
			dab.setlen(i).upload()

			blue_dashed_lines_rr.index = dab.buffer
		}

		if (points_changed || faces_changed) {

			for (let mesh of meshes)
				if (!mesh.normals_valid)
					for (let face of mesh)
						for (let i = 0, teis = face.triangles(), n = teis.length; i < n; i++) {
							let pi = face[teis[i]]
							normals[3*pi+0] = 0
							normals[3*pi+1] = 0
							normals[3*pi+2] = 0
						}

				for (let mesh of meshes)
					if (!mesh.normals_valid)
						for (let face of mesh)
							face.compute_smooth_normals(normals)

			faces_rr.update(e.id, mat_faces_map)
		}

		if (points_changed || used_lines_changed)
			black_fat_lines_rr.update(each_nonedge_line, nonedge_line_count)

		if (points_changed || sel_lines_changed)
			blue_fat_lines_rr.update(each_blue_fat_line, blue_fat_line_count())

		points_rr             .model = models_buf
		faces_rr              .model = models_buf
		black_thin_lines_rr   .model = models_buf
		black_dashed_lines_rr .model = models_buf
		blue_dashed_lines_rr  .model = models_buf
		black_fat_lines_rr    .model = models_buf
		blue_fat_lines_rr     .model = models_buf

		points_rr             .disabled = disabled_buf
		faces_rr              .disabled = disabled_buf
		black_thin_lines_rr   .disabled = disabled_buf
		black_dashed_lines_rr .disabled = disabled_buf
		blue_dashed_lines_rr  .disabled = disabled_buf
		black_fat_lines_rr    .disabled = disabled_buf
		blue_fat_lines_rr     .disabled = disabled_buf

		let mouse_invalid = points_changed || faces_changed

		points_changed      = false
		used_points_changed = false
		used_lines_changed  = false
		faces_changed       = false
		sel_lines_changed   = false

		return mouse_invalid
	}

	e.renderers = [
		faces_rr,
		points_rr,
		black_thin_lines_rr,
		black_dashed_lines_rr,
		blue_dashed_lines_rr,
		black_fat_lines_rr,
		blue_fat_lines_rr,
	]
	e.face_renderer = faces_rr
	e.update = update

	return e
}

}()) // module scope.
