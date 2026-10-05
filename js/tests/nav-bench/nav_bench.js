"use strict"
;(function() {

const {assign, assert, noop, floor} = glue
const {
	row_n, rand_int, str1_vals, make_fields, make_row, make_flat_rows,
	make_tree, bench,
} = bench_lib

ui.main = noop

/// data ---------------------------------------------------------------------

function make_flat_rowset(has_pos_col) {
	return {
		fields: make_fields(),
		rows: make_flat_rows(),
		pk: 'id',
		pos_col: has_pos_col ? 'pos' : null,
	}
}

function make_tree_rowset(tree) {
	return {
		fields: make_fields(),
		rows: tree.rows,
		pk: 'id',
		id_col: 'id',
		parent_col: 'parent_id',
	}
}

let next_id = row_n + 1 // id of the next inserted row

function make_new_rows(n) {
	let rows = []
	for (let i = 0; i < n; i++)
		rows.push(make_row(next_id++, null, null))
	return rows
}

/// nav ----------------------------------------------------------------------

// save is not benched: no op may save on its own. validation on load is off,
// as on navs made for large rowsets.
let nav_opt = {
	validate_on_load  : false,
	save_on_add_row   : false,
	save_on_remove_row: false,
	save_on_input     : false,
	save_on_exit_edit : false,
	save_on_exit_row  : false,
	save_on_move_row  : false,
}

function make_nav(rowset_name) {
	return ui.nav(rowset_name, assign({rowset_name: rowset_name}, nav_opt))
}

function sort_rows(nav) {
	nav.set_order_by_dir('num1', 'asc')
}

function unsort_rows(nav) {
	nav.set_order_by_dir('num1', false)
}

function filter_rows(nav) {
	nav.set_col_filter('num2', '0..500000')
}

function unfilter_rows(nav) {
	nav.set_col_filter('num2', null)
}

function collapse_all(nav) {
	nav.set_collapsed(null, true, true)
}

function expand_all(nav) {
	nav.set_collapsed(null, false, true)
}

function set_group_by(nav, group_by) {
	nav.group_by = group_by
	nav.update_parts({fields: true, group_by: true})
}

/// bench --------------------------------------------------------------------

async function bench_sort_and_filter(nav, prefix) {
	await bench(prefix+'sort by num1',
		() => unsort_rows(nav),
		() => sort_rows(nav),
		() => assert(nav.order_by == 'num1', 'sort: not sorted'))
	await bench(prefix+'unsort',
		() => sort_rows(nav),
		() => unsort_rows(nav),
		() => assert(nav.order_by == null, 'unsort: still sorted'))
	await bench(prefix+'filter num2 0..500000',
		() => unfilter_rows(nav),
		() => filter_rows(nav),
		() => assert(nav.rows.length > 0
			&& nav.rows.length < nav.all_rows.length, 'filter: no effect'))
	await bench(prefix+'unfilter',
		() => filter_rows(nav),
		() => unfilter_rows(nav),
		() => assert(nav.rows.length == nav.all_rows.length,
			'unfilter: rows still hidden'))
}

async function bench_insert_and_remove(nav, prefix) {

	for (let n of [1, 1000])
		await bench(prefix+`insert ${n} rows at middle`,
			() => make_new_rows(n),
			rows => nav.insert_rows(rows,
				{row_index: floor(nav.rows.length / 2), input: true}),
			inserted_n => assert(inserted_n == n, 'insert: rows not inserted'))

	await bench(prefix+'remove 1 row',
		() => ({
			rows: [nav.rows[floor(nav.rows.length / 2)]],
			all_rows_n: nav.all_rows.length,
		}),
		ctx => nav.remove_rows(ctx.rows, {input: true}),
		(ret, ctx) => assert(nav.all_rows.length == ctx.all_rows_n - 1,
			'remove: row not removed'))

	await bench(prefix+'remove 1000 scattered rows',
		() => {
			let rows = []
			let step = floor(nav.rows.length / 1000)
			for (let i = 0; i < 1000; i++)
				rows.push(nav.rows[i * step])
			return {rows: rows, all_rows_n: nav.all_rows.length}
		},
		ctx => nav.remove_rows(ctx.rows, {input: true}),
		(ret, ctx) => assert(nav.all_rows.length == ctx.all_rows_n - 1000,
			'remove: rows not removed'))
}

async function bench_flat() {

	let nav

	await bench('flat: init',
		() => {
			nav?.free()
			ui.rowsets.bench_flat = make_flat_rowset(true)
		},
		() => nav = make_nav('bench_flat'),
		() => assert(nav.rows.length == row_n, 'init: wrong row count'))

	await bench_sort_and_filter(nav, 'flat: ')

	for (let [col, label] of [['str1', '10 values'], ['str3', '10k values']])
		await bench(`flat: sort by ${col} (${label})`,
			() => nav.set_order_by_dir(col, false),
			() => nav.set_order_by_dir(col, 'asc'),
			() => assert(nav.order_by == col, 'sort: not sorted'))
	nav.set_order_by_dir('str3', false)

	await bench('flat: build pk index',
		() => nav.invalidate_indexes(),
		() => nav.lookup('id', [1])[0],
		row => assert(row[0] == 1, 'build pk index: wrong row'))

	await bench('flat: lookup by pk (per call)',
		() => {
			let ids = []
			for (let i = 0; i < 1000; i++)
				ids.push(1 + rand_int(row_n))
			return {ids: ids, rows: []}
		},
		ctx => {
			for (let id of ctx.ids)
				ctx.rows.push(nav.lookup('id', [id])[0])
		},
		(ret, ctx) => {
			for (let i = 0; i < ctx.ids.length; i++)
				assert(ctx.rows[i][0] == ctx.ids[i], 'lookup: wrong row')
		},
		1000)

	await bench('flat: focus random cell (per call)', null,
		() => {
			for (let i = 0; i < 1000; i++)
				nav.focus_cell(rand_int(nav.rows.length),
					rand_int(nav.fields.length))
		},
		() => assert(nav.focused_row, 'focus: no focused row'),
		1000)

	await bench('flat: select all',
		() => nav.focus_cell(0, 0),
		() => nav.select_all_cells(),
		() => assert(nav.selected_rows.size == nav.rows.length,
			'select all: not all rows selected'))

	await bench('flat: select none',
		() => nav.select_all_cells(),
		() => nav.focus_cell(0, 0),
		() => assert(nav.selected_rows.size == 1,
			'select none: selection not reset'))

	await bench('flat: extend selection to all rows',
		() => nav.focus_cell(0, 0),
		() => nav.focus_cell(nav.rows.length-1, nav.fields.length-1, 0, 0,
			{select: 'expand'}),
		() => assert(nav.selected_rows.size == nav.rows.length,
			'extend selection: not all rows selected'))

	await bench('flat: update cell (per call)', null,
		() => {
			for (let i = 0; i < 1000; i++)
				nav.set_cell_val(nav.rows[rand_int(nav.rows.length)], 'num3',
					rand_int(1000000))
		},
		() => assert(nav.changed_rows?.size, 'update: no changed rows'),
		1000)

	await bench_insert_and_remove(nav, 'flat: ')

	await bench('flat: move 1000 rows top to bottom',
		() => {
			nav.focus_cell(0, 0)
			nav.focus_cell(999, 0, 0, 0, {select: 'expand'})
			assert(nav.selected_rows.size == 1000, 'move: selection')
		},
		() => {
			let state = nav.start_move_selected_rows()
			state?.finish(nav.rows.length, null)
			return state
		},
		state => assert(state, 'move: refused'))

	await bench('flat: group by str1 > str2',
		() => set_group_by(nav, null),
		() => set_group_by(nav, 'str1 > str2'),
		() => assert(nav.is_grouped, 'group by: not grouped'))

	await bench('flat: collapse all groups',
		() => expand_all(nav),
		() => collapse_all(nav),
		() => assert(nav.rows.length == str1_vals.length,
			'collapse all: rows still visible'))

	await bench('flat: expand all groups',
		() => collapse_all(nav),
		() => expand_all(nav),
		() => assert(nav.rows.length > nav.all_rows.length,
			'expand all: rows still hidden'))

	await bench('flat: ungroup',
		() => set_group_by(nav, 'str1 > str2'),
		() => set_group_by(nav, null),
		() => assert(!nav.is_grouped, 'ungroup: still grouped'))

	nav.free()
	delete ui.rowsets.bench_flat
}

async function bench_flat_no_pos() {
	ui.rowsets.bench_flat_no_pos = make_flat_rowset(false)
	let nav = make_nav('bench_flat_no_pos')
	assert(!nav.pos_field, 'flat, no pos: nav has a pos field')
	await bench_insert_and_remove(nav, 'flat, no pos: ')
	nav.free()
	delete ui.rowsets.bench_flat_no_pos
}

async function bench_tree() {

	let nav, tree

	await bench('tree: init',
		() => {
			nav?.free()
			tree = make_tree()
			ui.rowsets.bench_tree = make_tree_rowset(tree)
		},
		() => nav = make_nav('bench_tree'),
		() => assert(nav.is_tree && nav.rows.length == row_n,
			'init: not a tree or wrong row count'))

	await bench('tree: collapse all',
		() => expand_all(nav),
		() => collapse_all(nav),
		() => assert(nav.rows.length == tree.root_n,
			'collapse all: rows still visible'))

	await bench('tree: expand all',
		() => collapse_all(nav),
		() => expand_all(nav),
		() => assert(nav.rows.length == nav.all_rows.length,
			'expand all: rows still hidden'))

	let root_row = nav.lookup('id', [tree.largest_root_id])[0]

	await bench(`tree: collapse root (${tree.largest_root_desc_n} desc)`,
		() => nav.set_collapsed(root_row, false),
		() => nav.set_collapsed(root_row, true),
		() => assert(nav.rows.length
			== nav.all_rows.length - tree.largest_root_desc_n,
			'collapse: descendants still visible'))

	await bench(`tree: expand root (${tree.largest_root_desc_n} desc)`,
		() => nav.set_collapsed(root_row, true),
		() => nav.set_collapsed(root_row, false),
		() => assert(nav.rows.length == nav.all_rows.length,
			'expand: descendants still hidden'))

	await bench_sort_and_filter(nav, 'tree: ')

	nav.free()
	delete ui.rowsets.bench_tree
}

async function run() {
	assert(row_n >= 1000, 'rows must be at least 1000')
	await bench_flat()
	await bench_flat_no_pos()
	await bench_tree()
}

addEventListener('load', () => run().then(
	() => bench_post('bench-done', {}),
	err => bench_post('bench-done', {error: String(err?.stack ?? err)})))

})()
