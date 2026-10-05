"use strict"
;(function() {

const {assert, noop} = glue
const {
	row_n, rand_int, make_fields, make_row, make_flat_rows, bench,
} = bench_lib

ui.main = noop

/// data ---------------------------------------------------------------------

// the same rows as nav_bench.js, sent one array per column.
function make_flat_rowset() {
	let fields = make_fields()
	let col_vals = fields.map(() => [])
	for (let row of make_flat_rows())
		for (let fi = 0; fi < fields.length; fi++)
			col_vals[fi].push(row[fi])
	return {fields: fields, col_vals: col_vals, pk: 'id'}
}

/// checks -------------------------------------------------------------------

// visible rows in sort key order by col, each pair compared by the column's
// storage.
function check_sorted(nav, col, desc) {
	let field = nav.all_fields_map[col]
	let vals = nav.col_vals[field.fi]
	let storage = field.col_storage
	assert(nav.visible_n == nav.row_n, 'sort: wrong row count')
	for (let i = 1; i < nav.visible_n; i++) {
		let v = storage.get(vals, nav.visible_ris[i])
		let r = storage.compare_cell(vals, nav.visible_ris[i-1], v, field)
		assert(desc ? r >= 0 : r <= 0, 'sort: rows out of order at ', i)
	}
}

/// bench --------------------------------------------------------------------

async function bench_flat() {

	let nav

	await bench('flat: init',
		() => make_flat_rowset(),
		rs => {
			nav = ui.nav2()
			nav.load(rs)
		},
		() => assert(nav.visible_n == row_n, 'init: wrong row count'))

	await bench('flat: sort by num1',
		() => nav.set_order_by(null),
		() => nav.set_order_by('num1'),
		() => check_sorted(nav, 'num1'))

	await bench('flat: unsort',
		() => nav.set_order_by('num1'),
		() => nav.set_order_by(null),
		() => assert(nav.visible_ris[0] == nav.base_ris[0]
			&& nav.visible_n == nav.row_n, 'unsort: not in stored order'))

	await bench('flat: sort by str1 (10 values)',
		() => nav.set_order_by(null),
		() => nav.set_order_by('str1'),
		() => check_sorted(nav, 'str1'))

	await bench('flat: sort by str3 (10k values)',
		() => nav.set_order_by(null),
		() => nav.set_order_by('str3'),
		() => check_sorted(nav, 'str3'))

	await bench('flat: sort by num1 desc',
		() => nav.set_order_by(null),
		() => nav.set_order_by('num1:desc'),
		() => check_sorted(nav, 'num1', true))

	// unknown columns are ignored: nothing left to sort by means unsorted.
	nav.set_order_by('no_such_col')
	assert(nav.order_by == null && nav.sorted_ris == nav.base_ris,
		'sort: unknown column not ignored')

	// the same range as nav_bench.js; null (NaN) is out of range.
	let num2_vals = nav.col_vals[nav.all_fields_map.num2.fi]
	function num2_in_range(ri) {
		let v = num2_vals[ri]
		return v >= 0 && v <= 500000
	}

	await bench('flat: filter num2 0..500000',
		() => nav.set_filter(null),
		() => nav.set_filter(num2_in_range),
		() => {
			let n = 0 // rows in range
			for (let ri = 0; ri < nav.row_n; ri++)
				if (num2_in_range(ri))
					n++
			assert(nav.visible_n == n, 'filter: wrong row count')
		})

	await bench('flat: unfilter',
		() => nav.set_filter(num2_in_range),
		() => nav.set_filter(null),
		() => assert(nav.visible_n == nav.row_n, 'unfilter: rows still hidden'))

	let id_field = nav.all_fields_map.id

	await bench('flat: build pk index',
		() => nav.indexes.delete('id'),
		() => nav.lookup('id', [1]),
		ri => assert(nav.col_vals[id_field.fi][ri] == 1,
			'build pk index: wrong row'))

	await bench('flat: lookup by pk (per call)',
		() => {
			let ids = []
			for (let i = 0; i < 1000; i++)
				ids.push(1 + rand_int(row_n))
			return {ids: ids, ris: []}
		},
		ctx => {
			for (let id of ctx.ids)
				ctx.ris.push(nav.lookup('id', [id]))
		},
		(ret, ctx) => {
			for (let i = 0; i < ctx.ids.length; i++)
				assert(nav.col_vals[id_field.fi][ctx.ris[i]] == ctx.ids[i],
					'lookup: wrong row')
		},
		1000)

	let field_n = nav.fields.length
	let first_ri = () => nav.visible_ris[0]
	let last_ri = () => nav.visible_ris[nav.visible_n - 1]
	let first_fi = nav.fields[0].fi
	let last_fi = nav.fields[field_n - 1].fi
	let mid_fi = nav.fields[field_n >> 1].fi

	await bench('flat: focus random cell (per call)', null,
		() => {
			for (let i = 0; i < 1000; i++)
				nav.focus_cell(nav.visible_ris[rand_int(nav.visible_n)],
					nav.fields[rand_int(field_n)].fi)
		},
		() => assert(nav.focused_ri != null, 'focus: no focused row'),
		1000)

	await bench('flat: select all',
		() => nav.focus_cell(first_ri(), first_fi),
		() => nav.focus_cell(null, null, 'all'),
		() => assert(nav.is_cell_selected(last_ri(), last_fi)
			&& nav.focused_ri == first_ri(), 'select all: not all selected'))

	await bench('flat: select none',
		() => nav.focus_cell(null, null, 'all'),
		() => nav.focus_cell(first_ri(), first_fi),
		() => assert(!nav.is_cell_selected(last_ri(), last_fi)
			&& nav.is_cell_selected(first_ri(), first_fi),
			'select none: selection not reset'))

	await bench('flat: extend selection to all rows',
		() => nav.focus_cell(first_ri(), first_fi),
		() => nav.focus_cell(last_ri(), last_fi, 'expand'),
		() => assert(nav.is_cell_selected(
				nav.visible_ris[nav.visible_n >> 1], mid_fi),
			'extend selection: not all selected'))

	await bench('flat: invert after select all',
		() => nav.focus_cell(null, null, 'all'),
		() => nav.focus_cell(nav.visible_ris[5], first_fi, 'invert'),
		() => assert(!nav.is_cell_selected(nav.visible_ris[5], first_fi)
			&& nav.is_cell_selected(last_ri(), last_fi),
			'invert: wrong selection'))

	await bench('flat: iterate selection (all rows)',
		() => nav.focus_cell(null, null, 'all'),
		() => {
			let n = 0 // selected rows
			nav.each_selected_row(() => n++)
			return n
		},
		n => assert(n == nav.visible_n, 'iterate selection: wrong row count'))

	// hidden rows don't stay selected: a filter resets the selection to the
	// focused cell.
	nav.focus_cell(null, null, 'all')
	nav.each_selected_row(noop)
	nav.set_filter(num2_in_range)
	let selected_n = 0 // selected rows
	nav.each_selected_row(() => selected_n++)
	assert(selected_n == (nav.focused_ri != null ? 1 : 0),
		'filter: selection not reset')
	nav.set_filter(null)

	let num3_fi = nav.all_fields_map.num3.fi

	function edit_random_rows(n) {
		for (let i = 0; i < n; i++)
			nav.set_cell_val(nav.visible_ris[rand_int(nav.visible_n)], num3_fi,
				rand_int(1000000))
	}

	await bench('flat: update cell (per call)', null,
		() => edit_random_rows(1000),
		() => assert(nav.changed_n > 0, 'update: no changed rows'),
		1000)

	await bench('flat: revert changes (1000 edited rows)',
		() => edit_random_rows(1000),
		() => nav.revert_changes(),
		() => assert(nav.changed_n == 0, 'revert: rows still changed'))

	// edits: changed rows sort first in base order, pass any filter, keep
	// text that doesn't parse, and break the pk check on a duplicate id.
	edit_random_rows(1000)
	nav.set_order_by('num1')
	let changed_n = nav.changed_n
	// num3 is in the first word of each row's changed_mask.
	for (let i = 0, j = 0; i < nav.row_n && j < changed_n; i++)
		if (nav.changed_mask[nav.base_ris[i] * nav.mask_word_n])
			assert(nav.sorted_ris[j++] == nav.base_ris[i],
				'sort: changed rows not first in base order')
	nav.set_filter(() => false)
	assert(nav.visible_n == changed_n, 'filter: changed rows hidden')
	nav.set_filter(null)
	nav.set_order_by(null)
	let ri = nav.visible_ris[0]
	nav.set_cell_val(ri, num3_fi, 'abc')
	assert(nav.cell_val(ri, num3_fi) == 'abc'
		&& nav.cell_errors[num3_fi][ri].failed, 'edit: invalid text lost')
	let id_fi = nav.all_fields_map.id.fi
	nav.set_cell_val(ri, id_fi, nav.cell_val(nav.visible_ris[1], id_fi))
	assert(!nav.validate_row(ri), 'validate row: duplicate pk not caught')
	nav.revert_changes()
	assert(nav.changed_n == 0 && nav.validate_row(ri)
		&& nav.cell_val(ri, num3_fi) != 'abc', 'revert: edits left')

	// new rows get null ids: the server assigns them.
	function make_new_rows(n) {
		let rows = []
		for (let i = 0; i < n; i++)
			rows.push(make_row(null, null, null))
		return rows
	}

	for (let n of [1, 1000])
		await bench(`flat: insert ${n} rows at middle`,
			() => ({rows: make_new_rows(n), row_n: nav.row_n}),
			ctx => nav.insert_rows(ctx.rows,
				nav.visible_ris[nav.visible_n >> 1]),
			(ris, ctx) => assert(ris.length == n
				&& nav.row_n == ctx.row_n + n && nav.visible_n == nav.row_n,
				'insert: rows not inserted'))

	// the first row_n slots hold the loaded rows, none of them new.
	let step = Math.floor(row_n / 1000)
	let loaded_ris = [] // 1000 loaded rows spread over the nav
	for (let i = 0; i < 1000; i++)
		loaded_ris.push(i * step)

	for (let [label, ris] of [['1 row', [loaded_ris[500]]],
			['1000 scattered rows', loaded_ris]])
		await bench(`flat: remove ${label} (mark)`,
			() => {
				nav.remove_rows(ris, 'undelete')
				return nav.changed_n
			},
			() => nav.remove_rows(ris),
			(ret, changed_n) => assert(nav.changed_n == changed_n + ris.length
				&& nav.visible_n == nav.row_n, 'remove: rows not marked'))

	await bench('flat: undelete 1000 rows',
		() => {
			nav.remove_rows(loaded_ris)
			return nav.changed_n
		},
		() => nav.remove_rows(loaded_ris, 'undelete'),
		(ret, changed_n) => assert(nav.changed_n == changed_n - 1000,
			'undelete: rows still marked'))

	await bench('flat: remove 1000 new rows (drop)',
		() => {
			let ris = nav.insert_rows(make_new_rows(1000), null)
			return {ris: ris, row_n: nav.row_n}
		},
		ctx => nav.remove_rows(ctx.ris),
		(ret, ctx) => assert(nav.row_n == ctx.row_n - 1000
			&& nav.visible_n == nav.row_n, 'drop: rows not dropped'))

	// the pk index keeps up with inserted and dropped rows; revert_changes
	// drops new rows and unmarks removed ones.
	let id5_ri = nav.lookup('id', [5])
	assert(nav.cell_val(id5_ri, id_fi) == 5, 'lookup after inserts: wrong row')
	nav.revert_changes()
	assert(nav.changed_n == 0 && nav.row_n == row_n
		&& nav.lookup('id', [5]) == id5_ri, 'revert: new rows left')
}

async function run() {
	assert(row_n >= 1000, 'rows must be at least 1000')
	await bench_flat()
}

addEventListener('load', () => run().then(
	() => bench_post('bench-done', {}),
	err => bench_post('bench-done', {error: String(err?.stack ?? err)})))

})()
