/*

	Weighted straight skeleton of axis-aligned polygons, for roofs.
	Written by Cosmin Apreutesei. Public Domain.

	roof_skeleton(rings, pitches, eave_z) -> faces
		rings    [[[x, y], ...], ...]  outer ring (area > 0), holes (area < 0)
		pitches  [deg, ...]            per edge, edges of all rings in order
		faces    [{edge_is: [i, ...], rings: [[[x, y, z], ...], ...]}, ...]

	Edges with pitch 90 are vertical (gable ends, edges against a wall) and
	get no face. Edges in the same plane share one face. Of collinear
	neighbor edges, only the shallowest gets a face. Regions closed in by
	vertical edges get no face. Face rings are ccw outlines (area > 0) and
	cw holes (area < 0).

*/

(function() {
"use strict"
const G = window

const {inf, abs, min, max, tan, rad, atan2, assert} = glue

let NEAR = 1e-5 // distance and time tolerance

// The code moves every edge inward at its own speed, time being the height
// above the eaves. All moving edges stay axis-aligned and every corner joins
// two perpendicular edges, so there are only two events:
//  - two parallel edges facing each other meet: the overlap becomes a ridge
//    and the rest of the edges reconnect.
//  - the edge between two parallel edges facing the same way shrinks to
//    zero: the edges become collinear and the faster one (lower roof)
//    continues over both.
// Each moving edge is a piece of a plane. Each corner traces an arc between
// the faces of its two pieces; the code adds the arcs and ridges to the faces
// as half-edges with the face on their left, and walks them into rings.

// planes and pieces ---------------------------------------------------------

function line_at(plane, t) {
	return plane.c + plane.n * plane.s * t
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

function roof_skeleton(rings, pitches, eave_z) {

	let planes = [] // [{is_v, c, n, s, edge_is, half_edges}, ...]
	let pieces = [] // [{plane, prev, next, n1, is_dead}, ...]
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

	// segment n1 -> n2 along `above`'s moving direction: `below` is behind it.
	function add_ridge(above, below, n1, n2) {
		if (n1 == n2)
			return
		above.half_edges.push(n1, n2)
		below.half_edges.push(n2, n1)
	}

	// pieces --------------------------------------------------------------

	let joins = [] // [p, q, node, ...] collinear pieces linked at node

	// make q follow p, their corner starting at `node`. collinear pieces are
	// joined later by run_joins(), after every link of the event is made.
	function link(p, q, node) {
		p.next = q
		q.prev = p
		q.n1 = node
		if (p.plane.is_v == q.plane.is_v)
			joins.push(p, q, node)
	}

	function add_piece(plane, prev, next, n1, next_n1) {
		let piece = {plane: plane, prev: null, next: null, n1: null,
			is_dead: false}
		link(prev, piece, n1)
		link(piece, next, next_n1)
		pieces.push(piece)
	}

	// p and q are collinear and meet at `node` where both their arcs ended.
	// p comes before q.
	function join(p, q, node, t) {
		if (p == q) { // zero-length piece between two collinear pieces: drop.
			p.is_dead = true
			return
		}
		if (q.next == p) { // only p and q are left: they end at both nodes.
			add_ridge(p.plane, q.plane, node, p.n1)
			p.is_dead = true
			q.is_dead = true
			return
		}
		assert(p.prev.plane.is_v != p.plane.is_v)
		assert(q.next.plane.is_v != q.plane.is_v)
		if (p.plane.n != q.plane.n) {
			// facing each other: q turns back over p and they collide from
			// `node` up to the end of the shorter one.
			let node_m = p.plane.is_v ? node.y : node.x
			let p_len = abs(node_m - piece_tail_m(p, t))
			let q_len = abs(piece_head_m(q, t) - node_m)
			if (p_len > q_len + NEAR) { // p keeps its tail part.
				let head = head_node(q, t)
				add_ridge(p.plane, q.plane, node, head)
				end_arc(q, q.next, head)
				q.is_dead = true
				link(p, q.next, head)
			} else if (q_len > p_len + NEAR) { // q keeps its head part.
				let tail = tail_node(p, t)
				add_ridge(p.plane, q.plane, node, tail)
				end_arc(p.prev, p, tail)
				p.is_dead = true
				link(p.prev, q, tail)
			} else {
				let tail = tail_node(p, t)
				add_ridge(p.plane, q.plane, node, tail)
				end_arc(p.prev, p, tail)
				end_arc(q, q.next, tail)
				p.is_dead = true
				q.is_dead = true
				link(p.prev, q.next, tail)
			}
		} else if (p.plane == q.plane) { // same plane: merge.
			q.is_dead = true
			link(p, q.next, q.next.n1)
		} else if (p.plane.s >= q.plane.s) { // p is faster: p continues over q.
			let head = head_node(q, t)
			add_ridge(p.plane, q.plane, node, head)
			end_arc(q, q.next, head)
			q.is_dead = true
			link(p, q.next, head)
		} else { // q is faster: q continues over p.
			let tail = tail_node(p, t)
			add_ridge(q.plane, p.plane, tail, node)
			end_arc(p.prev, p, tail)
			p.is_dead = true
			link(p.prev, q, tail)
		}
	}

	// a join that kills a piece links its neighbors, so a pending join
	// with a dead piece was already resolved.
	function run_joins(t) {
		for (let i = 0; i < joins.length; i += 3) {
			let p    = joins[i+0]
			let q    = joins[i+1]
			let node = joins[i+2]
			if (p.is_dead || q.is_dead)
				continue
			join(p, q, node, t)
		}
		joins.length = 0
	}

	// two parallel pieces facing each other meet at time t.
	function collide(a, c, t) {
		if (piece_dir(a) < 0) {
			let a0 = a
			a = c
			c = a0
		}
		// a runs from a1 to a2, c runs from c2 to c1, both along +m.
		let a1 = piece_tail_m(a, t)
		let a2 = piece_head_m(a, t)
		let c1 = piece_head_m(c, t)
		let c2 = piece_tail_m(c, t)
		let o1 = max(a1, c1)
		let o2 = max(o1, min(a2, c2))
		let L = line_at(a.plane, t)
		let is_v = a.plane.is_v
		let n1 = is_v ? node_at(L, o1, t) : node_at(o1, L, t)
		let n2 = is_v ? node_at(L, o2, t) : node_at(o2, L, t)
		add_ridge(c.plane, a.plane, n1, n2)

		let pa = a.prev
		let na = a.next
		let pc = c.prev
		let nc = c.next
		a.is_dead = true
		c.is_dead = true

		// low end
		if (a1 < c1 - NEAR) { // a keeps its tail part.
			end_arc(c, nc, n1)
			add_piece(a.plane, pa, nc, a.n1, n1)
		} else if (c1 < a1 - NEAR) { // c keeps its head part.
			end_arc(pa, a, n1)
			add_piece(c.plane, pa, nc, n1, nc.n1)
		} else {
			end_arc(pa, a, n1)
			end_arc(c, nc, n1)
			link(pa, nc, n1)
		}

		// high end
		if (a2 > c2 + NEAR) { // a keeps its head part.
			end_arc(pc, c, n2)
			add_piece(a.plane, pc, na, n2, na.n1)
		} else if (c2 > a2 + NEAR) { // c keeps its tail part.
			end_arc(a, na, n2)
			add_piece(c.plane, pc, na, c.n1, n2)
		} else {
			end_arc(pc, c, n2)
			end_arc(a, na, n2)
			link(pc, na, n2)
		}

		run_joins(t)
	}

	// the piece between two parallel pieces facing the same way shrinks to
	// zero at time t.
	function collapse(e, t) {
		let p = e.prev
		let q = e.next
		let node = tail_node(e, t)
		end_arc(p, e, node)
		end_arc(e, q, node)
		e.is_dead = true
		link(p, q, node)
		run_joins(t)
	}

	// events --------------------------------------------------------------

	let ev_t, ev_a, ev_c // next event: collide(ev_a, ev_c) or collapse(ev_a)

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
		ev_a = e
		ev_c = null
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
		ev_a = a
		ev_c = c
	}

	// input ---------------------------------------------------------------

	let plane_by_key = new Map() // {'is_v c n pitch' -> plane}
	let edge_i = 0 // index in pitches
	for (let ring of rings) {
		let n = ring.length
		let ring_planes = [] // [plane, ...] per edge
		for (let i = 0; i < n; i++) {
			let [x1, y1] = ring[i]
			let [x2, y2] = ring[(i + 1) % n]
			let is_v = x1 == x2
			let c = is_v ? x1 : y1
			let nrm = is_v ? (y2 > y1 ? -1 : 1) : (x2 > x1 ? 1 : -1)
			let pitch = pitches[edge_i]
			let key = is_v + ' ' + c + ' ' + nrm + ' ' + pitch
			let plane = plane_by_key.get(key)
			if (!plane) {
				let s = pitch == 90 ? 0 : 1 / tan(pitch * rad)
				plane = {is_v: is_v, c: c, n: nrm, s: s, edge_is: [],
					half_edges: []}
				plane_by_key.set(key, plane)
				planes.push(plane)
			}
			plane.edge_is.push(edge_i)
			ring_planes.push(plane)
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
			let j = i + 1
			while (j < n && ring_planes[(i0 + j) % n].is_v == plane.is_v) {
				let plane1 = ring_planes[(i0 + j) % n]
				if (plane1.s > plane.s)
					plane = plane1
				j++
			}
			for (let k = i; k < j; k++) {
				let [x1, y1] = ring[(i0 + k) % n]
				let [x2, y2] = ring[(i0 + k + 1) % n]
				plane.half_edges.push(node_at(x1, y1, 0), node_at(x2, y2, 0))
			}
			let [x, y] = ring[(i0 + i) % n]
			let piece = {plane: plane, prev: prev_piece, next: null,
				n1: node_at(x, y, 0), is_dead: false}
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

	let t = 0 // current time: height above the eaves
	while (1) {
		let live_pieces = []
		for (let piece of pieces)
			if (!piece.is_dead)
				live_pieces.push(piece)
		pieces = live_pieces

		ev_t = inf
		for (let i = 0; i < pieces.length; i++) {
			let a = pieces[i]
			find_collapse(a, t)
			for (let j = i + 1; j < pieces.length; j++)
				find_collision(a, pieces[j], t)
		}
		if (ev_t == inf)
			break

		if (ev_t > t + NEAR)
			nodes_now.length = 0
		t = max(t, ev_t)
		if (ev_c)
			collide(ev_a, ev_c, ev_t)
		else
			collapse(ev_a, ev_t)
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
		if (face_rings.length)
			faces.push({edge_is: plane.edge_is, rings: face_rings})
	}
	return faces
}

G.roof_skeleton = roof_skeleton

}()) // module scope.
