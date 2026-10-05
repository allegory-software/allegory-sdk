"use strict"
// shared by nav_bench.js and nav2_bench.js: url params, seeded data (the same
// values on both pages) and the timing loop.
;(function() {

const {floor} = glue

let params = new URLSearchParams(location.search)
let row_n = +(params.get('rows') ?? 1000000)
let rep_n = +(params.get('repeats') ?? 3)

/// data ---------------------------------------------------------------------

// mulberry32: seeded, so every run and every repeat gets the same data.
let seed = 0
function rand() {
	seed = (seed + 0x6D2B79F5) | 0
	let t = seed
	t = Math.imul(t ^ (t >>> 15), t | 1)
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function rand_int(n) {
	return floor(rand() * n)
}

let syllables = 'ka lo mi ne ru sa ti vo ze ba de fi go hu ja pe'.split(' ')
let words = []
for (let i = 0; i < 10000; i++) {
	let s = ''
	for (let j = 0, n = 2 + rand_int(3); j < n; j++)
		s += syllables[rand_int(syllables.length)]
	words.push(s)
}
let str1_vals = words.slice(0, 10)
let str2_vals = words.slice(10, 110)

function make_fields() {
	let fields = [
		{name: 'id'       , type: 'number'},
		{name: 'parent_id', type: 'number'},
		{name: 'pos'      , type: 'number'},
	]
	for (let i = 1; i <= 8; i++)
		fields.push({name: 'num'+i, type: 'number'})
	for (let i = 1; i <= 6; i++)
		fields.push({name: 'str'+i})
	for (let i = 1; i <= 3; i++)
		fields.push({name: 'bool'+i, type: 'bool'})
	return fields
}

function make_row(id, parent_id, pos) {
	let row = [id, parent_id, pos]
	for (let i = 0; i < 8; i++)
		row.push(rand() < .05 ? null : rand_int(1000000))
	row.push(str1_vals[rand_int(str1_vals.length)])
	row.push(str2_vals[rand_int(str2_vals.length)])
	for (let i = 0; i < 4; i++)
		row.push(words[rand_int(words.length)])
	for (let i = 0; i < 3; i++)
		row.push(rand() < .05 ? null : rand() < .5)
	return row
}

function make_flat_rows() {
	seed = 1
	let rows = []
	for (let ri = 0; ri < row_n; ri++)
		rows.push(make_row(ri + 1, null, ri + 1))
	return rows
}

// levels of 1/1000, 1/50 and 1/5 of the rows, the rest at the bottom. each
// row's parent is a random row of the level above, so child counts vary.
function make_tree() {
	seed = 2
	let level_ns = [floor(row_n / 1000), floor(row_n / 50), floor(row_n / 5)]
	level_ns.push(row_n - level_ns[0] - level_ns[1] - level_ns[2])
	let rows = []
	let root_ris = [] // root of each row, by ri
	let desc_counts = [] // descendants of each root, by ri
	let parent_ri1 = 0 // first ri of the level above
	let parent_ri2 = 0 // end ri of the level above; 0: no level above
	for (let level_n of level_ns) {
		let level_ri1 = rows.length
		for (let i = 0; i < level_n; i++) {
			let ri = rows.length
			if (parent_ri2) {
				let parent_ri = parent_ri1 + rand_int(parent_ri2 - parent_ri1)
				let root_ri = root_ris[parent_ri]
				root_ris.push(root_ri)
				desc_counts[root_ri]++
				rows.push(make_row(ri + 1, parent_ri + 1, null))
			} else {
				root_ris.push(ri)
				desc_counts.push(0)
				rows.push(make_row(ri + 1, null, null))
			}
		}
		parent_ri1 = level_ri1
		parent_ri2 = rows.length
	}
	let largest_root_ri = 0
	for (let ri = 1; ri < level_ns[0]; ri++)
		if (desc_counts[ri] > desc_counts[largest_root_ri])
			largest_root_ri = ri
	return {
		rows: rows,
		root_n: level_ns[0],
		largest_root_id: largest_root_ri + 1,
		largest_root_desc_n: desc_counts[largest_root_ri],
	}
}

/// bench --------------------------------------------------------------------

// setup() -> ctx, untimed; op(ctx) -> ret, timed; check(ret, ctx), untimed.
// per_n: number of calls inside op, to report the time of one call.
async function bench(name, setup, op, check, per_n) {
	let times = []
	for (let i = 0; i < rep_n; i++) {
		let ctx = setup?.()
		// collect the setup's garbage so that the op doesn't pay for it.
		gc()
		let t0 = performance.now()
		let ret = op(ctx)
		let t = performance.now() - t0
		check?.(ret, ctx)
		times.push(t / (per_n ?? 1))
	}
	times.sort((t1, t2) => t1 - t2)
	await bench_post('bench-log', {
		name: name,
		min: times[0],
		median: times[floor(times.length / 2)],
	})
}

window.bench_lib = {
	row_n,
	rand_int,
	str1_vals,
	make_fields,
	make_row,
	make_flat_rows,
	make_tree,
	bench,
}

})()
