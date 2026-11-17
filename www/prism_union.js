/*

	Union of vertical prisms into boundary faces, for house models.
	Written by Cosmin Apreutesei. Public Domain.

	prism_union(prisms) -> faces
		prisms  [{paths: [[{x, y}, ...], ...], bottom: [a, b, c],
		          top: [a, b, c], tag:, is_cutter:}, ...]
		faces   [{rings: [[[x, y, z], ...], ...], tag:}, ...]
	prism_union.grid_scale -> 100

	A prism is the plan region of its paths, filled even-odd, between its
	bottom and top planes z = a*x + b*y + c. The code fuses all the prisms
	into one solid and returns its surface: one face per connected piece of
	each plane and tag. Face rings are the outline first, then the holes.
	Seen from outside, outlines are ccw and holes are cw.

	Paths are clipper Paths64 on the grid: plan coords times grid_scale,
	rounded. Planes and faces are in plan coords. Callers that cut prism
	regions with clipper must use the same grid to get exactly matching
	edges.

	A cutter prism removes the parts of the other prisms above its bottom
	plane, inside its plan region. Cutters don't cut cutters. Where several
	cutters cut the top of a prism, the lowest cutter bottom is its top.

	A face gets the tag of the prism whose surface it is. Prisms of different
	tags can touch but must not overlap: the code adds no faces between them.

	The planes of the prisms over one plan region must not cross in it,
	except where a cutter's bottom crosses the planes of the prisms it cuts,
	and where the planes of two cutters cross. There, the code splits the
	plan on the crossing line rounded to the grid, so the solid gets thin
	step faces along it.

	Before the overlay, the code rounds each crossing of a diagonal edge with
	another edge to the grid once, and puts that point in both edges, so
	diagonal edges can bend by up to half a grid unit. Where the planes of
	two prisms meet on such an edge, their z differs by a fraction of a grid
	unit, so the solid gets thin step faces there.

*/

(function() {
"use strict"
const G = window

const {round, abs, min, max, hypot, inf, assert, map, uniq_sorted,
	profile_time} = glue
const {Clipper64, PolyTree64, ClipType, FillRule, getBoundsPaths} = clipper2

let SCALE = 100 // grid units per plan unit (mm): a grid unit is 10 um

// clipper -------------------------------------------------------------------

// run a clipper op on integer paths filled even-odd. out: an array of paths
// or a PolyTree64. no_collinear: remove collinear points from the output.
function clip(clip_type, subject, clip_paths, out, no_collinear) {
	let clipper = new Clipper64()
	clipper.preserveCollinear = !no_collinear
	clipper.addSubject(subject)
	if (clip_paths)
		clipper.addClip(clip_paths)
	clipper.execute(clip_type, FillRule.EvenOdd, out)
	return out
}

function split_paths(subject, clip_paths, in_paths, out_paths) {
	let clipper = new Clipper64()
	clipper.preserveCollinear = true
	clipper.addSubject(subject)
	clipper.addClip(clip_paths)
	clipper.execute(ClipType.Intersection, FillRule.EvenOdd, in_paths)
	clipper.execute(ClipType.Difference, FillRule.EvenOdd, out_paths)
}

// planes --------------------------------------------------------------------

// z of a plane at plan point (x, y) on the grid, both in grid units.
function grid_z(plane, x, y) {
	let [a, b, c] = plane
	return round((a * x + b * y) + c * SCALE)
}

function gcd(a, b) {
	while (b) {
		let r = a % b
		a = b
		b = r
	}
	return a
}

// faces ---------------------------------------------------------------------

// add the faces of a union's polytree to `faces`, each point lifted to 3D
// with lift_point(p) -> [x, y, z]. is_reversed: reverse each ring to make
// it ccw seen from outside.
function add_tree_faces(node, lift_point, is_reversed, tag, faces) {
	function lift_ring(path) {
		let ring = []
		for (let p of path)
			ring.push(lift_point(p))
		if (is_reversed)
			ring.reverse()
		return ring
	}
	for (let i = 0; i < node.count; i++) {
		let outline = node.child(i)
		let rings = [lift_ring(outline.polygon)]
		for (let j = 0; j < outline.count; j++) {
			let hole = outline.child(j)
			rings.push(lift_ring(hole.polygon))
			add_tree_faces(hole, lift_point, is_reversed, tag, faces) // islands
		}
		faces.push({rings: rings, tag: tag})
	}
}

// snapping --------------------------------------------------------------------

/*
snap rounding (Hobby) of the diagonal edges of all the prisms' paths.
clipper rounds each crossing of a diagonal edge in every op on its own,
so the cells on the two sides of a diagonal edge get different points.
instead, the code rounds every crossing of a diagonal edge with another
edge to the grid once, here. each diagonal edge goes through every
crossing and path point whose unit square it passes through, in the
order it enters them. each straight edge goes through the points of the
diagonal edges that lie on it. after that, edges meet only at shared
points, and clipper finds no new crossings.
*/
function snap_paths(prisms) {
	let edges = [] // [x1, y1, x2, y2, ...] of all paths
	let diagonal_n = 0
	for (let prism of prisms) {
		for (let path of prism.paths) {
			for (let i = 0, n = path.length; i < n; i++) {
				let p = path[i]
				let q = path[(i+1) % n]
				edges.push(p.x, p.y, q.x, q.y)
				if (p.x != q.x && p.y != q.y)
					diagonal_n++
			}
		}
	}
	let prism_paths = [] // [paths, ...] by prism
	if (!diagonal_n) {
		for (let prism of prisms)
			prism_paths.push(prism.paths)
		return prism_paths
	}

	// crossings of diagonal edges with other edges, rounded to the grid.
	let crossings = [] // [x, y, ...]
	for (let i = 0; i < edges.length; i += 4) {
		let x1 = edges[i+0]
		let y1 = edges[i+1]
		let x2 = edges[i+2]
		let y2 = edges[i+3]
		if (x1 == x2 || y1 == y2)
			continue
		for (let j = 0; j < edges.length; j += 4) {
			let x3 = edges[j+0]
			let y3 = edges[j+1]
			let x4 = edges[j+2]
			let y4 = edges[j+3]
			let is_diagonal = x3 != x4 && y3 != y4
			if (is_diagonal && j <= i) // two diagonal edges: once.
				continue
			if (max(x3, x4) < min(x1, x2) || min(x3, x4) > max(x1, x2))
				continue
			if (max(y3, y4) < min(y1, y2) || min(y3, y4) > max(y1, y2))
				continue
			let d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
			if (!d) // parallel
				continue
			let t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d
			let u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d
			if (t < 0 || t > 1 || u < 0 || u > 1)
				continue
			crossings.push(round(x1 + t * (x2 - x1)), round(y1 + t * (y2 - y1)))
		}
	}

	// diagonal edges, each routed from its end with the lower x, so that the
	// two paths sharing an edge get the same points.
	let diagonal_points = map() // {edge index -> [x, y, ...] from lower x}
	let hits = [] // [{t1, t2, x, y}, ...]
	// the edge (x1, y1)-(x2, y2) with x1 < x2 passes through the closed unit
	// square around grid point (cx, cy): add the point with the edge's
	// parameters t1 and t2 in 0..1 at which it enters and leaves the square.
	function add_hit(x1, y1, x2, y2, cx, cy) {
		if (cx < x1 - 1 || cx > x2 + 1)
			return
		if (cy < min(y1, y2) - 1 || cy > max(y1, y2) + 1)
			return
		let dx = x2 - x1
		let dy = y2 - y1
		let tx1 = (cx - .5 - x1) / dx
		let tx2 = (cx + .5 - x1) / dx
		let ty1 = (cy - .5 - y1) / dy
		let ty2 = (cy + .5 - y1) / dy
		let t1 = max(0, tx1, min(ty1, ty2))
		let t2 = min(1, tx2, max(ty1, ty2))
		if (t1 <= t2)
			hits.push({t1: t1, t2: t2, x: cx, y: cy})
	}
	let ys_by_x = map() // {x -> [y, ...]} points of diagonal edges
	let xs_by_y = map() // {y -> [x, ...]} points of diagonal edges
	function add_axis_point(a_by_b, b, a) {
		let a_list = a_by_b.get(b)
		if (!a_list) {
			a_list = []
			a_by_b.set(b, a_list)
		}
		a_list.push(a)
	}
	for (let i = 0; i < edges.length; i += 4) {
		let x1 = edges[i+0]
		let y1 = edges[i+1]
		let x2 = edges[i+2]
		let y2 = edges[i+3]
		if (x1 == x2 || y1 == y2)
			continue
		let xa = min(x1, x2)
		let ya = x1 < x2 ? y1 : y2
		let xb = max(x1, x2)
		let yb = x1 < x2 ? y2 : y1
		hits.length = 0
		for (let j = 0; j < edges.length; j += 4) // path points
			add_hit(xa, ya, xb, yb, edges[j], edges[j+1])
		for (let j = 0; j < crossings.length; j += 2)
			add_hit(xa, ya, xb, yb, crossings[j], crossings[j+1])
		// a square only touched at a corner is left where the next one is
		// entered: sort it before that one.
		hits.sort((h1, h2) => h1.t1 - h2.t1 || h1.t2 - h2.t2
			|| h1.x - h2.x || h1.y - h2.y)
		let points = []
		for (let hit of hits) {
			let n = points.length
			if (n && points[n-2] == hit.x && points[n-1] == hit.y)
				continue
			points.push(hit.x, hit.y)
			add_axis_point(ys_by_x, hit.x, hit.y)
			add_axis_point(xs_by_y, hit.y, hit.x)
		}
		diagonal_points.set(i, points)
	}

	// new paths: each edge's points from its start, without its end.
	let ts = []
	let i = 0
	for (let prism of prisms) {
		let paths = []
		for (let path of prism.paths) {
			let path1 = []
			for (let k = 0; k < path.length; k++, i += 4) {
				let x1 = edges[i+0]
				let y1 = edges[i+1]
				let x2 = edges[i+2]
				let y2 = edges[i+3]
				let points = diagonal_points.get(i)
				if (points) {
					let n = points.length
					if (x1 < x2) {
						for (let j = 0; j < n-2; j += 2)
							path1.push({x: points[j], y: points[j+1]})
					} else {
						for (let j = n-2; j > 0; j -= 2)
							path1.push({x: points[j], y: points[j+1]})
					}
					continue
				}
				// straight edge: points of diagonal edges between its ends.
				path1.push(path[k])
				let is_vertical = x1 == x2
				let t1 = is_vertical ? y1 : x1
				let t2 = is_vertical ? y2 : x2
				let line_ts = is_vertical ? ys_by_x.get(x1) : xs_by_y.get(y1)
				if (!line_ts)
					continue
				ts.length = 0
				for (let t of line_ts)
					if (t > min(t1, t2) && t < max(t1, t2))
						ts.push(t)
				ts.sort((ta, tb) => t2 > t1 ? ta - tb : tb - ta)
				uniq_sorted(ts)
				for (let t of ts)
					path1.push(is_vertical ? {x: x1, y: t} : {x: t, y: y1})
			}
			paths.push(path1)
		}
		prism_paths.push(paths)
	}
	return prism_paths
}

// cuts ------------------------------------------------------------------------

// grid paths of the part of the box (x1, y1)-(x2, y2) where
// a*x + b*y + c < 0, all in grid units.
function half_plane_paths(a, b, c, x1, y1, x2, y2) {
	let corners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
	let path = []
	for (let i = 0; i < 4; i++) {
		let [px, py] = corners[i]
		let [qx, qy] = corners[(i+1) % 4]
		let fp = a * px + b * py + c
		let fq = a * qx + b * qy + c
		if (fp < 0)
			path.push({x: px, y: py})
		if ((fp < 0) != (fq < 0)) {
			let t = fp / (fp - fq)
			path.push({x: round(px + t * (qx - px)), y: round(py + t * (qy - py))})
		}
	}
	return [path]
}

// union -----------------------------------------------------------------------

function prism_union(prisms) {

	let t0 = profile_time()
	let start_t = t0

	// cuts: where a cutter's bottom crosses the bottom or the top plane of
	// another prism inside the cutter's region, the code adds a cut region:
	// the cut side of the crossing line, inside the cutter's bbox. the code
	// moves the line one grid unit away from the cut side before rounding,
	// so where it keeps the other prism's plane, that plane is below the
	// cutter's bottom at every grid point.
	let cut_regions = [] // [{cutter, paths}, ...]
	let cuts = map() // {cutter -> {prism -> [bottom_cut, top_cut]}}
		// cut: true: everywhere, false: nowhere, cut region: inside it.
	let cutter_bboxes = [] // [{cutter, x1, y1, x2, y2}, ...] with the margin
	for (let cutter of prisms) {
		if (!cutter.is_cutter)
			continue
		let x1 =  inf
		let y1 =  inf
		let x2 = -inf
		let y2 = -inf
		for (let path of cutter.paths) {
			for (let p of path) {
				x1 = min(x1, p.x)
				y1 = min(y1, p.y)
				x2 = max(x2, p.x)
				y2 = max(y2, p.y)
			}
		}
		// snapping moves the cutter's points by less than a grid unit.
		x1 -= 2
		y1 -= 2
		x2 += 2
		y2 += 2
		cutter_bboxes.push({cutter: cutter, x1: x1, y1: y1, x2: x2, y2: y2})
		let prism_cuts = map()
		cuts.set(cutter, prism_cuts)
		for (let prism of prisms) {
			if (prism.is_cutter)
				continue
			let plane_cuts = []
			for (let plane of [prism.bottom, prism.top]) {
				// f: the cutter's bottom minus the plane, in grid units.
				let a = cutter.bottom[0] - plane[0]
				let b = cutter.bottom[1] - plane[1]
				let c = (cutter.bottom[2] - plane[2]) * SCALE
				let f_min =  inf
				let f_max = -inf
				for (let path of cutter.paths) {
					for (let p of path) {
						let f = a * p.x + b * p.y + c
						f_min = min(f_min, f)
						f_max = max(f_max, f)
					}
				}
				let shift = hypot(a, b) // f per grid unit across the line
				if (f_max < 0) {
					plane_cuts.push(true)
				} else if (f_min >= shift) {
					plane_cuts.push(false)
				} else {
					let cut_region = {
						cutter: cutter,
						paths: half_plane_paths(a, b, c - shift, x1, y1, x2, y2),
					}
					cut_regions.push(cut_region)
					plane_cuts.push(cut_region)
				}
			}
			prism_cuts.set(prism, plane_cuts)
		}
	}
	function is_cut(cell, cut) {
		return cut === true || cut !== false && cell.cut_regions.includes(cut)
	}

	// splits: where a plane of a cutter crosses a plane of another cutter
	// inside both bboxes and the two cutters overlap, the code adds a split
	// region: one side of the crossing line, inside both bboxes. on the
	// rounded line, the two planes can be out of order by the plane z of
	// one grid unit across the line.
	let split_regions = [] // [{cutter1, cutter2, plane1, plane2, dz, paths},
		// ...] dz: the most z by which the planes can be out of order.
	for (let i = 0; i < cutter_bboxes.length; i++) {
		let bbox1 = cutter_bboxes[i]
		let cutter1 = bbox1.cutter
		for (let j = i+1; j < cutter_bboxes.length; j++) {
			let bbox2 = cutter_bboxes[j]
			let cutter2 = bbox2.cutter
			let x1 = max(bbox1.x1, bbox2.x1)
			let y1 = max(bbox1.y1, bbox2.y1)
			let x2 = min(bbox1.x2, bbox2.x2)
			let y2 = min(bbox1.y2, bbox2.y2)
			if (x1 >= x2 || y1 >= y2)
				continue
			// cutters that only touch: no splits.
			if (!clip(ClipType.Intersection, cutter1.paths, cutter2.paths, [])
				.length)
				continue
			for (let plane1 of [cutter1.bottom, cutter1.top]) {
				for (let plane2 of [cutter2.bottom, cutter2.top]) {
					// f: plane1 minus plane2, in grid units: linear, so its
					// extremes in the box are at the corners.
					let a = plane1[0] - plane2[0]
					let b = plane1[1] - plane2[1]
					let c = (plane1[2] - plane2[2]) * SCALE
					let f_min =  inf
					let f_max = -inf
					for (let [x, y] of [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) {
						let f = a * x + b * y + c
						f_min = min(f_min, f)
						f_max = max(f_max, f)
					}
					if (f_min >= 0 || f_max <= 0)
						continue
					split_regions.push({
						cutter1: cutter1,
						cutter2: cutter2,
						plane1: plane1,
						plane2: plane2,
						dz: hypot(a, b) + 1, // +1: grid_z() rounding.
						paths: half_plane_paths(a, b, c, x1, y1, x2, y2),
					})
				}
			}
		}
	}
	// the most z by which plane1 can be above plane2 in the cell.
	function out_of_order_dz(cell, plane1, plane2) {
		for (let split_region of cell.split_regions) {
			let p1 = split_region.plane1
			let p2 = split_region.plane2
			if (p1 == plane1 && p2 == plane2 || p1 == plane2 && p2 == plane1)
				return split_region.dz
		}
		return 0
	}

	// cells: the code cuts the plan into cells, each covered by the same
	// prisms everywhere, by overlaying the prisms one by one. the overlay
	// keeps collinear points: the snapped points on straight edges. without
	// them, a later op would round the crossing again, maybe elsewhere.
	// the code snaps the cut regions with the prisms and overlays each one
	// only on the cells of its cutter. same for the split regions, on the
	// cells of both their cutters.
	t0 = profile_time('prism.cuts', t0)

	let snapped_paths = snap_paths([...prisms, ...cut_regions,
		...split_regions])
	let prism_paths = snapped_paths.slice(0, prisms.length)
	for (let i = 0; i < cut_regions.length; i++)
		cut_regions[i].paths = snapped_paths[prisms.length + i]
	for (let i = 0; i < split_regions.length; i++)
		split_regions[i].paths =
			snapped_paths[prisms.length + cut_regions.length + i]
	t0 = profile_time('prism.snap', t0)

	let cells = [] // [{paths, bounds, prisms, cut_regions, split_regions, ranges},
		// ...]
	for (let prism_i = 0; prism_i < prisms.length; prism_i++) {
		let prism = prisms[prism_i]
		let paths = prism_paths[prism_i]
		let bounds = getBoundsPaths(paths)
		// the part of the prism outside all cells. clipper output is clean:
		// ccw outlines, cw holes. no cells: no clipping below, so clean the
		// input paths here.
		let rest = cells.length ? paths : clip(ClipType.Union, paths, null, [])
		let cells1 = []
		for (let cell of cells) {
			let cb = cell.bounds ??= getBoundsPaths(cell.paths)
			if (cb.right < bounds.left || cb.left > bounds.right
				|| cb.bottom < bounds.top || cb.top > bounds.bottom
			) {
				cells1.push(cell)
				continue
			}
			let in_paths = [], out_paths = []
			split_paths(cell.paths, paths, in_paths, out_paths)
			if (in_paths.length)
				cells1.push({paths: in_paths, prisms: [...cell.prisms, prism],
					cut_regions: [], split_regions: []})
			if (out_paths.length)
				cells1.push({paths: out_paths, prisms: cell.prisms,
					cut_regions: [], split_regions: []})
			if (rest.length)
				rest = clip(ClipType.Difference, rest, cell.paths, [])
		}
		if (rest.length)
			cells1.push({paths: rest, prisms: [prism], cut_regions: [],
				split_regions: []})
		cells = cells1
	}
	for (let cut_region of cut_regions) {
		let cells1 = []
		for (let cell of cells) {
			if (!cell.prisms.includes(cut_region.cutter)) {
				cells1.push(cell)
				continue
			}
			let paths = cut_region.paths
			let in_paths = [], out_paths = []
			split_paths(cell.paths, paths, in_paths, out_paths)
			if (in_paths.length)
				cells1.push({paths: in_paths, prisms: cell.prisms,
					cut_regions: [...cell.cut_regions, cut_region],
					split_regions: []})
			if (out_paths.length)
				cells1.push({paths: out_paths, prisms: cell.prisms,
					cut_regions: cell.cut_regions, split_regions: []})
		}
		cells = cells1
	}
	for (let split_region of split_regions) {
		let cells1 = []
		for (let cell of cells) {
			if (!cell.prisms.includes(split_region.cutter1)
				|| !cell.prisms.includes(split_region.cutter2)
			) {
				cells1.push(cell)
				continue
			}
			let paths = split_region.paths
			let in_paths = [], out_paths = []
			split_paths(cell.paths, paths, in_paths, out_paths)
			let split_regions1 = [...cell.split_regions, split_region]
			if (in_paths.length)
				cells1.push({paths: in_paths, prisms: cell.prisms,
					cut_regions: cell.cut_regions, split_regions: split_regions1})
			if (out_paths.length)
				cells1.push({paths: out_paths, prisms: cell.prisms,
					cut_regions: cell.cut_regions, split_regions: split_regions1})
		}
		cells = cells1
	}

	t0 = profile_time('prism.cells', t0)

	// faces on planes: the code merges the z ranges of each cell's prisms,
	// cut by the cell's cutters, into solid ranges per tag and adds an up face
	// at the top of each range and a down face at its bottom. no two planes
	// cross in the cell, so their order at the average of the cell's points
	// is their order everywhere in the cell, up to the rounding of the
	// cell's split lines.
	let plane_groups = map() // {'normal tag a b c' ->
		// {plane, normal, tag, paths}}
	function add_plane_paths(plane, normal, tag, paths) {
		let key = normal+' '+tag+' '+plane.join(' ')
		let group = plane_groups.get(key)
		if (!group) {
			group = {plane: plane, normal: normal, tag: tag, paths: []}
			plane_groups.set(key, group)
		}
		for (let path of paths)
			group.paths.push(path)
	}
	for (let cell of cells) {
		let sx = 0
		let sy = 0
		let n = 0
		for (let path of cell.paths) {
			for (let p of path) {
				sx += p.x
				sy += p.y
				n++
			}
		}
		let cx = sx / n
		let cy = sy / n

		let cutters = []
		for (let prism of cell.prisms)
			if (prism.is_cutter)
				cutters.push(prism)
		let ranges = [] // [{bottom, top, tag, z1, z2}, ...] by z1
		for (let prism of cell.prisms) {
			let top = prism.top
			let is_removed = false
			let is_top_cut = false
			if (!prism.is_cutter) {
				for (let cutter of cutters) {
					let [bottom_cut, top_cut] = cuts.get(cutter).get(prism)
					if (is_cut(cell, bottom_cut)) {
						is_removed = true
						break
					}
					if (!is_cut(cell, top_cut))
						continue
					// cut by several cutters: the lowest bottom. bottoms that
					// cross split the cell.
					if (is_top_cut
						&& grid_z(cutter.bottom, cx, cy) >= grid_z(top, cx, cy))
						continue
					is_top_cut = true
					top = cutter.bottom
				}
			}
			if (is_removed)
				continue
			ranges.push({
				bottom: prism.bottom,
				top: top,
				tag: prism.tag,
				z1: grid_z(prism.bottom, cx, cy),
				z2: grid_z(top, cx, cy),
			})
		}

		// planes cross in the cell: they are out of order at some point, by
		// more than the rounding of the cell's split lines.
		let planes = []
		for (let range of ranges)
			planes.push(range.bottom, range.top)
		planes.sort((plane1, plane2) =>
			grid_z(plane1, cx, cy) - grid_z(plane2, cx, cy))
		for (let path of cell.paths) {
			for (let p of path) {
				for (let i = 1; i < planes.length; i++) {
					let plane1 = planes[i-1]
					let plane2 = planes[i]
					let dz = grid_z(plane1, p.x, p.y) - grid_z(plane2, p.x, p.y)
					if (dz <= 0)
						continue
					assert(dz <= out_of_order_dz(cell, plane1, plane2),
						'prism planes cross')
				}
			}
		}

		ranges.sort((range1, range2) => range1.z1 - range2.z1)
		cell.ranges = [] // solid ranges: [{bottom, top, tag, z1, z2,
			// has_up_face, has_down_face}, ...]
		let solid_range
		for (let range of ranges) {
			let is_touching = false
			if (solid_range && range.z1 <= solid_range.z2) { // overlap or touch
				if (range.tag == solid_range.tag) {
					if (range.z2 > solid_range.z2) {
						solid_range.top = range.top
						solid_range.z2 = range.z2
					}
					continue
				}
				// different tags touch: no faces between them.
				assert(range.z1 == solid_range.z2,
					'prisms of different tags overlap')
				solid_range.has_up_face = false
				is_touching = true
			}
			solid_range = {...range, has_up_face: true,
				has_down_face: !is_touching}
			cell.ranges.push(solid_range)
		}
		for (let range of cell.ranges) {
			if (range.has_up_face)
				add_plane_paths(range.top   ,  1, range.tag, cell.paths)
			if (range.has_down_face)
				add_plane_paths(range.bottom, -1, range.tag, cell.paths)
		}
	}

	t0 = profile_time('prism.surfaces', t0)

	// side faces: the code groups the edges of all cells by plan line. each
	// cell is on the left of its edges, so on the left of the line where an
	// edge runs along the line's direction, else on the right. along each
	// line, between consecutive edge ends, the code compares the solid
	// ranges on the two sides and adds a vertical face where one side is
	// solid and the other is not, facing the empty side.
	let lines = map() // {'dx dy offset' -> line}
	for (let cell of cells) {
		for (let path of cell.paths) {
			for (let i = 0, n = path.length; i < n; i++) {
				let p = path[i]
				let q = path[(i+1) % n]
				let dx = q.x - p.x
				let dy = q.y - p.y
				let g = gcd(abs(dx), abs(dy))
				// line direction: (dx, dy) with its larger component positive,
				// so that the position along the line is x or y.
				let is_x_major = abs(dx) >= abs(dy)
				let sign = (is_x_major ? dx : dy) > 0 ? 1 : -1
				dx = dx / g * sign
				dy = dy / g * sign
				let offset = dx * p.y - dy * p.x
				let key = dx+' '+dy+' '+offset
				let line = lines.get(key)
				if (!line) {
					line = {
						dx: dx,
						dy: dy,
						offset: offset,
						is_x_major: is_x_major,
						edges: [], // [t1, t2, is_left, cell, ...]
					}
					lines.set(key, line)
				}
				let t1 = is_x_major ? p.x : p.y
				let t2 = is_x_major ? q.x : q.y
				line.edges.push(min(t1, t2), max(t1, t2), sign > 0, cell)
			}
		}
	}

	let line_groups = map() // {'line_key normal tag' ->
		// {line, normal, tag, paths}}
	function add_line_path(line_key, line, normal, tag, path, bottom, top) {
		let key = line_key+' '+normal+' '+tag
		let group = line_groups.get(key)
		if (!group) {
			group = {line: line, normal: normal, tag: tag, paths: []}
			line_groups.set(key, group)
		}
		for (let path0 of group.paths) {
			if (path0[1].x != path[0].x || path0[1].y != path[0].y
				|| path0[2].y != path[3].y)
				continue
			let bottom0 = path0.bottom
			let top0 = path0.top
			if (bottom0[0] != bottom[0] || bottom0[1] != bottom[1]
				|| bottom0[2] != bottom[2])
				continue
			if (top0[0] != top[0] || top0[1] != top[1] || top0[2] != top[2])
				continue
			path0[1] = path[1]
			path0[2] = path[2]
			return
		}
		path.bottom = bottom
		path.top = top
		group.paths.push(path)
	}

	// plan point on the line at position t, in grid units.
	function line_x(line, t) {
		return line.is_x_major ? t : (line.dx * t - line.offset) / line.dy
	}
	function line_y(line, t) {
		return line.is_x_major ? (line.offset + line.dy * t) / line.dx : t
	}

	let bounds = [] // [{plane, za, zb, left_change, right_change, tag}, ...]
	let split_ts = [] // piece ends and the points between where bounds cross
	function add_range_bounds(ranges, xa, ya, xb, yb, is_left) {
		for (let range of ranges) {
			for (let [plane, change] of [[range.bottom, 1], [range.top, -1]]) {
				bounds.push({
					plane: plane,
					za: grid_z(plane, xa, ya),
					zb: grid_z(plane, xb, yb),
					left_change : is_left ? change : 0,
					right_change: is_left ? 0 : change,
					tag: range.tag,
				})
			}
		}
	}

	for (let [line_key, line] of lines) {
		let edges = line.edges
		let ts = [] // edge ends along the line
		for (let i = 0; i < edges.length; i += 4)
			ts.push(edges[i], edges[i+1])
		ts.sort((t1, t2) => t1 - t2)
		uniq_sorted(ts)
		let k_by_t = map() // {t -> index in ts}
		for (let k = 0; k < ts.length; k++)
			k_by_t.set(ts[k], k)

		// the cells on the left and on the right of each piece (ts[k], ts[k+1]).
		let left_cells = []
		let right_cells = []
		for (let i = 0; i < edges.length; i += 4) {
			let t2      = edges[i+1]
			let is_left = edges[i+2]
			let cell    = edges[i+3]
			let side_cells = is_left ? left_cells : right_cells
			for (let k = k_by_t.get(edges[i]); ts[k] < t2; k++)
				side_cells[k] = cell
		}

		for (let k = 0; k < ts.length-1; k++) {
			let left_cell  = left_cells[k]
			let right_cell = right_cells[k]
			if (!left_cell && !right_cell)
				continue
			let ta = ts[k]
			let tb = ts[k+1]
			let xa = line_x(line, ta)
			let ya = line_y(line, ta)
			let xb = line_x(line, tb)
			let yb = line_y(line, tb)
			bounds.length = 0
			if (left_cell)
				add_range_bounds(left_cell.ranges, xa, ya, xb, yb, true)
			if (right_cell)
				add_range_bounds(right_cell.ranges, xa, ya, xb, yb, false)
			bounds.sort((b1, b2) => (b1.za + b1.zb) - (b2.za + b2.zb))

			// planes of the two sides cross along the piece: their bounds are
			// out of order at one end. the code splits the piece where any two
			// bounds cross.
			let is_sorted = true
			for (let i = 1; i < bounds.length; i++)
				if (bounds[i-1].za > bounds[i].za || bounds[i-1].zb > bounds[i].zb)
					is_sorted = false
			split_ts.length = 0
			split_ts.push(ta)
			if (!is_sorted) {
				for (let i = 0; i < bounds.length; i++) {
					for (let j = i+1; j < bounds.length; j++) {
						let da = bounds[i].za - bounds[j].za
						let db = bounds[i].zb - bounds[j].zb
						if (!(da < 0 && db > 0 || da > 0 && db < 0))
							continue
						let t = round(ta + (tb - ta) * da / (da - db))
						if (t > ta && t < tb)
							split_ts.push(t)
					}
				}
				split_ts.sort((t1, t2) => t1 - t2)
			}
			split_ts.push(tb)
			uniq_sorted(split_ts)

			for (let split_i = 1; split_i < split_ts.length; split_i++) {
				let t0 = split_ts[split_i-1]
				let t1 = split_ts[split_i]
				// bound z at t0 and t1, on the line between its ends.
				for (let b of bounds) {
					b.z0 = round(b.za + (b.zb - b.za) * (t0 - ta) / (tb - ta))
					b.z1 = round(b.za + (b.zb - b.za) * (t1 - ta) / (tb - ta))
				}
				if (!is_sorted) {
					let tm = (t0 + t1) / 2
					for (let b of bounds)
						b.zm = b.za + (b.zb - b.za) * (tm - ta) / (tb - ta)
					bounds.sort((b1, b2) => b1.zm - b2.zm)
					// rounding a split point can put two bounds that cross there
					// out of order by a grid unit: give them the same z.
					for (let i = 1; i < bounds.length; i++) {
						bounds[i].z0 = max(bounds[i].z0, bounds[i-1].z0)
						bounds[i].z1 = max(bounds[i].z1, bounds[i-1].z1)
					}
				}
				let left_n = 0
				let right_n = 0
				let left_tag // tag of the last range started on each side
				let right_tag
				for (let i = 0; i < bounds.length-1; i++) {
					let b1 = bounds[i]
					let b2 = bounds[i+1]
					left_n  += b1.left_change
					right_n += b1.right_change
					if (b1.left_change > 0)
						left_tag = b1.tag
					if (b1.right_change > 0)
						right_tag = b1.tag
					if ((left_n > 0) == (right_n > 0))
						continue
					if (b1.z0 == b2.z0 && b1.z1 == b2.z1)
						continue
					// ccw in (t, z).
					let path = [
						{x: t0, y: b1.z0},
						{x: t1, y: b1.z1},
						{x: t1, y: b2.z1},
						{x: t0, y: b2.z0},
					]
					if (left_n > 0)
						add_line_path(line_key, line, 1, left_tag, path,
							b1.plane, b2.plane)
					else
						add_line_path(line_key, line, -1, right_tag, path,
							b1.plane, b2.plane)
				}
			}
		}
	}

	t0 = profile_time('prism.sides', t0)

	// merging: the code unites the faces of each plane and facing into
	// polygons and lifts them back to 3D.
	let faces = []
	for (let {plane, normal, tag, paths} of plane_groups.values()) {
		let [a, b, c] = plane
		let tree = clip(ClipType.Union, paths, null, new PolyTree64(), true)
		// paths are ccw in plan (x, y): seen from above.
		add_tree_faces(tree, function(p) {
			let x = p.x / SCALE
			let y = p.y / SCALE
			return [x, y, a * x + b * y + c]
		}, normal < 0, tag, faces)
	}
	for (let {line, normal, tag, paths} of line_groups.values()) {
		let tree = clip(ClipType.Union, paths, null, new PolyTree64(), true)
		// paths are ccw in (t, z): seen from the right of the line's
		// direction (normal = 1), where the left side is solid.
		add_tree_faces(tree, function(p) {
			let x = line_x(line, p.x) / SCALE
			let y = line_y(line, p.x) / SCALE
			return [x, y, p.y / SCALE]
		}, normal < 0, tag, faces)
	}
	profile_time('prism.merge', t0)
	profile_time('prism.union', start_t)
	return faces
}

prism_union.grid_scale = SCALE

G.prism_union = prism_union

}()) // module scope.
