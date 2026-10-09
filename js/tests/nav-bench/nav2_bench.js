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
			nav = ui.nav2('flat')
			nav.load(rs)
		},
		() => assert(nav.visible_n == row_n, 'init: wrong row count'))

	await bench_slot_retirement(nav)

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
		() => nav.get_debug_state().indexes.delete('id'),
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

	let field_n = nav.visible_fields.length
	let first_ri = () => nav.visible_ris[0]
	let last_ri = () => nav.visible_ris[nav.visible_n - 1]
	let first_fi = nav.visible_fields[0].fi
	let last_fi = nav.visible_fields[field_n - 1].fi
	let mid_fi = nav.visible_fields[field_n >> 1].fi

	await bench('flat: focus random cell (per call)', null,
		() => {
			for (let i = 0; i < 1000; i++)
				nav.focus_cell(nav.visible_ris[rand_int(nav.visible_n)],
					nav.visible_fields[rand_int(field_n)].fi)
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

	let str3_fi = nav.all_fields_map.str3.fi

	// no word starts with 'x': the walk reads every visible row.
	await bench('flat: quicksearch, no match',
		() => nav.focus_cell(first_ri(), str3_fi),
		() => nav.quicksearch('x', str3_fi),
		ri => assert(ri == null && nav.focused_ri == first_ri(),
			'quicksearch: matched or moved'))

	// the walk starts at the focused row and ignores case; with offset 1 and
	// -1 it finds the next and the previous match. focus_cell() on another
	// cell and set_cell_val() on the focused cell end the quicksearch.
	let qs_ri = nav.visible_ris[5] // row to find
	let s = nav.cell_val(qs_ri, str3_fi).slice(0, 2).toUpperCase() // typed
	let starts_with_s = ri =>
		nav.cell_val(ri, str3_fi).startsWith(s.toLowerCase())
	nav.focus_cell(qs_ri, str3_fi)
	assert(nav.quicksearch(s, str3_fi) == qs_ri && nav.quicksearch_text == s,
		'quicksearch: focused row not matched')
	let next_ri = nav.quicksearch(s, str3_fi, 1)
	assert(next_ri != null && nav.visible_i[next_ri] > 5
		&& starts_with_s(next_ri), 'quicksearch: wrong next match')
	for (let i = 6; i < nav.visible_i[next_ri]; i++)
		assert(!starts_with_s(nav.visible_ris[i]), 'quicksearch: match skipped')
	assert(nav.quicksearch(s, str3_fi, -1) == qs_ri,
		'quicksearch: wrong previous match')
	nav.focus_cell(nav.visible_ris[6], str3_fi)
	assert(nav.quicksearch_text == '', 'quicksearch: focus moved, text kept')
	nav.quicksearch(s, str3_fi)
	nav.set_cell_val(nav.focused_ri, str3_fi, 'x')
	assert(nav.quicksearch_text == '', 'quicksearch: cell edited, text kept')
	nav.revert_changes()

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
	// text that doesn't parse, and accept duplicate ids for server checking.
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
	assert(!nav.validate_row(ri), 'validate row: invalid cell accepted')
	nav.revert_cell(ri, num3_fi)
	let id_fi = nav.all_fields_map.id.fi
	nav.set_cell_val(ri, id_fi, nav.cell_val(nav.visible_ris[1], id_fi))
	assert(nav.validate_row(ri), 'validate row: duplicate pk rejected')
	nav.revert_changes()
	assert(nav.changed_n == 0 && nav.validate_row(ri)
		&& nav.cell_val(ri, num3_fi) != 'abc', 'revert: edits left')

	// every row has an id to clear; pos cells are refused.
	let pos_fi = nav.pos_field.fi
	await bench('flat: set null on selection (1000 rows)',
		() => {
			nav.revert_changes()
			nav.focus_cell(nav.visible_ris[0], first_fi)
			nav.focus_cell(nav.visible_ris[999], last_fi, 'expand')
		},
		() => nav.set_null_selected_cells({input: true}),
		() => {
			let ri = nav.visible_ris[500]
			assert(nav.changed_n == 1000 && nav.cell_val(ri, num3_fi) == null
				&& nav.cell_val(ri, pos_fi) != null, 'set null: wrong cells')
		})
	nav.revert_changes()

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

	nav.revert_changes()

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

	// a reload where the server changed num3 in 1000 rows.
	await bench('flat: merge rowset (1000 changed rows)',
		() => {
			let rs = make_flat_rowset()
			for (let i = 0; i < 1000; i++)
				rs.col_vals[num3_fi][i * step] = -1
			return rs
		},
		rs => nav.diff_merge(rs),
		() => assert(nav.row_n == row_n && nav.changed_n == 0
			&& nav.cell_val(nav.lookup('id', [1]), num3_fi) == -1,
			'merge: wrong rows'))

	await bench_group_by(nav)
	await bench_move(nav)
}

async function bench_slot_retirement(nav) {
	let num3_fi = nav.all_fields_map.num3.fi
	for (let has_selection of [false, true])
		await bench(has_selection
				? 'flat: drop 1000 edited selected rows'
				: 'flat: drop 1000 edited rows',
			() => {
				let rows = []
				for (let i = 0; i < 1000; i++)
					rows.push(make_row(5, null, null))
				let ris = nav.insert_rows(rows, null)
				for (let ri of ris) {
					nav.set_cell_val(ri, num3_fi, 'abc')
					nav.validate_row(ri)
				}
				if (has_selection) {
					nav.focus_cell(ris[0], num3_fi)
					nav.focus_cell(ris[999], num3_fi, 'expand')
				}
				return {ris: ris, row_n: nav.row_n}
			},
			ctx => nav.remove_rows(ctx.ris),
			(ret, ctx) => {
				assert(nav.row_n == ctx.row_n - 1000 && nav.changed_n == 0,
					'drop edited: rows not dropped')
				check_retired_slots(nav, ctx.ris)
			})

	await bench('flat: insert 1000 rows into freed slots',
		() => {
			let rows = []
			for (let i = 0; i < 1000; i++)
				rows.push(make_row(null, null, null))
			let ris = nav.insert_rows(rows, null)
			nav.remove_rows(ris)
			return {rows: rows, slot_n: nav.get_debug_state().slot_n}
		},
		ctx => nav.insert_rows(ctx.rows, null),
		(ris, ctx) => {
			assert(ris.length == 1000
				&& nav.get_debug_state().slot_n == ctx.slot_n,
				'insert: freed slots not reused')
			nav.remove_rows(ris)
		})
}

function check_retired_slots(nav, ris) {
	let free_ris = new Set(nav.get_debug_state().free_ris)
	assert(free_ris.size == nav.get_debug_state().free_ris.length,
		'free slots: a slot was freed twice')
	for (let ri of ris) {
		assert(free_ris.has(ri) && nav.visible_i[ri] == 0xFFFFFFFF
			&& nav.row_flags[ri] == 0 && nav.row_errors[ri] == null,
			'free slot: row state left')
		for (let fi = 0; fi < nav.all_fields.length; fi++)
			assert(nav.input_vals[fi]?.[ri] === undefined
				&& nav.cell_errors[fi]?.[ri] === undefined,
				'free slot: cell state left')
		let word_i = ri * nav.mask_word_n
		for (let w = 0; w < nav.mask_word_n; w++)
			assert(!nav.changed_mask[word_i + w]
				&& !nav.sel_mask[word_i + w], 'free slot: cell bits left')
	}
}

function check_slot_retirement() {
	let nav = ui.nav2('slot_retirement')
	nav.load({
		fields: [
			{name: 'id', type: 'number'},
			{name: 'parent_id', type: 'number'},
			{name: 'num1', type: 'number'},
		],
		col_vals: [[1, 2], [null, 1], [10, 20]],
		pk: 'id',
		parent_col: 'parent_id',
	})
	let [new_ri] = nav.insert_rows([[3, null, 30]], 1)
	nav.set_cell_val(new_ri, 2, 'abc')
	nav.focus_cell(0, 2)
	nav.focus_cell(new_ri, 2, 'invert')
	nav.remove_rows([0, new_ri])
	check_retired_slots(nav, [new_ri])
	assert(nav.changed_n == 2 && nav.focused_ri == null
		&& nav.is_cell_selected(0, 2), 'drop: surviving selection changed')
	let ris = nav.insert_rows([[4], [5]])
	assert(ris[0] != ris[1] && nav.cell_val(ris[0], 0) == 4
		&& nav.cell_val(ris[1], 0) == 5, 'insert: two rows share a slot')

	nav.load({
		fields: [{name: 'a'}, {name: 'b'}],
		col_vals: [['x', 'y'], ['z', 'z']],
		pk: 'a',
	})
	nav.set_group_by('a')
	nav.focus_cell(0, 0)
	nav.focus_cell(nav.group_ris[1], 0, 'invert')
	nav.set_group_by('b')
	assert(nav.focused_ri == null && nav.is_cell_selected(0, 0),
		'regroup: surviving selection changed')
	for (let ri of nav.group_ris)
		assert(!nav.is_cell_selected(ri, 0), 'regroup: new group selected')

	nav.load({
		fields: [{name: 'a'}, {name: 'b'}],
		col_vals: [[], []],
		pk: 'a',
	})
	let [ri] = nav.insert_rows([['x', 'y']])
	nav.set_group_by('a > b')
	let group_ris = nav.group_ris.slice()
	nav.focus_cell(group_ris[0], 0)
	nav.remove_rows([group_ris[0], ri])
	check_retired_slots(nav, [ri, ...group_ris])
	assert(nav.row_n == 0 && nav.group_ris.length == 0
		&& nav.changed_n == 0 && nav.focused_ri == null,
		'drop: empty groups left')
}

// policy options refuse the user's calls (ev.input) and never app code.
function check_policy() {
	let user = {input: true} // ev of a user's call
	let nav = ui.nav2('policy')
	nav.load({
		fields: [
			{name: 'id', type: 'number'},
			{name: 'a'},
			{name: 'b', readonly: true},
		],
		col_vals: [[1, 2], ['x', 'y'], ['x', 'y']],
		pk: 'id',
	})

	nav.set_row_flag(0, 'no_change', true)
	nav.set_cell_val(0, 1, 'z', user)
	nav.set_cell_val(1, 2, 'z', user)
	assert(nav.changed_n == 0, 'policy: user edit not refused')
	nav.set_cell_val(0, 1, 'z')
	nav.set_cell_val(1, 2, 'z')
	assert(nav.cell_val(0, 1) == 'z' && nav.cell_val(1, 2) == 'z',
		'policy: app edit refused')
	nav.revert_changes()

	nav.set_row_flag(1, 'no_remove', true)
	nav.remove_rows([1], 'delete', user)
	assert(nav.changed_n == 0, 'policy: user removal not refused')
	nav.remove_rows([1])
	assert(nav.changed_n == 1, 'policy: app removal refused')
	nav.revert_changes()

	nav.can_add_rows = false
	assert(!nav.insert_rows([null], null, user).length,
		'policy: user insert not refused')
	assert(nav.insert_rows([null], null).length == 1,
		'policy: app insert refused')
	nav.revert_changes()

	// the user can't move while filtered, nor without pos_col.
	nav.set_filter(() => true)
	assert(!nav.move_rows([0], null, 0xFFFFFFFF, user),
		'policy: user move not refused')
	assert(nav.move_rows([0], null, 0xFFFFFFFF) && nav.base_ris[1] == 0,
		'policy: app move refused')
}

let save_fields = [
	{name: 'id', type: 'number'},
	{name: 'a'},
	{name: 'b', type: 'number'},
]

// saving without a server: pack_changes() builds the batch and
// apply_result() takes rowset.lua's answer to it.
function check_saving() {
	let nav = ui.nav2('saving')
	nav.load({
		fields: save_fields,
		col_vals: [[1, 2, 3], ['x', 'y', 'z'], [10, 20, 30]],
		pk: 'id',
	})

	// an unset cell is undefined; null is a value; revert unsets it again.
	let [new_ri] = nav.insert_rows([[undefined, 'n']])
	assert(nav.cell_val(new_ri, 2) === undefined, 'unset: not undefined')
	nav.set_cell_val(new_ri, 2, null)
	assert(nav.cell_val(new_ri, 2) === null, 'unset: null not kept')
	nav.revert_cell(new_ri, 2)
	assert(nav.cell_val(new_ri, 2) === undefined, 'unset: revert kept null')

	// backwards in stored order; unset cells and unedited cells left out.
	nav.set_cell_val(0, 1, 'x2')
	nav.remove_rows([1])
	let batch = nav.pack_changes()
	let [t_new, t_remove, t_update] = batch.rows
	assert(batch.ris.join() == [new_ri, 1, 0].join()
		&& t_new.type == 'new' && t_new.values.a == 'n'
		&& !('id' in t_new.values) && !('b' in t_new.values)
		&& t_remove.type == 'remove' && t_remove.values['id:old'] == 2
		&& t_update.type == 'update' && t_update.values.a == 'x2'
		&& t_update.values['id:old'] == 1 && !('b' in t_update.values),
		'pack: wrong batch')

	// an edit made in flight stays on top of the server's value.
	nav.set_cell_val(0, 1, 'x3')
	nav.apply_result(batch, {rows: [
		{values: [4, 'n', 7]},
		{remove: true},
		{values: [1, 'x2', 10]},
	]})
	assert(nav.row_n == 3 && nav.changed_n == 1
		&& nav.cell_val(new_ri, 0) == 4 && nav.cell_val(new_ri, 2) == 7
		&& nav.lookup('id', [4]) == new_ri && nav.lookup('id', [2]) == null
		&& nav.cell_val(0, 1) == 'x3', 'ack: wrong rows')

	// an error leaves the row changed and invalid.
	batch = nav.pack_changes()
	nav.apply_result(batch, {rows: [{error: 'no', field_errors: {a: 'bad'}}]})
	assert(nav.changed_n == 1 && nav.row_errors[0] && nav.cell_errors[1][0]
		&& !nav.validate_row(0), 'ack: error lost')
	nav.revert_changes()

	// a row dropped in flight: the ack skips its slot.
	let [new_ri2] = nav.insert_rows([[undefined, 'm']])
	batch = nav.pack_changes()
	nav.revert_row(new_ri2)
	nav.apply_result(batch, {rows: [{values: [5, 'm', null]}]})
	assert(nav.row_n == 3 && nav.changed_n == 0,
		'ack: dropped row not skipped')
}

// diff_merge(): matched rows take the server's values under their edits,
// rows new on the server are added, rows gone from it are dropped, and new
// rows stay.
function check_merge() {
	let nav = ui.nav2('merge')
	nav.load({
		fields: save_fields,
		col_vals: [[1, 2, 3], ['x', 'y', 'z'], [10, 20, 30]],
		pk: 'id',
	})
	nav.set_cell_val(0, 1, 'x1')
	nav.set_cell_val(1, 1, 'y1')
	nav.insert_rows([[undefined, 'n']])
	nav.diff_merge({
		fields: save_fields,
		rows: [[1, 'x', 11], [2, 'y1', 20], [4, 'w', 40]],
		pk: 'id',
	})
	let ri4 = nav.lookup('id', [4])
	assert(nav.row_n == 4 && nav.lookup('id', [3]) == null
		&& ri4 != null && nav.cell_val(ri4, 1) == 'w',
		'merge: rows not added or dropped')
	assert(nav.cell_val(0, 1) == 'x1' && nav.cell_val(0, 2) == 11
		&& nav.cell_val(1, 1) == 'y1' && nav.changed_n == 2,
		'merge: edits or values wrong')

	// other columns: load.
	nav.diff_merge({fields: [{name: 'id', type: 'number'}], rows: [[7]],
		pk: 'id'})
	assert(nav.row_n == 1 && nav.changed_n == 0, 'merge: other columns merged')
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

	await bench('flat: ungroup with selection',
		() => {
			nav.set_group_by(group_by)
			nav.focus_cell(nav.group_ris[0], str1_fi)
			nav.focus_cell(nav.group_ris[nav.group_ris.length - 1],
				str1_fi, 'expand')
		},
		() => nav.set_group_by(null),
		() => assert(!nav.is_grouped && nav.focused_ri == null,
			'ungroup: freed group still focused'))

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
			nav = ui.nav2('tree', {can_change_parent: true})
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

	let first_child_ri = nav.tree_ris[nav.tree_i[root_ri] + 1]
	await bench('tree: remove subtree with 1000 new rows',
		() => {
			let rows = []
			for (let i = 0; i < 1000; i++)
				rows.push(make_row(null, null, null))
			nav.insert_rows(rows, first_child_ri)
			return nav.row_n
		},
		() => nav.remove_rows([root_ri]),
		(ret, row_n) => {
			assert(nav.row_n == row_n - 1000,
				'remove subtree: new rows not dropped')
			nav.remove_rows([root_ri], 'undelete')
			assert(nav.changed_n == 0, 'undelete subtree: changes left')
		})

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

function make_index_nav(n, positions) {
	let ids = new Float64Array(n)
	let pos_vals = new Float64Array(n)
	for (let ri = 0; ri < n; ri++) {
		ids[ri] = ri + 1
		pos_vals[ri] = ri + 1
	}
	if (positions)
		pos_vals.set(positions)
	let nav = ui.nav2('index')
	nav.load({
		fields: [
			{name: 'id', type: 'number'},
			{name: 'pos', type: 'number'},
		],
		col_vals: [ids, pos_vals],
		pk: 'id',
		pos_col: 'pos',
	})
	return nav
}

function check_indexes() {
	for (let reuse_slots of [false, true]) {
		let nav = make_index_nav(3)
		if (reuse_slots)
			nav.remove_rows(nav.insert_rows([[4], [5]]))
		nav.lookup('pos', [1])
		nav.lookup('id pos', [1, 1])
		let pos_index = nav.get_debug_state().indexes.get('pos')
		let id_pos_index = nav.get_debug_state().indexes.get('id pos')
		let ris = nav.insert_rows([[4], [5]], 1)
		assert(nav.get_debug_state().indexes.get('pos') == pos_index
			&& nav.get_debug_state().indexes.get('id pos') == id_pos_index,
			'insert: existing indexes invalidated')
		for (let ri of ris)
			assert(nav.lookup('pos', [nav.cell_val(ri, 1)]) == ri,
				'insert: wrong position lookup')
	}
	let nav = make_index_nav(3, [1, 1 + Number.EPSILON, 3])
	nav.lookup('pos', [1])
	let pos_index = nav.get_debug_state().indexes.get('pos')
	let [ri] = nav.insert_rows([[4]], 1)
	assert(nav.get_debug_state().indexes.get('pos') == pos_index
		&& nav.lookup('pos', [nav.cell_val(ri, 1)]) == ri,
		'renumber fresh rows: existing index invalidated or lookup failed')

	nav = make_index_nav(3, [1, 1 + Number.EPSILON, 3])
	let [new_ri] = nav.insert_rows([[4]])
	nav.lookup('pos', [4])
	nav.lookup('id pos', [4, 4])
	nav.lookup('id', [4])
	let id_index = nav.get_debug_state().indexes.get('id')
	nav.insert_rows([[5]], 1)
	assert(!nav.get_debug_state().indexes.has('pos')
		&& !nav.get_debug_state().indexes.has('id pos')
		&& nav.get_debug_state().indexes.get('id') == id_index,
		'renumber existing new rows: wrong index invalidation')
	assert(nav.lookup('pos', [5]) == new_ri,
		'renumber existing new rows: wrong position lookup')

	nav = make_index_nav(3)
	;[new_ri] = nav.insert_rows([[4]], 1)
	nav.lookup('pos', [1])
	nav.lookup('id', [4])
	id_index = nav.get_debug_state().indexes.get('id')
	assert(nav.move_rows([new_ri], null, 0xFFFFFFFF), 'move refused')
	assert(!nav.get_debug_state().indexes.has('pos')
		&& nav.get_debug_state().indexes.get('id') == id_index
		&& nav.lookup('pos', [4]) == new_ri,
		'move new row: wrong index invalidation or lookup')

	nav = make_index_nav(3)
	nav.lookup('pos', [1])
	pos_index = nav.get_debug_state().indexes.get('pos')
	nav.move_rows([0], null, 0xFFFFFFFF)
	assert(nav.get_debug_state().indexes.get('pos') == pos_index
		&& nav.lookup('pos', [1]) == 0,
		'move saved row: loaded-value index changed')

	nav = ui.nav2('index_tree')
	nav.load({
		fields: [
			{name: 'id', type: 'number'},
			{name: 'parent_id', type: 'number'},
			{name: 'pos', type: 'number'},
		],
		col_vals: [[1, 2, 3], [null, null, 1], [1, 2, 1]],
		pk: 'id', id_col: 'id', parent_col: 'parent_id', pos_col: 'pos',
	})
	;[new_ri] = nav.insert_rows([[4]], 2)
	nav.lookup('parent_id', [1])
	nav.lookup('parent_id pos', [1, 1])
	id_index = nav.get_debug_state().indexes.get('id')
	assert(nav.move_rows([new_ri], null, 1), 'parent change refused')
	assert(!nav.get_debug_state().indexes.has('parent_id')
		&& !nav.get_debug_state().indexes.has('parent_id pos')
		&& nav.get_debug_state().indexes.get('id') == id_index
		&& nav.lookup('parent_id', [2]) == new_ri
		&& nav.lookup('parent_id pos', [2, 1]) == new_ri,
		'parent change: wrong index invalidation or lookup')
}

async function bench_indexes() {
	for (let n of [1, 1000])
		for (let cols of [null, 'id', 'pos', 'id pos']) {
			let label = cols || 'no'
			for (let do_lookup of cols?.includes('pos')
				? [false, true] : [false])
				await bench(`indexes: insert ${n}, ${label} index`
					+ (do_lookup ? ' + lookup' : ''),
					() => {
						let nav = make_index_nav(row_n)
						if (cols)
							nav.lookup(cols, cols == 'id pos' ? [1, 1] : [1])
						let rows = Array.from({length: n},
							(_, i) => [row_n + i + 1])
						return {nav: nav, rows: rows}
					},
					ctx => {
						let nav = ctx.nav
						let ris = nav.insert_rows(ctx.rows, row_n >> 1)
						ctx.ris = ris
						if (do_lookup) {
							let ri = ris[0]
							let vals = cols == 'id pos'
								? [nav.cell_val(ri, 0), nav.cell_val(ri, 1)]
								: [nav.cell_val(ri, 1)]
							return nav.lookup(cols, vals)
						}
					},
					(ret, ctx) => {
						assert(ctx.nav.row_n == row_n + n,
							'indexed insert: wrong row count')
						if (do_lookup)
							assert(ret == ctx.ris[0],
								'indexed insert: lookup failed')
					})
		}

	await bench('indexes: insert 1000 reused slots + lookup',
		() => {
			let nav = make_index_nav(row_n)
			let rows = Array.from({length: 1000}, (_, i) => [row_n + i + 1])
			nav.remove_rows(nav.insert_rows(rows))
			nav.lookup('pos', [1])
			return {nav: nav, rows: rows}
		},
		ctx => {
			ctx.ris = ctx.nav.insert_rows(ctx.rows, row_n >> 1)
			return ctx.nav.lookup('pos', [ctx.nav.cell_val(ctx.ris[0], 1)])
		},
		(ret, ctx) => assert(ret == ctx.ris[0], 'reused slots: lookup failed'))

	await bench('indexes: move 1000 new rows and lookup',
		() => {
			let nav = make_index_nav(row_n)
			let rows = Array.from({length: 1000}, (_, i) => [row_n + i + 1])
			let ris = nav.insert_rows(rows, row_n >> 1)
			nav.lookup('pos', [1])
			return {nav: nav, ris: ris}
		},
		ctx => {
			assert(ctx.nav.move_rows(ctx.ris, null, 0xFFFFFFFF), 'move refused')
			return ctx.nav.lookup('pos', [ctx.nav.cell_val(ctx.ris[0], 1)])
		},
		(ret, ctx) => assert(ret == ctx.ris[0], 'move: position lookup failed'))
}

function check_validation() {
	let nav = ui.nav2('validation')
	nav.load({
		fields: [
			{name: 'required', type: 'number', not_null: true,
				client_default: null},
			{name: 'server_value', type: 'number', not_null: true,
				has_server_default: true},
			{name: 'readonly_value', readonly: true, not_null: true,
				client_default: 'ok'},
			{name: 'num', type: 'number'},
		],
		col_vals: [[1], [null], ['ok'], [2]],
		pk: 'required',
	})
	assert(nav.validate_row(0), 'validate: saved row rejected')
	let [ri] = nav.insert_rows([null])
	assert(!nav.validate_row(ri) && nav.cell_errors[0][ri].failed,
		'validate: untouched required cell accepted')
	assert(!nav.cell_errors[1]?.[ri] && !nav.cell_errors[2]?.[ri],
		'validate: defaulted cell rejected')
	assert(nav.changed_n == 1 && nav.input_vals.length == 0
		&& nav.cell_val(ri, 0) == null,
		'validate: row values or edits changed')
	nav.set_cell_val(ri, 0, 3)
	assert(nav.validate_row(ri) && !nav.cell_errors[0][ri],
		'validate: required cell error retained')
	nav.set_cell_val(ri, 3, 'abc')
	assert(!nav.validate_row(ri) && nav.cell_val(ri, 3) == 'abc',
		'validate: invalid edited text lost or accepted')
	nav.revert_cell(ri, 3)
	assert(nav.validate_row(ri), 'validate: reverted optional cell rejected')
	nav.revert_cell(ri, 0)
	assert(!nav.validate_row(ri), 'validate: reverted required cell accepted')
	nav.remove_rows([ri])
	;[ri] = nav.insert_rows([null])
	assert(!nav.validate_row(ri), 'validate: reused slot skipped validation')
}

async function bench_validation() {
	for (let mode of ['saved', 'new', 'new repeated', 'new invalid'])
		await bench('validate: 1000 ' + mode + ' rows, 20 fields',
			() => {
				let rows = []
				for (let i = 0; i < 1000; i++) {
					let row = make_row(i + 1, null, null)
					row[3] = mode == 'new invalid' ? null : 1
					rows.push(row)
				}
				let is_new = mode != 'saved'
				let rs = make_rowset(is_new ? [] : rows)
				rs.fields[3].not_null = true
				let nav = ui.nav2('validate_' + mode)
				nav.load(rs)
				let ris = is_new ? nav.insert_rows(rows) : nav.base_ris
				if (mode == 'new repeated')
					for (let ri of ris)
						nav.validate_row(ri)
				return {nav: nav, ris: ris}
			},
			ctx => {
				let valid_n = 0
				for (let ri of ctx.ris)
					if (ctx.nav.validate_row(ri))
						valid_n++
				return valid_n
			},
			valid_n => assert(valid_n == (mode == 'new invalid' ? 0 : 1000),
				'validate: wrong valid row count'))
}

async function run() {
	assert(row_n >= 1000, 'rows must be at least 1000')
	check_validation()
	await bench_validation()
	check_indexes()
	await bench_indexes()
	check_slot_retirement()
	check_policy()
	check_saving()
	check_merge()
	await bench_flat()
	await bench_tree()
}

addEventListener('load', () => run().then(
	() => bench_post('bench-done', {}),
	err => bench_post('bench-done', {error: String(err?.stack ?? err)})))

})()
