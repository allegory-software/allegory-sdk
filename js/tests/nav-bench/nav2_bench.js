"use strict"
;(function() {

const {assert, assign, noop} = glue
const {
	row_n, rand_int, str1_vals, make_fields, make_row, make_flat_rows,
	make_tree, bench,
} = bench_lib

ui.main = noop

/// data ---------------------------------------------------------------------

// the same rows as nav_bench.js, sent one array per column.
function make_rowset(rows, attrs) {
	let fields = make_fields()
	let col_vals = fields.map(() => [])
	for (let row of rows)
		for (let fi = 0; fi < fields.length; fi++)
			col_vals[fi].push(row[fi])
	return assign({fields: fields, col_vals: col_vals, pk: 'id'}, attrs)
}

function make_flat_rowset() {
	return make_rowset(make_flat_rows(), {pos_col: 'pos'})
}

// a flat pos nav's rows have strictly increasing pos in stored order.
function check_pos_order(nav) {
	let pos_fi = nav.pos_field.fi
	for (let i = 1; i < nav.row_n; i++)
		assert(nav.cell_val(nav.base_ris[i], pos_fi)
			> nav.cell_val(nav.base_ris[i - 1], pos_fi),
			'pos: out of order at ', i)
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

	await bench_group_by(nav)
	await bench_move(nav)
}

async function bench_move(nav) {

	await bench('flat: move 1000 rows top to bottom',
		() => Array.from(nav.base_ris.subarray(0, 1000)),
		ris => nav.move_rows(ris, null, 0xFFFFFFFF),
		(ok, ris) => {
			assert(ok && nav.base_ris[nav.row_n - 1] == ris[999],
				'move: rows not moved')
			check_pos_order(nav)
		})

	// 60 single-row inserts at one spot run out of doubles between two
	// neighbors, so the list gets renumbered; the order holds throughout.
	let at_ri = nav.base_ris[nav.row_n >> 1]
	for (let i = 0; i < 60; i++)
		nav.insert_rows([make_row(null, null, null)], at_ri)
	check_pos_order(nav)
	nav.revert_changes()
	check_pos_order(nav)
}

// each data row under the group holding its str2, under the group holding
// its str1; one top group per str1 value.
function check_groups(nav) {
	let str1_fi = nav.all_fields_map.str1.fi
	let str2_fi = nav.all_fields_map.str2.fi
	let top_n = 0 // top groups
	for (let i = 0; i < nav.visible_n; i++) {
		let ri = nav.visible_ris[i]
		let p = nav.parent_ri[ri]
		if (p == 0xFFFFFFFF) {
			top_n++
		} else if (nav.depth[ri] == 2) {
			assert(nav.cell_val(p, str2_fi) == nav.cell_val(ri, str2_fi)
				&& nav.cell_val(nav.parent_ri[p], str1_fi)
					== nav.cell_val(ri, str1_fi), 'group by: row in wrong group')
		}
	}
	assert(top_n == str1_vals.length, 'group by: wrong top group count')
}

async function bench_group_by(nav) {

	let group_by = 'str1 > str2'

	await bench('flat: group by str1 > str2',
		() => nav.set_group_by(null),
		() => nav.set_group_by(group_by),
		() => check_groups(nav))

	let group_n = nav.group_ris.length

	await bench('flat: collapse all groups',
		() => nav.set_collapsed(null, false, true),
		() => nav.set_collapsed(null, true, true),
		() => assert(nav.visible_n == str1_vals.length,
			'collapse all: rows still visible'))

	await bench('flat: expand all groups',
		() => nav.set_collapsed(null, true, true),
		() => nav.set_collapsed(null, false, true),
		() => assert(nav.visible_n == nav.row_n + group_n,
			'expand all: rows still hidden'))

	// insert into a group: the new row gets the group's key cells; key cells
	// can't be edited; removing a group row marks the rows under it.
	let str1_fi = nav.all_fields_map.str1.fi
	let str2_fi = nav.all_fields_map.str2.fi
	// a data row: two levels of groups put data rows at depth 2.
	let at_i = nav.visible_n >> 1 // index into visible_ris
	while (nav.depth[nav.visible_ris[at_i]] != 2)
		at_i++
	let at_ri = nav.visible_ris[at_i]
	assert(!nav.insert_rows([null], nav.parent_ri[at_ri]).length,
		'insert at a group row: not refused')
	let [new_ri] = nav.insert_rows([make_row(null, null, null)], at_ri)
	assert(nav.parent_ri[new_ri] == nav.parent_ri[at_ri]
		&& nav.cell_val(new_ri, str2_fi) == nav.cell_val(at_ri, str2_fi),
		'insert in group: wrong group or keys')
	nav.set_cell_val(new_ri, str1_fi, 'x')
	assert(nav.cell_val(new_ri, str1_fi) != 'x', 'group key edited')
	check_groups(nav)
	// the group holds the new row, which is dropped, not marked.
	let group_ri = nav.parent_ri[at_ri]
	let child_n = nav.desc_count[group_ri]
	nav.remove_rows([group_ri])
	assert(nav.changed_n == child_n - 1, 'remove group: rows not marked')
	nav.revert_changes()
	assert(nav.changed_n == 0, 'revert: changes left')

	// group by is refused while a key column has an edited cell, and only
	// then.
	nav.set_group_by(null)
	let ri = nav.visible_ris[0]
	nav.set_cell_val(ri, str1_fi, 'x')
	assert(!nav.set_group_by(group_by) && !nav.is_grouped,
		'group by with an edited key cell: not refused')
	assert(nav.set_group_by('str2') && nav.is_grouped,
		'group by with edits in other columns: refused')
	nav.set_group_by(null)
	nav.revert_changes()

	await bench('flat: ungroup',
		() => nav.set_group_by(group_by),
		() => nav.set_group_by(null),
		() => assert(!nav.is_grouped && nav.visible_n == nav.row_n
			&& nav.parent_ri[nav.visible_ris[0]] == 0xFFFFFFFF,
			'ungroup: groups left'))

	// a ranged level: num1 (0..999999) in buckets of 100000, plus null.
	nav.set_group_by('num1/100000')
	nav.set_collapsed(null, true, true)
	assert(nav.visible_n == 11, 'ranged group by: wrong bucket count')
	nav.set_group_by(null)
}

// every visible row one level under its parent, the parent shown before it,
// and its parent_ri the row holding its parent_id.
function check_tree(nav) {
	let id_fi = nav.id_field.fi
	let pid_fi = nav.parent_field.fi
	for (let i = 0; i < nav.visible_n; i++) {
		let ri = nav.visible_ris[i]
		let p = nav.parent_ri[ri]
		if (p == 0xFFFFFFFF) {
			assert(nav.depth[ri] == 0, 'tree: root not at depth 0')
		} else {
			assert(nav.depth[ri] == nav.depth[p] + 1
				&& nav.visible_i[p] < i
				&& nav.cell_val(p, id_fi) == nav.cell_val(ri, pid_fi),
				'tree: wrong parent at ', i)
		}
	}
}

async function bench_tree() {

	let nav, tree

	await bench('tree: init',
		() => {
			tree = make_tree()
			return make_rowset(tree.rows,
				{id_col: 'id', parent_col: 'parent_id'})
		},
		rs => {
			nav = ui.nav2({can_change_parent: true})
			nav.load(rs)
		},
		() => assert(nav.is_tree && nav.visible_n == row_n,
			'init: not a tree or wrong row count'))

	check_tree(nav)

	await bench('tree: collapse all',
		() => nav.set_collapsed(null, false, true),
		() => nav.set_collapsed(null, true, true),
		() => assert(nav.visible_n == tree.root_n,
			'collapse all: rows still visible'))

	await bench('tree: expand all',
		() => nav.set_collapsed(null, true, true),
		() => nav.set_collapsed(null, false, true),
		() => assert(nav.visible_n == nav.row_n,
			'expand all: rows still hidden'))

	let root_ri = nav.lookup('id', [tree.largest_root_id])
	let desc_n = tree.largest_root_desc_n
	assert(nav.desc_count[root_ri] == desc_n, 'tree: wrong descendant count')

	await bench(`tree: collapse root (${desc_n} desc)`,
		() => nav.set_collapsed(root_ri, false),
		() => nav.set_collapsed(root_ri, true),
		() => assert(nav.visible_n == nav.row_n - desc_n,
			'collapse: descendants still visible'))

	await bench(`tree: expand root (${desc_n} desc)`,
		() => nav.set_collapsed(root_ri, true),
		() => nav.set_collapsed(root_ri, false),
		() => assert(nav.visible_n == nav.row_n,
			'expand: descendants still hidden'))

	await bench('tree: sort by num1',
		() => nav.set_order_by(null),
		() => nav.set_order_by('num1'),
		() => check_tree(nav))

	await bench('tree: unsort',
		() => nav.set_order_by('num1'),
		() => nav.set_order_by(null),
		() => check_tree(nav))

	let num2_vals = nav.col_vals[nav.all_fields_map.num2.fi]
	function num2_in_range(ri) {
		let v = num2_vals[ri]
		return v >= 0 && v <= 500000
	}

	await bench('tree: filter num2 0..500000',
		() => nav.set_filter(null),
		() => nav.set_filter(num2_in_range),
		() => {
			assert(nav.visible_n > 0 && nav.visible_n < nav.row_n,
				'filter: no effect')
			check_tree(nav)
		})

	await bench('tree: unfilter',
		() => nav.set_filter(num2_in_range),
		() => nav.set_filter(null),
		() => assert(nav.visible_n == nav.row_n, 'unfilter: rows hidden'))

	await bench(`tree: remove root subtree (mark)`,
		() => {
			nav.remove_rows([root_ri], 'undelete')
			return nav.changed_n
		},
		() => nav.remove_rows([root_ri]),
		(ret, changed_n) => assert(nav.changed_n == changed_n + desc_n + 1,
			'remove subtree: rows not marked'))
	nav.remove_rows([root_ri], 'undelete')
	assert(nav.changed_n == 0, 'undelete subtree: rows still marked')

	// flat view, and an insert next to a child, which gets its parent.
	nav.set_flat(true)
	assert(!nav.is_tree && nav.visible_n == nav.row_n
		&& nav.depth[nav.visible_ris[nav.visible_n - 1]] == 0, 'flat view')
	nav.set_flat(false)
	check_tree(nav)
	let child_ri = nav.tree_ris[nav.tree_i[root_ri] + 1]
	let [new_ri] = nav.insert_rows([make_row(null, null, null)], child_ri)
	assert(nav.parent_ri[new_ri] == root_ri, 'insert: wrong parent')
	check_tree(nav)

	// a parent change needs no pos_col: move child_ri between two roots.
	let other_root_ri = nav.lookup('id', [tree.largest_root_id == 1 ? 2 : 1])
	await bench('tree: move a subtree to another parent',
		() => nav.parent_ri[child_ri] == root_ri ? other_root_ri : root_ri,
		parent_ri => nav.move_rows([child_ri], null, parent_ri),
		(ok, parent_ri) => {
			assert(ok && nav.parent_ri[child_ri] == parent_ri,
				'move: wrong parent')
			check_tree(nav)
		})
	// reverting the move puts the subtree back under its loaded parent.
	nav.revert_changes()
	assert(nav.parent_ri[child_ri] == root_ri, 'revert move: wrong parent')
	check_tree(nav)

	let desc_ri = nav.tree_ris[nav.tree_i[root_ri] + 1] // under root_ri now
	assert(!nav.move_rows([root_ri], null, desc_ri),
		'move into own subtree: not refused')
}

async function run() {
	assert(row_n >= 1000, 'rows must be at least 1000')
	await bench_flat()
	await bench_tree()
}

addEventListener('load', () => run().then(
	() => bench_post('bench-done', {}),
	err => bench_post('bench-done', {error: String(err?.stack ?? err)})))

})()
