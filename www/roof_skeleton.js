/*

	Weighted straight skeleton of axis-aligned polygons, for roofs.
	Written by Cosmin Apreutesei. Public Domain.

	roof_skeleton(rings, pitches, eave_zs) -> faces
		rings    [[[x, y], ...], ...]  outer ring (area > 0), holes (area < 0)
		pitches  [deg, ...]            per edge, edges of all rings in order
		eave_zs  [z, ...]              per edge: the height of its eave
		faces    [{edge_is: [i, ...], rings: [[[x, y, z], ...], ...],
		           plane: [a, b, c]}, ...]

	Edges with pitch 90 are vertical (gable ends, edges against a wall) and
	get no face. A sloped edge with its eave above the lowest eave stays
	vertical up to its eave, then slopes. Edges in the same plane share one
	face. Of collinear neighbor edges, only the shallowest gets a face.
	Regions closed in by vertical edges get no face. Face rings are ccw
	outlines (area > 0) and cw holes (area < 0). A face's plane is
	z = a*x + b*y + c.

*/

(function() {
"use strict"
const G = window

const {inf, abs, min, max, tan, rad, atan2, assert} = glue

let NEAR = 1e-5 // distance and time tolerance

// The code moves every edge inward at its own speed, time being the height
// above the lowest eave. All moving edges stay axis-aligned and every corner
// joins two perpendicular edges. The outline changes at three kinds of
// events:
//  - two parallel edges facing each other meet: the overlap becomes a ridge
//    and the rest of the edges reconnect.
//  - the edge between two parallel edges facing the same way shrinks to
//    zero: the edges become collinear and the faster one (lower roof)
//    continues over both.
//  - an edge with a higher eave reaches its eave and starts moving.
// Each moving edge is a piece of a plane. Each corner traces an arc between
// the faces of its two pieces; the code adds the arcs and ridges to the faces
// as half-edges with the face on their left, and walks them into rings.
// The code handles all events at one height together: it rebuilds the
// outline from the positions of the pieces at that height, so the order of
// the events does not change the result.

// planes and pieces ---------------------------------------------------------

function line_at(plane, t) {
	return plane.c + plane.n * plane.s * (t - plane.t0)
}

// direction of the piece's edge along its axis: +1 or -1.
function piece_dir(piece) {
	let plane = piece.plane
	return plane.is_v ? -plane.n : plane.n
}

function piece_tail_m(piece, t) { return line_at(piece.prev.plane, t) }
function piece_head_m(piece, t) { return line_at(piece.next.plane, t) }

// the next piece turns right at the head: the head corner is reflex.
function head_is_reflex(piece) {
	return piece.next.plane.n == piece_dir(piece)
}

// the previous piece turns right at the tail: the tail corner is reflex.
function tail_is_reflex(piece) {
	return piece.prev.plane.n == -piece_dir(piece)
}

function roof_skeleton(rings, pitches, eave_zs) {

	let planes = [] // [{is_v, c, n, s, t0, edge_is, half_edges}, ...]
		// t0: the time the plane starts moving.
	let pieces = [] // [{plane, start_plane, prev, next, n1}, ...]
		// start_plane: the sloped plane that replaces the vertical one at
		// its t0.
	let nodes_now = [] // [{x, y, t}, ...] created at the current time

	// nodes ---------------------------------------------------------------

	function node_at(x, y, t) {
		for (let node of nodes_now)
			if (abs(node.x - x) <= NEAR && abs(node.y - y) <= NEAR)
				return node
		let node = {x: x, y: y, t: t}
		nodes_now.push(node)
		return node
	}

	// node at the corner between `piece` and its next piece.
	function head_node(piece, t) {
		let m = piece_head_m(piece, t)
		let c = line_at(piece.plane, t)
		return piece.plane.is_v ? node_at(c, m, t) : node_at(m, c, t)
	}

	// node at the corner between `piece` and its previous piece.
	function tail_node(piece, t) {
		let m = piece_tail_m(piece, t)
		let c = line_at(piece.plane, t)
		return piece.plane.is_v ? node_at(c, m, t) : node_at(m, c, t)
	}

	// half-edges ----------------------------------------------------------

	// end the arc of the corner between p and q at `node`.
	function end_arc(p, q, node) {
		let node0 = q.n1
		if (node0 == node)
			return
		p.plane.half_edges.push(node0, node)
		q.plane.half_edges.push(node, node0)
	}

	// events --------------------------------------------------------------

	let ev_t // time of the next event

	function find_start(e) {
		let plane = e.start_plane
		if (!plane || plane.t0 >= ev_t)
			return
		ev_t = plane.t0
	}

	function find_collapse(e, t0) {
		let p = e.prev.plane
		let q = e.next.plane
		if (p.n != q.n) // facing each other: a collision.
			return
		let d = piece_dir(e)
		let len = (line_at(q, t0) - line_at(p, t0)) * d
		let rate = (q.s - p.s) * q.n * d
		if (len < -NEAR || rate >= 0)
			return
		let t = t0 + max(len, 0) / -rate
		if (t >= ev_t)
			return
		ev_t = t
	}

	function find_collision(a, c, t0) {
		let pa = a.plane
		let pc = c.plane
		if (pa.is_v != pc.is_v || pa.n != -pc.n)
			return
		let speed = pa.s + pc.s
		if (!speed)
			return
		let gap = (line_at(pc, t0) - line_at(pa, t0)) * pa.n
		if (gap < -NEAR)
			return
		let t = t0 + max(gap, 0) / speed
		if (t >= ev_t)
			return
		// overlap along the edges' axis at time t.
		let a_m1 = piece_tail_m(a, t)
		let a_m2 = piece_head_m(a, t)
		let c_m1 = piece_tail_m(c, t)
		let c_m2 = piece_head_m(c, t)
		let overlap = min(max(a_m1, a_m2), max(c_m1, c_m2))
			- max(min(a_m1, a_m2), min(c_m1, c_m2))
		if (overlap < -NEAR)
			return
		let is_point = abs(a_m2 - a_m1) <= NEAR && abs(c_m2 - c_m1) <= NEAR
		if (overlap <= NEAR && !is_point) {
			// touching ends: an event only between two reflex corners.
			// after the event the same ends touch at convex corners.
			let touch_heads = abs(a_m2 - c_m2) <= NEAR
			let is_event = touch_heads
				? head_is_reflex(a) && head_is_reflex(c)
				: tail_is_reflex(a) && tail_is_reflex(c)
			if (!is_event)
				return
		}
		ev_t = t
	}

	// rebuild -------------------------------------------------------------

	// all events at time t. the code cuts the pieces at their corners on each
	// line into spans, removes the spans where pieces facing each other
	// overlap, links the spans left into rings, and makes one piece per run
	// of collinear spans: the fastest plane of the run gets the run. a plane
	// gets a half-edge where it stops or starts owning a span, and corners
	// that are gone end their arcs.
	function rebuild(t) {

		// pieces at time t, grouped by line.
		let segs = [] // [{piece, is_v, c, d, n1, n2}, ...]
		let corners = [] // [{p, q, node, is_kept}, ...]
		for (let piece of pieces) {
			let n1 = tail_node(piece, t)
			let n2 = head_node(piece, t)
			corners.push({p: piece, q: piece.next, node: n2, is_kept: false})
			if (n1 == n2) // zero length.
				continue
			let is_v = piece.plane.is_v
			segs.push({piece: piece, is_v: is_v, c: is_v ? n1.x : n1.y,
				d: piece_dir(piece), n1: n1, n2: n2})
		}
		segs.sort((a, b) => a.is_v - b.is_v || a.c - b.c)
		let lines = [] // [{is_v, segs, nodes, olds, spans}, ...]
		let line
		for (let i = 0; i < segs.length; i++) {
			let seg = segs[i]
			let seg0 = segs[i-1]
			if (!seg0 || seg0.is_v != seg.is_v || seg.c - seg0.c > NEAR) {
				line = {is_v: seg.is_v, segs: []}
				lines.push(line)
			}
			line.segs.push(seg)
		}

		// spans between consecutive corners on each line; pieces facing each
		// other cancel where they overlap.
		let spans = [] // [{is_v, d, n1, n2, plane, start_plane, prev, next,
			// owner}, ...]
		for (let line of lines) {
			let is_v = line.is_v
			let node_set = new Set()
			for (let seg of line.segs) {
				node_set.add(seg.n1)
				node_set.add(seg.n2)
			}
			let nodes = [...node_set]
			nodes.sort(is_v ? (a, b) => a.y - b.y : (a, b) => a.x - b.x)
			let node_i = new Map()
			for (let i = 0; i < nodes.length; i++)
				node_i.set(nodes[i], i)
			let span_n = nodes.length - 1
			// olds[d][k]: the piece facing d along the line over span k.
			let olds = {'1': [], '-1': []}
			for (let seg of line.segs) {
				let i1 = node_i.get(seg.n1)
				let i2 = node_i.get(seg.n2)
				let a = olds[seg.d]
				for (let k = min(i1, i2); k < max(i1, i2); k++) {
					assert(!a[k], 'pieces overlap')
					a[k] = seg.piece
				}
			}
			let news = {'1': [], '-1': []}
			for (let k = 0; k < span_n; k++) {
				let p1 = olds[1][k]
				let p2 = olds[-1][k]
				if (p1 && p2 || !p1 && !p2)
					continue
				let piece = p1 ?? p2
				let d = p1 ? 1 : -1
				let is_start = piece.start_plane
					&& piece.start_plane.t0 <= t + NEAR
				let span = {
					is_v: is_v, d: d,
					n1: d > 0 ? nodes[k] : nodes[k+1],
					n2: d > 0 ? nodes[k+1] : nodes[k],
					plane: is_start ? piece.start_plane : piece.plane,
					start_plane: is_start ? null : piece.start_plane,
					prev: null, next: null, owner: null,
				}
				spans.push(span)
				news[d][k] = span
			}
			line.nodes = nodes
			line.olds = olds
			line.news = news
		}

		// link the spans: where rings touch at a node, take the leftmost turn
		// to keep them separate.
		let outs_by_node = new Map() // {node -> [span, ...]}
		for (let span of spans) {
			let a = outs_by_node.get(span.n1)
			if (!a) {
				a = []
				outs_by_node.set(span.n1, a)
			}
			a.push(span)
		}
		for (let span of spans) {
			let dx = span.is_v ? 0 : span.d
			let dy = span.is_v ? span.d : 0
			let next_span
			let max_turn = -inf
			for (let span1 of outs_by_node.get(span.n2)) {
				let dx1 = span1.is_v ? 0 : span1.d
				let dy1 = span1.is_v ? span1.d : 0
				let turn = atan2(dx * dy1 - dy * dx1, dx * dx1 + dy * dy1)
				if (turn <= max_turn)
					continue
				max_turn = turn
				next_span = span1
			}
			assert(next_span && !next_span.prev, 'spans do not link')
			span.next = next_span
			next_span.prev = span
		}

		// one piece per run of collinear spans.
		let new_pieces = []
		for (let span0 of spans) {
			if (span0.owner)
				continue
			// start the ring at a corner.
			let first_span = span0
			while (first_span.prev.is_v == first_span.is_v)
				first_span = first_span.prev
			let first_piece, prev_piece
			let span = first_span
			do {
				let run_span = span
				let last_span = span
				while (last_span.next.is_v == span.is_v) {
					last_span = last_span.next
					if (last_span.plane.s > run_span.plane.s)
						run_span = last_span
				}
				let span1 = span
				while (1) {
					span1.owner = run_span.plane
					if (span1 == last_span)
						break
					span1 = span1.next
				}
				let piece = {plane: run_span.plane,
					start_plane: run_span.start_plane,
					prev: prev_piece, next: null, n1: span.n1}
				new_pieces.push(piece)
				if (prev_piece)
					prev_piece.next = piece
				else
					first_piece = piece
				prev_piece = piece
				span = last_span.next
			} while (span != first_span)
			prev_piece.next = first_piece
			first_piece.prev = prev_piece
		}

		// corners: a corner between the same planes at the same node keeps
		// its arc; the other corners end their arcs here.
		let corners_by_node = new Map() // {node -> [corner, ...]}
		for (let corner of corners) {
			let a = corners_by_node.get(corner.node)
			if (!a) {
				a = []
				corners_by_node.set(corner.node, a)
			}
			a.push(corner)
		}
		for (let q of new_pieces) {
			let node = q.n1
			let p = q.prev
			for (let corner of corners_by_node.get(node) ?? []) {
				if (corner.is_kept || corner.p.plane != p.plane
						|| corner.q.plane != q.plane)
					continue
				corner.is_kept = true
				q.n1 = corner.q.n1
				break
			}
		}
		for (let corner of corners)
			if (!corner.is_kept)
				end_arc(corner.p, corner.q, corner.node)

		// half-edges where a plane stops or starts owning spans: a plane that
		// stops gets one against its direction, a plane that starts gets one
		// along it.
		function add_half_edge(plane, nodes, k1, k2, d) {
			if (!plane || !plane.s)
				return
			if (d > 0)
				plane.half_edges.push(nodes[k1], nodes[k2])
			else
				plane.half_edges.push(nodes[k2], nodes[k1])
		}
		for (let line of lines) {
			let nodes = line.nodes
			let span_n = nodes.length - 1
			for (let d of [1, -1]) {
				let olds = line.olds[d]
				let news = line.news[d]
				let stop_plane = null
				let stop_k = 0
				let start_plane = null
				let start_k = 0
				for (let k = 0; k <= span_n; k++) {
					let old_plane = k < span_n ? olds[k]?.plane ?? null : null
					let new_plane = k < span_n ? news[k]?.owner ?? null : null
					let is_same = old_plane == new_plane
					let plane1 = is_same ? null : old_plane
					let plane2 = is_same ? null : new_plane
					if (plane1 != stop_plane) {
						add_half_edge(stop_plane, nodes, stop_k, k, -d)
						stop_plane = plane1
						stop_k = k
					}
					if (plane2 != start_plane) {
						add_half_edge(start_plane, nodes, start_k, k, d)
						start_plane = plane2
						start_k = k
					}
				}
			}
		}

		return new_pieces
	}

	// input ---------------------------------------------------------------

	// time 0 is the lowest eave of the sloped edges.
	let eave_z = inf
	for (let i = 0; i < pitches.length; i++)
		if (pitches[i] != 90)
			eave_z = min(eave_z, eave_zs[i])

	let plane_by_key = new Map() // {'is_v c n pitch t0' -> plane}
	function get_plane(is_v, c, nrm, pitch, t0) {
		let key = is_v + ' ' + c + ' ' + nrm + ' ' + pitch + ' ' + t0
		let plane = plane_by_key.get(key)
		if (!plane) {
			let s = pitch == 90 ? 0 : 1 / tan(pitch * rad)
			plane = {is_v: is_v, c: c, n: nrm, s: s, t0: t0, edge_is: [],
				half_edges: []}
			plane_by_key.set(key, plane)
			planes.push(plane)
		}
		return plane
	}

	let edge_i = 0 // index in pitches
	for (let ring of rings) {
		let n = ring.length
		let ring_planes = [] // [plane, ...] per edge
		let start_planes = [] // [plane|null, ...] per edge
		for (let i = 0; i < n; i++) {
			let [x1, y1] = ring[i]
			let [x2, y2] = ring[(i + 1) % n]
			let is_v = x1 == x2
			let c = is_v ? x1 : y1
			let nrm = is_v ? (y2 > y1 ? -1 : 1) : (x2 > x1 ? 1 : -1)
			let pitch = pitches[edge_i]
			let t0 = pitch == 90 ? 0 : eave_zs[edge_i] - eave_z
			let plane = get_plane(is_v, c, nrm, pitch, t0)
			plane.edge_is.push(edge_i)
			// eave above time 0: vertical up to it.
			if (t0 > 0) {
				ring_planes.push(get_plane(is_v, c, nrm, 90, 0))
				start_planes.push(plane)
			} else {
				ring_planes.push(plane)
				start_planes.push(null)
			}
			edge_i++
		}

		// one piece per run of collinear edges: the fastest edge of the run
		// continues over the others from the start (lower roof), so its
		// plane gets the whole run.
		let i0 = 0
		while (ring_planes[i0].is_v == ring_planes[(i0 + n - 1) % n].is_v)
			i0++
		let first_piece, prev_piece
		let i = 0
		while (i < n) {
			let plane = ring_planes[(i0 + i) % n]
			let start_plane = start_planes[(i0 + i) % n]
			let j = i + 1
			while (j < n && ring_planes[(i0 + j) % n].is_v == plane.is_v) {
				let plane1 = ring_planes[(i0 + j) % n]
				if (plane1.s > plane.s) {
					plane = plane1
					start_plane = start_planes[(i0 + j) % n]
				}
				j++
			}
			for (let k = i; k < j; k++) {
				let [x1, y1] = ring[(i0 + k) % n]
				let [x2, y2] = ring[(i0 + k + 1) % n]
				plane.half_edges.push(node_at(x1, y1, 0), node_at(x2, y2, 0))
			}
			let [x, y] = ring[(i0 + i) % n]
			let piece = {plane: plane, start_plane: start_plane,
				prev: prev_piece, next: null, n1: node_at(x, y, 0)}
			pieces.push(piece)
			if (prev_piece)
				prev_piece.next = piece
			else
				first_piece = piece
			prev_piece = piece
			i = j
		}
		prev_piece.next = first_piece
		first_piece.prev = prev_piece
	}

	// moving edges --------------------------------------------------------

	let t = 0 // current time: height above the lowest eave
	while (1) {
		ev_t = inf
		for (let i = 0; i < pieces.length; i++) {
			let a = pieces[i]
			find_start(a)
			find_collapse(a, t)
			for (let j = i + 1; j < pieces.length; j++)
				find_collision(a, pieces[j], t)
		}
		if (ev_t == inf)
			break

		if (ev_t > t + NEAR)
			nodes_now.length = 0
		t = max(t, ev_t)
		pieces = rebuild(t)
	}
	for (let piece of pieces)
		assert(!piece.plane.s, 'sloped edge left after the last event')

	// faces ---------------------------------------------------------------

	let faces = []
	for (let plane of planes) {
		if (!plane.s)
			continue
		let he = plane.half_edges
		let out_by_node = new Map() // {node -> [half_edge_i, ...]}
		for (let i = 0; i < he.length; i += 2) {
			let a = out_by_node.get(he[i])
			if (!a) {
				a = []
				out_by_node.set(he[i], a)
			}
			a.push(i)
		}
		let is_traced = [] // [half_edge_i -> true]
		let face_rings = [] // [[[x, y, z], ...], ...]
		for (let i0 = 0; i0 < he.length; i0 += 2) {
			if (is_traced[i0])
				continue
			let ring = []
			let area = 0
			let i = i0
			do {
				is_traced[i] = true
				let n1 = he[i+0]
				let n2 = he[i+1]
				ring.push([n1.x, n1.y, eave_z + n1.t])
				area += n1.x * n2.y - n2.x * n1.y
				// where the face touches itself at a node, take the
				// leftmost turn to keep its rings separate.
				let dx = n2.x - n1.x
				let dy = n2.y - n1.y
				let next_i
				let max_turn = -inf
				for (let j of out_by_node.get(n2)) {
					if (is_traced[j] && j != i0)
						continue
					let n3 = he[j+1]
					let dx1 = n3.x - n2.x
					let dy1 = n3.y - n2.y
					let turn = atan2(dx * dy1 - dy * dx1, dx * dx1 + dy * dy1)
					if (turn <= max_turn)
						continue
					max_turn = turn
					next_i = j
				}
				i = next_i
			} while (i != i0)
			if (abs(area) > NEAR)
				face_rings.push(ring)
		}
		if (face_rings.length) {
			// the edge is at m = c + n*s*(t - t0) at height t above the
			// lowest eave, m = x or y.
			let dz = plane.n / plane.s // dz per unit of m
			let a = plane.is_v ? dz : 0
			let b = plane.is_v ? 0 : dz
			faces.push({edge_is: plane.edge_is, rings: face_rings,
				plane: [a, b, eave_z + plane.t0 - dz * plane.c]})
		}
	}
	return faces
}

G.roof_skeleton = roof_skeleton

}()) // module scope.
