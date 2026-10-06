/*

	UI nav objects v2.
	Written by Cosmin Apreutesei. Public Domain.

DATA STRUCTURES

The nav gives every row a slot number ri (row index) at load or insert and
keeps it until the server confirms the row's delete. The nav stores every
per-row fact in a typed array indexed by ri, and every row order as a
Uint32Array of ri's. No op writes to row objects: an op writes a few entries
at known ri's, or makes sequential passes over typed arrays.

	n          number of rows
	k          number of rows passed to an op
	i          index into visible_ris
	fi         column index, fixed for the nav's life; bit fi of sel_mask
	           and changed_mask is column fi, so moving, hiding or showing
	           a column needs no remap
	W          ceil(number of columns / 32)
	NONE       0xFFFFFFFF
	tree nav   nav with id and parent_id columns, shown as tree or flat
	data row   row from the rowset or inserted by the user
	group row  synthetic row made by group-by, never saved

Column values, one array each, indexed by ri:

	type    array         null
	------  ------------  ---------------------------------
	number  Float64Array  NaN (since we do not support NaN as value)
	bool    Uint8Array    2
	string  Array         null

Each field type in ui_field.js has its storage in col_storage, which loads
a column, grows it, reads and writes its cells, writes radix sort keys and
compares a cell with a value in sort key order.

The columns hold the values last seen on the server. An edited cell's value
is input_vals[fi][ri] instead, which can be text that didn't parse;
changed_mask says which cells are edited. cmp(ri1, ri2) and fn(ri) take
slots and read each cell by that rule.

The nav grows all ri-indexed arrays together by doubling, and takes new
slots from free_ris first.

Per-row arrays, indexed by ri:

	name             type        holds
	---------------  ----------  ------------------------------------------
	parent_ri        Uint32      displayed parent: tree parent, group slot
	                             or NONE
	first_child_ri   Uint32      first child, in current order
	next_sibling_ri  Uint32      next sibling, in current order
	depth            Uint16      indent level
	desc_count       Uint32      number of descendants
	tree_i           Uint32      index into tree_ris; with desc_count, the
	                             row's subtree is tree_ris[tree_i ..
	                             tree_i + desc_count]
	row_flags        Uint16      one bit per flag below; 0 by default
	visible_i        Uint32      index into visible_ris; NONE if hidden
	sel_mask         Uint32 x W  one bit per selected cell
	changed_mask     Uint32 x W  one bit per edited cell; nonzero: changed

Flags in row_flags. One word per row, so stage 5 reads its three flags with
one load; ops that set a flag on all rows loop over the words.

	flag           set when
	-------------  ----------------------------------------------
	is_collapsed   row is collapsed
	is_pass        row passes the filter
	has_pass_desc  some descendant passes the filter
	is_group       row is a synthetic group row
	is_new         inserted, not saved yet
	is_removed     marked for deletion
	is_invalid     row or one of its cells failed validation
	no_focus       row can't be focused
	no_change      row's cells can't be edited
	no_remove      row can't be deleted
	no_save        row is never saved

Other state:

	name           type         holds
	-------------  -----------  ---------------------------------------------
	all_fields     Array        field objects by fi, made by
	                            ui.create_field()
	all_fields_map object       {name -> field}
	fields         Array        visible columns in display order;
	                            field.index: position in fields
	mask_word_n    number       W: words per row in sel_mask, changed_mask
	has_sel_bits   boolean      false: sel_mask is all zero, so clearing it
	                            and stage 5's walk can be skipped
	group_ris      Uint32Array  group slots in key order; empty if ungrouped
	changed_n      number       number of changed rows
	cap            number       capacity of every ri-indexed array
	slot_n         number       slots ever used, free ones included
	free_ris       Array        free slots, used as a stack
	input_vals     Array        per column: a sparse Array of edited values
	                            by ri, made on the column's first edit
	cell_errors    Array        per column: a sparse Array of validation
	                            errors by ri, made on the column's first
	                            error
	row_errors     Array        sparse: row validation errors by ri
	indexes        Map          cols -> index: the data rows' ri's sorted by
	                            those columns, in a Uint32Array
	focused_ri     number       focused row; null when no row is focused
	focused_fi     number       focused column
	sel_anchor_ri  number       selection rectangle from the anchor cell to
	sel_anchor_fi  number       the end cell, not yet written into sel_mask;
	sel_end_ri     number       it spans the visible rows and the visible
	sel_end_fi     number       columns between the two cells

A row is changed when is_new or is_removed is set or its changed_mask is
nonzero, and no_save is clear. The ops below add 1 to changed_n when a row
becomes changed and subtract 1 when it becomes clean. Save and revert all
find the changed rows with one scan.

Clearing an entry of input_vals, cell_errors or row_errors sets it to
undefined, so the sparse array keeps the slot and setting it again rebuilds
nothing. The nav drops the arrays whole when changed_n reaches 0.

pos values are sparse: a pos is compared only with the pos of the rows in
its own pos list (all rows, or in a tree nav the rows with the same
parent_id), so an insert or a move gives the placed rows values between
their neighbors' and leaves every other row alone. The pos column stores
doubles; when no double is left between two neighbors, the nav renumbers that
list 1..m. On pos_col navs, base_ris holds each pos list in pos order, and
parent_ri is derived from the parent_id cells: when a revert or a merge
changes those cells, the nav puts the rows back in place (parent_ri through
the id index, and base_ris sorted by pos again, edited pos included).

The nav builds an index with the stage 2 radix sort, and a lookup is a
binary search that reads the index's columns. Indexes hold the column values,
so the nav updates them on insert, drop rows and save ack, with one merge or
compaction pass per batch. Tree navs build the id index at load; the nav
builds any other index, the pk index included, on its first lookup. A lookup
returns the first row with the key: every caller uses only one row, and the
pk check only asks whether another row has the key.

Row orders, each a Uint32Array of ri's:

	base_ris     stored order; pos order on pos_col navs
	sorted_ris   data rows in sort order
	tree_ris     all rows, each parent before its descendants
	visible_ris  rows shown, in display order; two buffers, swapped on each
	             stage 5 run

The nav reruns a stage only when one of its inputs changed:

	stage  output                  built from                cost
	-----  ----------------------  ------------------------  ---------------
	1      base_ris                load order, inserts,      -
	                               moves
	2      sorted_ris              base_ris, sort columns    radix: O(n) per
	                               or cmp; is base_ris when  digit; cmp: n log
	                               unsorted                  n cmp calls
	3      first_child_ri,         sorted_ris, group_ris,    O(n)
	       next_sibling_ri,        parent_ri
	       tree_ris, depth,
	       desc_count
	4      has_pass_desc           is_pass, tree_ris         O(n)
	5      visible_ris, visible_i  tree_ris, desc_count,     O(n) worst
	                               is_pass, has_pass_desc,
	                               is_collapsed

Stage 2. Sort by columns: LSD radix sort of the ri's with 16-bit digits,
last sort column first. Radix sort is stable, so equal keys keep base_ris
order. Key per column type:
- number: the double's bits, made unsigned-sortable (positive: flip the sign
	bit; negative: flip all bits); NaN (null): key 0, first in order. 4
	digits, read through a Uint32Array view of the column.
- bool: key 0 for null, 1 for false, 2 for true. 1 digit.
- string: the value's rank among the column's distinct values sorted by the
	column's collation. The rank pass collects the distinct values with a
	Map, sorts them, and writes a Uint32 rank per row. 2 digits.
desc: invert the key. Custom cmp(ri1, ri2): Uint32Array sort with cmp.
Changed rows don't take part in a sort: they come first, in base_ris order,
and the other rows follow in sort order. So the radix sort reads only the
columns, never input_vals.

Stage 3. Flat view without groups: tree_ris is sorted_ris, depth and
desc_count are all 0. Otherwise:
- walk sorted_ris, then group_ris, backwards and push each row on the front
	of its parent's child list, so the nav builds each child list in order.
- walk depth-first through first_child_ri and next_sibling_ri, climbing
	back up with parent_ri, so no stack is needed; write tree_ris, tree_i and
	depth.
- walk tree_ris backwards and add each row's desc_count + 1 to its
	parent's desc_count.

Stage 4. Clear has_pass_desc in every row's flags. Walk tree_ris backwards.
Row passes or has a passing descendant: set has_pass_desc on its parent.

Stage 5.
- write the selection rectangle into sel_mask, since the rectangle is in
	visible positions.
- walk tree_ris. Row that doesn't pass and has no passing descendant: skip
	it and its descendants (desc_count + 1 entries). Else: append it to
	visible_ris; collapsed: skip its descendants. Rewrite visible_i.
- focused row hidden: focused_ri = null. A UI that wants a nearby row reads
	visible_i before the op.
- after a filter change or a collapse: clear sel_mask and select the
	focused cell. After other ops: walk the previous visible_ris buffer and
	clear sel_mask for rows whose visible_i is now NONE. Only rows that were
	visible can have bits, so this walk finds all of them.

Ops:

	op                    work
	--------------------  -----------------------------------------------------
	load                  the server sends one array per column: copy each
	                      into its column, null -> NaN (number) or 2 (bool);
	                      a string column takes the array itself.
	                      base_ris = 0..n-1, sorted by pos on pos_col navs;
	                      tree navs: build the id index, radix-sort the rows
	                      by parent_id and walk both lists together to fill
	                      parent_ri (a parent_id not found: root); stages
	                      3-5. rows that stage 3 doesn't reach are in a
	                      cycle: warn and show the rows flat
	sort                  stages 2, 3, 5
	unsort                sorted_ris = base_ris; stages 3, 5
	filter                is_pass = fn(ri) per data row; new and changed
	                      rows: is_pass stays 1 until saved; stages 4, 5
	insert k rows at i    refused under a new row or a row marked for
	                      deletion; grouped: refused at a group row or at the
	                      end. take k slots from free_ris, then from the end,
	                      and reset their entries; is_new = 1, is_pass = 1;
	                      copy parent_ri and the parent_id cell from the row
	                      at i (grouped: the tree parent is found through the
	                      id index); grouped: copy the key cells too.
	                      unsorted: one copyWithin splices all k into
	                      base_ris before the row at i; pos_col: pos values
	                      spaced between the neighbors'. sorted: one
	                      copyWithin splices them into sorted_ris before the
	                      row at i, and the nav appends them to base_ris;
	                      pos_col: pos values after all siblings. merge them
	                      into the indexes; changed_n += k; stages 3-5
	delete k rows         is_removed = 1 on the rows; tree view or grouped: on
	                      their subtrees too (desc_count + 1 entries of
	                      tree_ris). a group row is never marked: removing it
	                      marks the rows under it. a row with no_remove stays,
	                      and so do its ancestors. marked rows stay visible.
	                      changed_n +1 per row that was clean. new rows: drop
	                      rows
	undelete k rows       clear is_removed on marked rows and on their
	                      marked ancestors; changed_n -1 per row that
	                      becomes clean
	update cell           refused on readonly cells (the server marks pk cells
	                      readonly), on id, parent_id and pos_col cells, on
	                      key cells while grouped, and on rows with
	                      no_change. write input_vals[fi][ri]; set its
	                      changed_mask bit; back to the server value: clear
	                      the bit instead. validate cell; row clean before
	                      the edit: changed_n += 1; is_pass = 1. O(1), no
	                      stage runs
	revert cell           clear its changed_mask bit; clear its input_vals
	                      and cell_errors entries; row clean now:
	                      changed_n -= 1
	revert row            new row: drop rows. else: revert each edited cell
	revert all            scan base_ris for changed rows: new: drop rows, all
	                      in one pass; others: undelete and revert row. then
	                      drop all input_vals and cell_errors arrays. O(n)
	validate cell         on update cell: run the column's validator on the
	                      value; error: write cell_errors[fi][ri], else
	                      clear it; is_invalid = any cell or row error
	validate row          when the focus leaves an edited or new row, and in
	                      save: row rules, plus the pk check (the pk index
	                      holds the row's pk with another ri: duplicate);
	                      errors to row_errors[ri]; is_invalid as above
	lookup cols vals      binary search in the index on cols, built on the
	                      first lookup -> ri, or none. O(log n)
	merge rowset          on reload, with the rowset sent per column as at
	                      load: match each incoming row by the pk
	                      index. found: write its column cells and re-key
	                      its other index entries; edited cells keep
	                      input_vals, and a cell whose input value now
	                      equals its column value stops counting as edited;
	                      row clean now: changed_n -= 1.
	                      not found: append it to base_ris and sorted_ris as
	                      a saved row and merge it into the indexes. tree navs:
	                      parent_ri of the merged rows through the id index.
	                      one pass over base_ris drops the rows not matched
	                      and not new; stages 3-5
	collapse/expand       set or clear is_collapsed on the row, and with
	                      recursive on its subtree too; stage 5
	collapse/expand all   set or clear is_collapsed on the roots, or with
	                      recursive on every row; stage 5
	tree/flat view        stages 3-5
	group by levels       refused in tree view, and while a row has an edited
	                      cell in a key column (the scan below reads the
	                      columns, not input_vals); unknown and non-groupable
	                      columns are ignored. a level's key is its column's
	                      cell, or for a ranged column ('col[/offset]
	                      [/unit]/freq') the cell's bucket: a number step, or
	                      the month or year of a date. sort data rows by the
	                      level keys into a temporary array; one scan opens a
	                      group at each level where a key differs from the
	                      previous row's. the nav gives each group a slot:
	                      is_group = 1, key cells written (the bucket's first
	                      value for ranged columns), null in the other cells,
	                      is_pass = 0, parent_ri = enclosing group. each data
	                      row: parent_ri = innermost group. group_ris = group
	                      slots in key order; stages 3-5. a group row's label
	                      comes from its key cells and its level's range
	ungroup               group slots to free_ris; group_ris emptied; tree
	                      navs: parent_ri rebuilt from the parent_id cells
	                      through the id index; other navs: parent_ri =
	                      NONE; stages 3-5
	move k rows to i      only while unsorted, unfiltered and ungrouped, and
	                      not in flat view of a tree nav. a same-parent move
	                      needs pos_col; a parent change needs the
	                      can_change_parent option and a writable
	                      parent_id, and the new parent can't be new, marked
	                      for deletion or in the moved subtrees. rows:
	                      consecutive siblings; stage 3 puts their
	                      descendants under them. one compaction pass takes
	                      them out of base_ris; one copyWithin puts them
	                      before the row at i. new parent given by the grid:
	                      write parent_ri and the parent_id cells. pos_col:
	                      new pos values spaced between the neighbors'; no
	                      gap left: renumber that sibling list 1..m. pos and
	                      parent_id go in as edits (input_vals) on saved
	                      rows, into the columns on new rows; stages 3-5
	select all            rectangle from the first to the last visible cell;
	                      focus the first cell
	select none           sel_mask.fill(0); no rectangle
	extend selection      move the rectangle's end cell. O(1)
	new selection         write the rectangle into sel_mask: turn its visible
	                      columns into fi bits and OR them into each of its
	                      rows, O(rows in it); start a new rectangle
	iterate selection     one pass over sel_mask, plus the rectangle. O(n).
	                      set null on selected cells, delete selected rows
	                      and move selected rows use it
	render cell           selected: bit fi set in sel_mask, or inside the
	                      rectangle by visible_i and visible column position
	hide column           clear bit fi in every row's sel_mask
	focus up/down         visible_ris[visible_i[focused_ri] -+ 1], skipping
	                      rows with no_focus
	quicksearch s         from a start row, walk visible_ris for the first
	                      row whose cell text starts with s; focus it.
	                      O(visible rows)
	drop rows             one compaction pass over base_ris and sorted_ris;
	                      changed_n -1 per changed row dropped; remove the
	                      rows from the indexes and clear their input_vals,
	                      cell_errors and row_errors entries; slots to
	                      free_ris; groups left without rows: freed and
	                      dropped from group_ris; stages 3-5
	save                  scan tree_ris backwards for changed rows, skipping
	                      rows that fail validate row: new rows with all
	                      cells and ri as client key; changed rows with pk
	                      and the cells in changed_mask; removed rows with
	                      pk. in tree view the backward scan sends children
	                      before their parents. O(n)
	save ack              write the server's ids and pks into the cells; copy
	                      the saved rows' input_vals into the columns and
	                      clear them; re-key the indexes for cells that
	                      changed; clear is_new and changed_mask of the saved
	                      rows, changed_n -1 per row that becomes clean;
	                      removed rows: drop rows. changed_n 0: drop all
	                      input_vals and cell_errors arrays

IMPLEMENTATION PLAN

Each step adds its ops to js/tests/nav-bench/nav2_bench.js, to compare them
with the same ops on ui_nav.js (nav_bench.js).

	step  content                                       bench ops
	----  --------------------------------------------  ----------------------
	1     column storage, column-major load, base_ris,  init
	      stage 5 on flat navs
	2     stage 2: radix sort by columns, cmp sort,     sort, unsort, build
	      unsort; indexes as sorted ri arrays, lookup   pk index, lookup
	3     filter: is_pass, stages 4-5                   filter, unfilter
	4     focus and selection: sel_mask, rectangle,     focus, select all,
	      iterate selection                             select none, extend
	                                                    selection
	5     edits: input_vals, changed_mask, changed_n,   update cell
	      validate cell and row, revert
	6     capacity growth, insert, delete, undelete,    insert, remove
	      drop rows, free_ris, index upkeep, setter
	      for the row config flags (no_focus, ...)
	7     tree: id index, parent_ri, stages 3-4,        tree init, collapse/
	      collapse/expand, tree/flat view               expand one and all,
	                                                    tree sort and filter
	8     group by with ranged levels, ungroup          group by, collapse/
	                                                    expand all groups,
	                                                    ungroup
	9     move, sparse pos, pos order at load           move
	10    quicksearch, set null on selection            quicksearch
	11    save, save ack, merge rowset                  -
	12    grid integration: ui_grid.js reads the nav    -
	      through e.rows and row objects today. also:
	      row-select mode (can_focus_cells: false),
	      the search for a focusable cell, editing,
	      group labels

*/

;(function () {
"use strict"
const ui = window.ui

const {
	assign, assert, isfunc, isstr, isarray, words, map, S, warn, num, floor,
	month, year,
} = glue

const NONE = 0xFFFFFFFF

// row_flags bits.
const ROW_COLLAPSED = 2**0  // row is collapsed
const ROW_PASS      = 2**1  // row passes current filters
const ROW_PASS_DESC = 2**2  // at list 1 descendant passes current filters
const ROW_INVALID   = 2**3  // row or one of its cells failed validation
const ROW_NEW       = 2**4  // inserted, not saved yet
const ROW_REMOVED   = 2**5  // marked for deletion
const ROW_NO_FOCUS  = 2**6  // row can't be focused
const ROW_NO_CHANGE = 2**7  // row's cells can't be edited
const ROW_NO_REMOVE = 2**8  // row can't be deleted
const ROW_NO_SAVE   = 2**9  // row is never saved
const ROW_GROUP     = 2**10 // row is a synthetic group row

// row config flags by the names set_row_flag() takes.
let row_config_bits = {
	no_focus : ROW_NO_FOCUS,
	no_change: ROW_NO_CHANGE,
	no_remove: ROW_NO_REMOVE,
	no_save  : ROW_NO_SAVE,
}

let group_level_sep_re = /\s*>\s*/ // between group-by levels
let last_segment_re = /\/[^\/]+$/ // '/...' at the end of a ranged column

// the bucket function of a range {freq:, unit:, offset:}: v -> the bucket's
// first value; null: no range. unit: none (number buckets), 'month', 'year'.
function range_bucket_func(range) {
	let freq = range.freq
	let unit = range.unit
	if (unit && freq == null)
		freq = 1
	let offset = range.offset || 0
	let bucket_func = null
	if (freq) {
		if (!unit)
			bucket_func = v => (floor((v - offset) / freq) + offset) * freq
		else if (unit == 'month')
			bucket_func = v => month(v, offset)
		else if (unit == 'year')
			bucket_func = v => year(v, offset)
	}
	return bucket_func
}

// set or clear the mask bits of a[i], a: any typed array.
function set_bits(a, i, mask, on) {
	a[i] = on ? a[i] | mask : a[i] & ~mask
}

// a copy of typed array a with room for n entries.
function grow_typed(a, n) {
	let a1 = new a.constructor(n)
	a1.set(a)
	return a1
}

// insert ris[0..k) into list at index i, list holding len entries.
// -> list, or a bigger copy when list has no room.
function insert_into_list(list, len, i, ris, k) {
	if (len + k > list.length)
		list = grow_typed(list, Math.max(len + k, list.length * 2))
	list.copyWithin(i + k, i, len)
	list.set(ris.subarray(0, k), i)
	return list
}

// remove the entries of list[0..len) whose row has is_dropped set.
// -> the new length.
function compact_list(list, len, is_dropped) {
	let j = 0 // next index to write
	for (let i = 0; i < len; i++)
		if (!is_dropped[list[i]])
			list[j++] = list[i]
	return j
}

function pk_labels(e) {
	return e.pk_fields.map(field => field.label).join(' + ')
}

// the nav's own row rule. ui_nav.js registers a global 'pk' rule that takes
// ui_nav rows, so nav2's row validator uses only its own rules.
let pk_rule = {
	name     : 'pk',
	applies  : (e) => e.pk,
	validate : (e, ri) => {
		let vals = e.pk_fields.map(field => e.cell_val(ri, field.fi))
		// a pk with nulls in it is not checked.
		if (vals.includes(null))
			return true
		let found_ri = e.lookup(e.pk, vals)
		return found_ri == null || found_ri == ri
	},
	error    : (e) => S('validation_pk_message', '{0} is not unique',
		pk_labels(e)),
	rule     : (e) => S('validation_pk_rule', '{0} must be unique',
		pk_labels(e)),
}

ui.nav2 = function(opt) {

	let e = assign({}, opt)

	// 'col1 col2 ...' -> [field1, ...]
	function col_fields(cols) {
		return words(cols).map(col =>
			assert(e.all_fields_map[col], 'unknown column: ', col))
	}

	/// radix sort ------------------------------------------------------------

	// LSD radix sort of ris[0..n) with 16-bit digits, by sort_fields (each
	// {field:, desc:, [col:]}), last field first. stable: equal keys keep
	// their order in ris. ris is used as scratch. -> sorted ri's, ris or a new
	// array.
	function radix_sort(ris, n, sort_fields) {
		let ris1 = new Uint32Array(n) // scatter target for ris
		let keys  = [new Uint32Array(n), new Uint32Array(n)] // key words by ris
		let keys1 = [new Uint32Array(n), new Uint32Array(n)] // scatter targets
		let counts = new Uint32Array(65536) // rows per digit value
		for (let sfi = sort_fields.length - 1; sfi >= 0; sfi--) {
			// col: a column to sort by instead of the field's, e.g. buckets.
			let {field, desc, col} = sort_fields[sfi]
			let word_n = field.col_storage.write_sort_keys(
				col ?? e.col_vals[field.fi], ris, n, field, keys[0], keys[1])
			// desc: inverted keys sort backwards, so null comes last.
			if (desc)
				for (let w = 0; w < word_n; w++) {
					let k = keys[w]
					for (let i = 0; i < n; i++)
						k[i] = ~k[i]
				}
			// least significant word and digit first.
			for (let w = 0; w < word_n; w++) {
				for (let shift = 0; shift <= 16; shift += 16) {
					let k = keys[w]
					counts.fill(0)
					for (let i = 0; i < n; i++)
						counts[(k[i] >>> shift) & 0xFFFF]++
					// all rows have the same digit: the pass would move nothing.
					if (counts[(k[0] >>> shift) & 0xFFFF] == n)
						continue
					let sum = 0 // rows with smaller digits
					for (let d = 0; d < 65536; d++) {
						let c = counts[d]
						counts[d] = sum
						sum += c
					}
					// move ris and the key words still to be read (w and up).
					for (let i = 0; i < n; i++) {
						let j = counts[(k[i] >>> shift) & 0xFFFF]++ // target index
						ris1[j] = ris[i]
						for (let w2 = w; w2 < word_n; w2++)
							keys1[w2][j] = keys[w2][i]
					}
					let t = ris; ris = ris1; ris1 = t
					for (let w2 = w; w2 < word_n; w2++) {
						let t = keys[w2]; keys[w2] = keys1[w2]; keys1[w2] = t
					}
				}
			}
		}
		return ris
	}

	/// sorting ---------------------------------------------------------------

	// order_by: 'col1[:desc] ...' -> [{field:, desc:}, ...], without unknown
	// and non-sortable columns.
	function parse_order_by(order_by) {
		let sort_fields = []
		for (let s of words(order_by)) {
			let [col, dir] = s.split(':')
			assert(dir == null || dir == 'asc' || dir == 'desc',
				'invalid sort direction: ', dir)
			let field = e.all_fields_map[col]
			if (field?.sortable)
				sort_fields.push({field: field, desc: dir == 'desc'})
		}
		return sort_fields
	}

	// changed rows first, in base_ris order, then the other rows of sorted_ris
	// in their order. -> a new array, or sorted_ris when no row is changed.
	function move_changed_rows_first(sorted_ris) {
		if (!e.changed_n)
			return sorted_ris
		let n = e.row_n
		let ris = new Uint32Array(n) // result
		let j = 0 // next index into ris
		for (let i = 0; i < n; i++)
			if (is_row_changed(e.base_ris[i]))
				ris[j++] = e.base_ris[i]
		for (let i = 0; i < n; i++)
			if (!is_row_changed(sorted_ris[i]))
				ris[j++] = sorted_ris[i]
		return ris
	}

	// stage 2. order_by: 'col1[:desc] ...' | cmp(ri1, ri2) | null (unsorted).
	// changed rows don't take part in a sort: they come first, in base_ris
	// order.
	e.set_order_by = function(order_by) {
		let sort_fields = isstr(order_by) ? parse_order_by(order_by) : null
		if (isfunc(order_by)) {
			e.order_by = order_by // sort columns or sort function; null: none
			e.sorted_ris = move_changed_rows_first(
				e.base_ris.slice(0, e.row_n).sort(order_by))
		} else if (sort_fields?.length) {
			e.order_by = order_by
			e.sorted_ris = move_changed_rows_first(radix_sort(
				e.base_ris.slice(0, e.row_n), e.row_n, sort_fields))
		} else { // null, or no sortable column given: unsorted.
			e.order_by = null
			e.sorted_ris = e.base_ris
		}
		update_tree_and_visible_ris()
	}

	/// filtering -------------------------------------------------------------

	// fn(ri) -> true|false, or null to show every row. changed rows always
	// pass until saved.
	e.set_filter = function(fn) {
		e.filter = fn // filter function, or null
		let row_flags = e.row_flags
		let ris = e.base_ris
		let has_changes = e.changed_n > 0
		for (let i = 0; i < e.row_n; i++) {
			let ri = ris[i]
			set_bits(row_flags, ri, ROW_PASS,
				!fn || (has_changes && is_row_changed(ri)) || fn(ri))
		}
		update_pass_desc()
		update_visible_ris(true)
	}

	/// cell values and edits -------------------------------------------------

	// value last seen on the server.
	function col_val(ri, fi) {
		return e.all_fields[fi].col_storage.get(e.col_vals[fi], ri)
	}

	// changed_mask bit of cell (ri, fi).
	function changed_bit(ri, fi) {
		return e.changed_mask[ri * e.mask_word_n + (fi >>> 5)]
			& (1 << (fi & 31))
	}

	function set_changed_bit(ri, fi, on) {
		set_bits(e.changed_mask, ri * e.mask_word_n + (fi >>> 5),
			1 << (fi & 31), on)
	}

	// new, removed or edited, and saved at all.
	function is_row_changed(ri) {
		let flags = e.row_flags[ri]
		if (flags & ROW_NO_SAVE)
			return false
		if (flags & (ROW_NEW | ROW_REMOVED))
			return true
		let word_n = e.mask_word_n
		for (let w = ri * word_n, w2 = w + word_n; w < w2; w++)
			if (e.changed_mask[w])
				return true
		return false
	}

	// count the row in or out of changed_n after a change to it.
	function update_changed_n(ri, was_changed) {
		let is_changed = is_row_changed(ri)
		if (is_changed != was_changed)
			e.changed_n += is_changed ? 1 : -1
	}

	function same_val(field, v1, v2) {
		let compare = field.compare_vals
		return compare ? !compare(v1, v2, field) : v1 === v2
	}

	// the cell's value: the edited value if the cell is edited, else the
	// value last seen on the server.
	e.cell_val = function(ri, fi) {
		return changed_bit(ri, fi) ? e.input_vals[fi][ri] : col_val(ri, fi)
	}

	// -> [result1, ...] with .failed, as the field's validator reports them.
	function validate_cell(field, v) {
		let errors = []
		errors.failed = !field.validator.validate(v)
		for (let result of field.validator.results)
			errors.push(assign({}, result))
		return errors
	}

	// is_invalid: a cell of the row or the row itself failed validation.
	function update_invalid(ri) {
		let invalid = !!e.row_errors[ri]
		for (let fi = 0; !invalid && fi < e.all_fields.length; fi++)
			invalid = !!e.cell_errors[fi]?.[ri]
		set_bits(e.row_flags, ri, ROW_INVALID, invalid)
	}

	// a parsed v is stored parsed; text that doesn't parse is stored as typed.
	// a cell set back to its server value stops counting as edited.
	e.set_cell_val = function(ri, fi, v) {
		let field = e.all_fields[fi]
		if (field.readonly || e.row_flags[ri] & (ROW_NO_CHANGE | ROW_GROUP))
			return
		// a row's key cells decide its group.
		if (e.is_grouped && e.group_fis.has(fi))
			return
		let errors = validate_cell(field, v)
		if (!field.validator.parse_failed)
			v = field.validator.value
		if (same_val(field, v, e.cell_val(ri, fi)))
			return
		let was_changed = is_row_changed(ri)
		if (same_val(field, v, col_val(ri, fi))) {
			set_changed_bit(ri, fi, false)
			e.input_vals[fi][ri] = undefined
		} else {
			set_changed_bit(ri, fi, true)
			e.input_vals[fi] ??= [] // made on the column's first edit
			e.input_vals[fi][ri] = v
		}
		if (errors.failed) {
			e.cell_errors[fi] ??= [] // made on the column's first error
			e.cell_errors[fi][ri] = errors
		} else if (e.cell_errors[fi]) {
			e.cell_errors[fi][ri] = undefined
		}
		e.row_errors[ri] = undefined
		update_invalid(ri)
		update_changed_n(ri, was_changed)
		// an edited row stays visible until the next filter.
		set_bits(e.row_flags, ri, ROW_PASS, true)
	}

	// -> true if the cell was a pos or parent_id cell, so the row's place
	// in base_ris or its parent_ri no longer matches its cells.
	function revert_cell_val(ri, fi) {
		if (!changed_bit(ri, fi))
			return false
		let was_changed = is_row_changed(ri)
		set_changed_bit(ri, fi, false)
		e.input_vals[fi][ri] = undefined
		if (e.cell_errors[fi])
			e.cell_errors[fi][ri] = undefined
		update_invalid(ri)
		update_changed_n(ri, was_changed)
		return fi == e.pos_field?.fi || fi == e.parent_field?.fi
	}

	// -> true if the row's place changed, see revert_cell_val().
	function revert_row_vals(ri) {
		e.row_errors[ri] = undefined
		let is_moved = false
		for (let fi = 0; fi < e.all_fields.length; fi++)
			if (revert_cell_val(ri, fi))
				is_moved = true
		update_invalid(ri)
		return is_moved
	}

	e.revert_cell = function(ri, fi) {
		if (revert_cell_val(ri, fi)) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// a new row is dropped; any other row gets its server values back.
	e.revert_row = function(ri) {
		if (e.row_flags[ri] & ROW_NEW) {
			drop_rows([ri])
		} else if (revert_row_vals(ri)) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// new rows are dropped, removed rows unmarked, edited cells reverted.
	e.revert_changes = function() {
		let new_ris = [] // new rows, dropped in one pass at the end
		let moved_ris = [] // rows whose pos or parent_id was reverted
		for (let i = 0; i < e.row_n; i++) {
			let ri = e.base_ris[i]
			if (!is_row_changed(ri))
				continue
			if (e.row_flags[ri] & ROW_NEW) {
				new_ris.push(ri)
			} else {
				e.remove_rows([ri], 'undelete')
				if (revert_row_vals(ri))
					moved_ris.push(ri)
			}
		}
		if (moved_ris.length)
			update_row_places(moved_ris)
		if (new_ris.length)
			drop_rows(new_ris)
		else if (moved_ris.length)
			update_tree_and_visible_ris()
		e.input_vals = [] // per fi: sparse Array of edited values by ri
		e.cell_errors = [] // per fi: sparse Array of failed results by ri
	}

	// put rows back in place after their pos or parent_id cell changed:
	// parent_ri from the parent_id value through the id index, and base_ris
	// sorted by pos again, which puts every pos list in pos order. the sort
	// reads edited pos values too: the code writes pos edits, always numbers.
	function update_row_places(ris) {
		if (e.can_be_tree) {
			let parent_fi = e.parent_field.fi
			for (let ri of ris) {
				let parent_id = e.cell_val(ri, parent_fi)
				e.parent_ri[ri] = parent_id != null
					? e.lookup(e.id_field.name, [parent_id]) ?? NONE : NONE
			}
		}
		if (!e.pos_field)
			return
		let field = e.pos_field
		let col = e.col_vals[field.fi]
		if (e.input_vals[field.fi]) {
			col = col.slice() // pos with the edited values written in
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (changed_bit(ri, field.fi))
					field.col_storage.set(col, ri, e.input_vals[field.fi][ri])
			}
		}
		let was_unsorted = e.sorted_ris == e.base_ris
		e.base_ris = radix_sort(e.base_ris, e.row_n,
			[{field: field, desc: false, col: col}])
		if (was_unsorted)
			e.sorted_ris = e.base_ris
	}

	/// slots, inserting and removing -----------------------------------------

	// every ri-indexed array grows to cap slots, keeping its contents.
	function set_capacity(cap) {
		let word_n = e.mask_word_n
		e.col_vals = e.all_fields.map(field =>
			field.col_storage.grow_col(e.col_vals[field.fi], cap))
		e.row_flags        = grow_typed(e.row_flags       , cap)
		e.parent_ri        = grow_typed(e.parent_ri       , cap)
		e.first_child_ri   = grow_typed(e.first_child_ri  , cap)
		e.next_sibling_ri  = grow_typed(e.next_sibling_ri , cap)
		e.depth            = grow_typed(e.depth           , cap)
		e.desc_count       = grow_typed(e.desc_count      , cap)
		e.tree_i           = grow_typed(e.tree_i          , cap)
		tree_ris_buf       = grow_typed(tree_ris_buf      , cap)
		e.visible_i        = grow_typed(e.visible_i       , cap)
		e.visible_ris      = grow_typed(e.visible_ris     , cap)
		e.prev_visible_ris = grow_typed(e.prev_visible_ris, cap)
		e.sel_mask         = grow_typed(e.sel_mask        , cap * word_n)
		e.changed_mask     = grow_typed(e.changed_mask    , cap * word_n)
		e.cap = cap
	}

	// a slot for a new row, a freed one first, with its entries reset.
	function alloc_slot() {
		let ri
		if (e.free_ris.length) {
			ri = e.free_ris.pop()
		} else {
			if (e.slot_n == e.cap)
				set_capacity(Math.max(1, e.cap * 2))
			ri = e.slot_n++
		}
		let word_n = e.mask_word_n
		e.row_flags[ri] = 0
		e.parent_ri[ri] = NONE
		e.desc_count[ri] = 0
		e.sel_mask.fill(0, ri * word_n, (ri + 1) * word_n)
		e.changed_mask.fill(0, ri * word_n, (ri + 1) * word_n)
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			if (e.input_vals[fi])
				e.input_vals[fi][ri] = undefined
			if (e.cell_errors[fi])
				e.cell_errors[fi][ri] = undefined
		}
		e.row_errors[ri] = undefined
		return ri
	}

	// rows: [[v1, ...] | null, ...] in fi order; undefined or a null row: the
	// field's client_default.
	// at_ri: insert before this row; null: at the end. -> the new rows' ri's.
	// unsorted: the rows go into base_ris at that place. sorted: they go into
	// sorted_ris at that place and at the end of base_ris. tree navs: the rows
	// become siblings of at_ri. grouped: the rows join at_ri's group and get
	// its key cells; at_ri must be a data row. refused under a new row (it has
	// no id yet) or a row marked for deletion: -> no ri's.
	e.insert_rows = function(rows, at_ri) {
		let none = new Uint32Array(0) // refused: no rows
		let parent_ri = NONE // the new rows' parent_ri: tree parent or group
		let tree_parent_ri = NONE // the new rows' tree parent
		if (e.is_grouped) {
			if (at_ri == null || e.row_flags[at_ri] & ROW_GROUP)
				return none
			parent_ri = e.parent_ri[at_ri]
			let parent_id = e.can_be_tree
				? col_val(at_ri, e.parent_field.fi) : null
			if (parent_id != null)
				tree_parent_ri = e.lookup(e.id_field.name, [parent_id]) ?? NONE
		} else if (e.can_be_tree && at_ri != null) {
			parent_ri = e.parent_ri[at_ri]
			tree_parent_ri = parent_ri
		}
		if (tree_parent_ri != NONE
			&& e.row_flags[tree_parent_ri] & (ROW_NEW | ROW_REMOVED)
		) {
			return none
		}
		let parent_id = tree_parent_ri != NONE
			? col_val(tree_parent_ri, e.id_field.fi) : null
		let k = rows.length
		let ris = new Uint32Array(k) // the new rows' slots
		for (let i = 0; i < k; i++) {
			let ri = alloc_slot()
			ris[i] = ri
			for (let field of e.all_fields) {
				let v = rows[i]?.[field.fi]
				if (v === undefined) {
					v = field.client_default
					if (isfunc(v))
						v = v()
				}
				field.col_storage.set(e.col_vals[field.fi], ri, v ?? null)
			}
			e.row_flags[ri] = ROW_NEW | ROW_PASS
			e.parent_ri[ri] = parent_ri
			if (e.can_be_tree) {
				let parent_field = e.parent_field
				parent_field.col_storage.set(e.col_vals[parent_field.fi], ri,
					parent_id)
			}
			// a raw key value copied from a row of the group stays in the
			// group's bucket.
			if (e.is_grouped)
				for (let fi of e.group_fis) {
					let field = e.all_fields[fi]
					field.col_storage.set(e.col_vals[fi], ri, col_val(at_ri, fi))
				}
		}
		let n = e.row_n
		let base_i // where the new rows went in base_ris
		if (e.sorted_ris == e.base_ris) {
			base_i = at_ri == null ? n : list_index(e.base_ris, n, at_ri)
			e.base_ris = insert_into_list(e.base_ris, n, base_i, ris, k)
			e.sorted_ris = e.base_ris
		} else {
			let i = at_ri == null ? n : list_index(e.sorted_ris, n, at_ri)
			e.sorted_ris = insert_into_list(e.sorted_ris, n, i, ris, k)
			base_i = n
			e.base_ris = insert_into_list(e.base_ris, n, base_i, ris, k)
		}
		e.row_n += k
		e.changed_n += k
		if (e.pos_field)
			place_pos(base_i, k)
		add_to_indexes(ris)
		update_tree_and_visible_ris()
		return ris
	}

	/// positions -------------------------------------------------------------

	// write v into cell (ri, fi) without set_cell_val()'s refusals and
	// validation, for the pos and parent_id cells that moves write. a new
	// row's cells are its columns; a saved row's are edits.
	function write_cell(ri, fi, v) {
		let field = e.all_fields[fi]
		if (e.row_flags[ri] & ROW_NEW) {
			field.col_storage.set(e.col_vals[fi], ri, v)
		} else {
			let was_changed = is_row_changed(ri)
			if (same_val(field, v, col_val(ri, fi))) {
				set_changed_bit(ri, fi, false)
				if (e.input_vals[fi])
					e.input_vals[fi][ri] = undefined
			} else {
				set_changed_bit(ri, fi, true)
				e.input_vals[fi] ??= [] // made on the column's first edit
				e.input_vals[fi][ri] = v
			}
			update_changed_n(ri, was_changed)
		}
	}

	// pos orders the rows of one list: all rows, or in a tree nav the rows
	// with the same parent_id.
	function same_pos_list(ri1, ri2) {
		if (!e.can_be_tree)
			return true
		let field = e.parent_field
		return same_val(field, e.cell_val(ri1, field.fi),
			e.cell_val(ri2, field.fi))
	}

	// the k rows at base_ris[i ..] get pos values spread evenly between the
	// pos of their list neighbors in base_ris, or after the previous one, or
	// before the next one. no value strictly in between left (the doubles ran
	// out after many inserts at one spot): renumber the list 1..m.
	function place_pos(i, k) {
		let pos_fi = e.pos_field.fi
		let ris = e.base_ris
		let ri = ris[i]
		let pos1 = null // pos of the previous row of the list
		let pos2 = null // pos of the next row of the list
		for (let j = i - 1; j >= 0 && pos1 == null; j--)
			if (same_pos_list(ris[j], ri))
				pos1 = e.cell_val(ris[j], pos_fi)
		for (let j = i + k; j < e.row_n && pos2 == null; j++)
			if (same_pos_list(ris[j], ri))
				pos2 = e.cell_val(ris[j], pos_fi)
		let vals = [] // the new pos values, in order
		for (let j = 1; j <= k; j++)
			vals.push(pos1 != null && pos2 != null
				? pos1 + (pos2 - pos1) * j / (k + 1)
				: pos1 != null ? pos1 + j
				: pos2 != null ? pos2 - (k + 1 - j)
				: j)
		let fits = (pos1 == null || vals[0] > pos1)
			&& (pos2 == null || vals[k - 1] < pos2)
		for (let j = 1; fits && j < k; j++)
			fits = vals[j] > vals[j - 1]
		if (fits) {
			for (let j = 0; j < k; j++)
				write_cell(ris[i + j], pos_fi, vals[j])
		} else {
			let m = 0 // pos of the last renumbered row
			for (let j = 0; j < e.row_n; j++)
				if (same_pos_list(ris[j], ri))
					write_cell(ris[j], pos_fi, ++m)
		}
	}

	// moving: unsorted, unfiltered, ungrouped, and in a tree nav only in tree
	// view. ris: siblings, each moving with its subtree. a same-parent move
	// needs pos_col; a parent change needs the can_change_parent option and a
	// writable parent_id. the new parent can't be a new row, a row marked for
	// deletion or a row of the moved subtrees.
	e.can_move_rows = function(ris, parent_ri) {
		if (e.order_by || e.filter || e.is_grouped)
			return false
		if (e.can_be_tree && !e.is_tree)
			return false
		let old_parent_ri = e.parent_ri[ris[0]]
		for (let ri of ris)
			if (e.parent_ri[ri] != old_parent_ri)
				return false
		if (parent_ri == old_parent_ri)
			return !!e.pos_field
		if (!e.is_tree || !e.can_change_parent || e.parent_field.readonly)
			return false
		if (parent_ri != NONE) {
			if (e.row_flags[parent_ri] & (ROW_NEW | ROW_REMOVED))
				return false
			for (let p = parent_ri; p != NONE; p = e.parent_ri[p])
				if (ris.includes(p))
					return false
		}
		return true
	}

	// put ris before at_ri under parent_ri (NONE: the roots); at_ri null: at
	// the end of parent_ri's children. moved rows get pos values between
	// their new neighbors. -> false if refused, see can_move_rows().
	e.move_rows = function(ris, at_ri, parent_ri) {
		if (!e.can_move_rows(ris, parent_ri))
			return false
		let k = ris.length
		let is_moved = new Uint8Array(e.cap) // 1: row being moved
		for (let ri of ris)
			is_moved[ri] = 1
		let n = compact_list(e.base_ris, e.row_n, is_moved)
		// descendants stay where they are: stage 3 puts them under the rows.
		let i = at_ri == null ? n : list_index(e.base_ris, n, at_ri)
		e.base_ris = insert_into_list(e.base_ris, n, i,
			Uint32Array.from(ris), k)
		e.sorted_ris = e.base_ris
		if (parent_ri != e.parent_ri[ris[0]]) {
			let parent_id = parent_ri != NONE
				? col_val(parent_ri, e.id_field.fi) : null
			for (let ri of ris) {
				e.parent_ri[ri] = parent_ri
				write_cell(ri, e.parent_field.fi, parent_id)
			}
		}
		if (e.pos_field)
			place_pos(i, k)
		update_tree_and_visible_ris()
		return true
	}

	// index of ri in list[0..len).
	function list_index(list, len, ri) {
		let i = list.subarray(0, len).indexOf(ri)
		assert(i >= 0, 'row not in the nav: ', ri)
		return i
	}

	// rows out of every list and index for good; their slots go to free_ris.
	function drop_rows(ris) {
		let is_dropped = new Uint8Array(e.cap) // 1: row being dropped
		for (let ri of ris)
			is_dropped[ri] = 1
		let n = compact_list(e.base_ris, e.row_n, is_dropped)
		if (e.sorted_ris != e.base_ris)
			compact_list(e.sorted_ris, e.row_n, is_dropped)
		e.row_n = n
		for (let index of e.indexes.values())
			index.ris = index.ris.subarray(0,
				compact_list(index.ris, index.ris.length, is_dropped))
		for (let ri of ris) {
			if (is_row_changed(ri))
				e.changed_n--
			e.free_ris.push(ri)
		}
		if (e.is_grouped)
			drop_empty_groups()
		update_tree_and_visible_ris()
	}

	// free the groups left without rows. group_ris lists a group before its
	// subgroups, so walking it backwards counts a group's subgroups first.
	function drop_empty_groups() {
		let child_n = new Uint32Array(e.cap) // kept children by group
		for (let i = 0; i < e.row_n; i++)
			child_n[e.parent_ri[e.base_ris[i]]]++
		let is_dropped = new Uint8Array(e.cap) // 1: group being dropped
		for (let i = e.group_ris.length - 1; i >= 0; i--) {
			let ri = e.group_ris[i]
			let p = e.parent_ri[ri]
			if (!child_n[ri]) {
				is_dropped[ri] = 1
				e.free_ris.push(ri)
			} else if (p != NONE) {
				child_n[p]++
			}
		}
		e.group_ris = e.group_ris.subarray(0,
			compact_list(e.group_ris, e.group_ris.length, is_dropped))
	}

	// mark the row for deletion; a new row goes to new_ris, to be dropped.
	// a group row is not a real row: it is never marked. -> false if the row
	// has no_remove.
	function mark_removed(ri, new_ris) {
		let flags = e.row_flags[ri]
		if (flags & ROW_NO_REMOVE)
			return false
		if (flags & ROW_GROUP)
			return true
		if (flags & ROW_NEW) {
			new_ris.push(ri)
		} else {
			let was_changed = is_row_changed(ri)
			set_bits(e.row_flags, ri, ROW_REMOVED, true)
			update_changed_n(ri, was_changed)
		}
		return true
	}

	function unmark_removed(ri) {
		let was_changed = is_row_changed(ri)
		set_bits(e.row_flags, ri, ROW_REMOVED, false)
		update_changed_n(ri, was_changed)
	}

	// mark ri's subtree. a row with no_remove stays, and so do its ancestors:
	// walking the subtree backwards visits a row's descendants before the row.
	// is_kept: 1 for a row with a kept descendant.
	function mark_subtree_removed(ri, new_ris, is_kept) {
		let i1 = e.tree_i[ri] // the subtree in tree_ris: [i1 .. i2]
		let i2 = i1 + e.desc_count[ri]
		for (let i = i2; i >= i1; i--) {
			let ri1 = e.tree_ris[i]
			if (is_kept[ri1] || !mark_removed(ri1, new_ris)) {
				let parent_ri = e.parent_ri[ri1]
				if (parent_ri != NONE)
					is_kept[parent_ri] = 1
			}
		}
	}

	// unmark ri, its marked ancestors and its marked descendants, but not the
	// descendants under a row that isn't marked. group rows are not real rows:
	// the walk passes through them.
	function unmark_subtree_removed(ri) {
		let row_flags = e.row_flags
		if (!(row_flags[ri] & (ROW_REMOVED | ROW_GROUP)))
			return
		if (row_flags[ri] & ROW_REMOVED)
			unmark_removed(ri)
		for (let p = e.parent_ri[ri];
			p != NONE && row_flags[p] & ROW_REMOVED; p = e.parent_ri[p]
		) {
			unmark_removed(p)
		}
		let i2 = e.tree_i[ri] + e.desc_count[ri] // last index of the subtree
		for (let i = e.tree_i[ri] + 1; i <= i2; ) {
			let ri1 = e.tree_ris[i]
			if (row_flags[ri1] & (ROW_REMOVED | ROW_GROUP)) {
				if (row_flags[ri1] & ROW_REMOVED)
					unmark_removed(ri1)
				i++
			} else {
				i += e.desc_count[ri1] + 1
			}
		}
	}

	// op: 'delete' (default): mark the rows for deletion, and in tree view or
	// grouped their subtrees; new rows are dropped. 'undelete': clear the
	// marks. rows with no_remove are left alone.
	e.remove_rows = function(ris, op) {
		let has_parents = e.is_tree || e.is_grouped
		if (op == 'undelete') {
			for (let ri of ris)
				if (has_parents)
					unmark_subtree_removed(ri)
				else
					unmark_removed(ri)
		} else {
			let new_ris = [] // new rows to drop
			if (has_parents) {
				let is_kept = new Uint8Array(e.cap) // see mark_subtree_removed()
				for (let ri of ris)
					mark_subtree_removed(ri, new_ris, is_kept)
			} else {
				for (let ri of ris)
					mark_removed(ri, new_ris)
			}
			if (new_ris.length)
				drop_rows(new_ris)
		}
	}

	// name: 'no_focus' | 'no_change' | 'no_remove' | 'no_save'
	e.set_row_flag = function(ri, name, on) {
		let bit = assert(row_config_bits[name], 'unknown row flag: ', name)
		let was_changed = is_row_changed(ri)
		set_bits(e.row_flags, ri, bit, on)
		update_changed_n(ri, was_changed)
	}

	// row rules: the pk check. -> true if the row and its cells are valid.
	e.validate_row = function(ri) {
		if (e.row_validator.validate(ri)) {
			e.row_errors[ri] = undefined
		} else {
			let errors = [] // failed results, as validate_cell() reports them
			errors.failed = true
			for (let result of e.row_validator.results)
				errors.push(assign({}, result))
			e.row_errors[ri] = errors
		}
		update_invalid(ri)
		return !(e.row_flags[ri] & ROW_INVALID)
	}

	/// focus and selection ---------------------------------------------------

	// sel_mask bit of cell (ri, fi).
	function sel_bit(ri, fi) {
		return e.sel_mask[ri * e.mask_word_n + (fi >>> 5)] & (1 << (fi & 31))
	}

	function clear_sel_mask() {
		if (e.has_sel_bits) {
			e.sel_mask.fill(0)
			e.has_sel_bits = false
		}
	}

	function set_rect(anchor_ri, anchor_fi, end_ri, end_fi) {
		e.sel_anchor_ri = anchor_ri
		e.sel_anchor_fi = anchor_fi
		e.sel_end_ri = end_ri
		e.sel_end_fi = end_fi
	}

	// the rectangle's rows and columns as positions in visible_ris and fields.
	function rect_bounds() { // -> [row_i1, row_i2, col_i1, col_i2], inclusive
		let row_i1 = e.visible_i[e.sel_anchor_ri]
		let row_i2 = e.visible_i[e.sel_end_ri]
		let col_i1 = e.all_fields[e.sel_anchor_fi].index
		let col_i2 = e.all_fields[e.sel_end_fi].index
		return [
			Math.min(row_i1, row_i2), Math.max(row_i1, row_i2),
			Math.min(col_i1, col_i2), Math.max(col_i1, col_i2),
		]
	}

	// write the rectangle into sel_mask: its visible columns become fi bits,
	// OR-ed into each of its rows. O(rows in it).
	function commit_rect() {
		if (e.sel_anchor_ri == null)
			return
		let [row_i1, row_i2, col_i1, col_i2] = rect_bounds()
		let word_n = e.mask_word_n
		let col_mask = new Uint32Array(word_n) // fi bits of the columns
		for (let col_i = col_i1; col_i <= col_i2; col_i++) {
			let fi = e.fields[col_i].fi
			col_mask[fi >>> 5] |= 1 << (fi & 31)
		}
		let sel_mask = e.sel_mask
		for (let i = row_i1; i <= row_i2; i++) {
			let word_i = e.visible_ris[i] * word_n // first word of the row
			for (let w = 0; w < word_n; w++)
				sel_mask[word_i + w] |= col_mask[w]
		}
		e.has_sel_bits = true
		set_rect(null, null, null, null)
	}

	// select: null: select only the focused cell. 'expand': select from the
	// rectangle's anchor (or the focused cell) to (ri, fi). 'invert': toggle
	// (ri, fi), keep the rest. 'all': focus the first cell, select all.
	e.focus_cell = function(ri, fi, select) {
		if (select == 'all') {
			clear_sel_mask()
			let has_cells = e.visible_n > 0 && e.fields.length > 0
			ri = has_cells ? e.visible_ris[0] : null
			fi = has_cells ? e.fields[0].fi : null
			if (has_cells)
				set_rect(ri, fi, e.visible_ris[e.visible_n - 1],
					e.fields[e.fields.length - 1].fi)
			else
				set_rect(null, null, null, null)
		} else if (select == 'expand') {
			if (e.sel_anchor_ri != null)
				set_rect(e.sel_anchor_ri, e.sel_anchor_fi, ri, fi)
			else if (e.focused_ri != null)
				set_rect(e.focused_ri, e.focused_fi, ri, fi)
			else
				set_rect(ri, fi, ri, fi)
		} else if (select == 'invert') {
			commit_rect()
			let word_i = ri * e.mask_word_n + (fi >>> 5) // word of the cell
			e.sel_mask[word_i] ^= 1 << (fi & 31)
			e.has_sel_bits = true
		} else {
			clear_sel_mask()
			set_rect(ri, fi, ri, fi)
		}
		e.focused_ri = ri
		e.focused_fi = fi
	}

	// x is between a and b, inclusive, in either order.
	function between(x, a, b) {
		return a <= b ? x >= a && x <= b : x >= b && x <= a
	}

	e.is_cell_selected = function(ri, fi) {
		if (sel_bit(ri, fi))
			return true
		if (e.sel_anchor_ri == null || e.visible_i[ri] == NONE)
			return false
		let visible_i = e.visible_i
		let all_fields = e.all_fields
		return between(visible_i[ri],
				visible_i[e.sel_anchor_ri], visible_i[e.sel_end_ri])
			&& between(all_fields[fi].index,
				all_fields[e.sel_anchor_fi].index, all_fields[e.sel_end_fi].index)
	}

	// fn(ri) for each row with a selected cell, in display order. hidden rows
	// never have bits, so walking visible_ris finds them all.
	e.each_selected_row = function(fn) {
		commit_rect()
		if (!e.has_sel_bits)
			return
		let word_n = e.mask_word_n
		let sel_mask = e.sel_mask
		for (let i = 0; i < e.visible_n; i++) {
			let ri = e.visible_ris[i]
			for (let w = 0; w < word_n; w++)
				if (sel_mask[ri * word_n + w]) {
					fn(ri)
					break
				}
		}
	}

	/// indexes ---------------------------------------------------------------

	// -> {fields:, ris:}: the data rows' ri's sorted by cols; built on first
	// use.
	function get_index(cols) {
		let index = e.indexes.get(cols)
		if (!index) {
			let fields = col_fields(cols)
			let sort_fields = fields.map(field => ({field: field, desc: false}))
			index = {
				fields: fields, // [field1, ...]
				ris: radix_sort(e.base_ris.slice(0, e.row_n), e.row_n,
					sort_fields), // data rows' ri's, sorted by fields
			}
			e.indexes.set(cols, index)
		}
		return index
	}

	// order of row ri's cells in fields vs vals, in sort key order: -1|0|1
	function compare_row(ri, fields, vals) {
		for (let i = 0; i < fields.length; i++) {
			let field = fields[i]
			let r = field.col_storage.compare_cell(
				e.col_vals[field.fi], ri, vals[i], field)
			if (r)
				return r
		}
		return 0
	}

	// order of rows ri1 and ri2 by fields, in sort key order: -1|0|1
	function compare_rows(ri1, ri2, fields) {
		for (let field of fields) {
			let col = e.col_vals[field.fi]
			let r = field.col_storage.compare_cell(col, ri1,
				field.col_storage.get(col, ri2), field)
			if (r)
				return r
		}
		return 0
	}

	// index in ris (sorted by fields) after the last row with ri's key.
	function upper_bound(ris, ri, fields) {
		let i1 = 0 // first index into ris still in the search
		let i2 = ris.length // end index into ris of the search
		while (i1 < i2) {
			let i = (i1 + i2) >>> 1
			if (compare_rows(ris[i], ri, fields) <= 0)
				i1 = i + 1
			else
				i2 = i
		}
		return i1
	}

	// put the new rows ris into every index, after the rows with equal keys:
	// a binary search per new row, then one copy pass.
	function add_to_indexes(ris) {
		for (let index of e.indexes.values()) {
			let fields = index.fields
			let new_ris = Array.from(ris).sort(
				(ri1, ri2) => compare_rows(ri1, ri2, fields))
			let old_ris = index.ris
			let merged = new Uint32Array(old_ris.length + new_ris.length)
			let m = 0 // next index into merged
			let i1 = 0 // next index into old_ris to copy
			for (let ri of new_ris) {
				let i2 = upper_bound(old_ris, ri, fields)
				merged.set(old_ris.subarray(i1, i2), m)
				m += i2 - i1
				merged[m++] = ri
				i1 = i2
			}
			merged.set(old_ris.subarray(i1), m)
			index.ris = merged
		}
	}

	// -> ri of the first row whose cols hold vals, or null.
	e.lookup = function(cols, vals) {
		let {fields, ris} = get_index(cols)
		let i1 = 0 // first index into ris still in the search
		let i2 = ris.length // end index into ris of the search
		while (i1 < i2) {
			let i = (i1 + i2) >>> 1
			if (compare_row(ris[i], fields, vals) < 0)
				i1 = i + 1
			else
				i2 = i
		}
		return i1 < ris.length && compare_row(ris[i1], fields, vals) == 0
			? ris[i1] : null
	}

	/// grouping --------------------------------------------------------------

	// group_by: 'col1 col2 > col3 ...': levels separated by '>', several
	// columns in one level. a ranged column groups by buckets; its segments,
	// read from the end: 'col[/offset][/unit]/freq'. -> [[{field:,
	// bucket_func:}, ...], ...] by level, without unknown and non-groupable
	// columns and without empty levels.
	function parse_group_by(group_by) {
		let levels = []
		for (let level_expr of group_by.split(group_level_sep_re)) {
			let level = []
			for (let col of words(level_expr)) {
				let range = {} // {freq:, unit:, offset:}
				col = col.replace(last_segment_re,
					k => { range.freq = num(k.substring(1)); return '' })
				col = col.replace(last_segment_re,
					k => { range.unit = k.substring(1); return '' })
				col = col.replace(last_segment_re,
					k => { range.offset = num(k.substring(1)); return '' })
				let field = e.all_fields_map[col]
				if (field?.groupable)
					level.push({
						field: field,
						bucket_func: range_bucket_func(range),
					})
			}
			if (level.length)
				levels.push(level)
		}
		return levels
	}

	// sort the data rows by the level keys, then open a group at each level
	// where a key differs from the previous row's. a group gets a slot with
	// its levels' key cells (a bucket's first value for a ranged column) and
	// null in the other cells.
	function add_groups(levels) {
		let n = e.row_n
		let base_ris = e.base_ris
		let key_fields = [] // [{field:, col:, desc:}, ...]: all levels' keys
		let level_ends = [] // end index into key_fields, by level
		for (let level of levels) {
			for (let {field, bucket_func} of level) {
				// alloc_slot() below can grow the columns: col stays valid
				// for the data rows, and writes go to e.col_vals.
				let col = e.col_vals[field.fi]
				if (bucket_func) {
					let bucket_col = new Float64Array(e.cap) // bucket by ri
					for (let i = 0; i < n; i++) {
						let ri = base_ris[i]
						let v = field.col_storage.get(col, ri)
						bucket_col[ri] = v == null ? NaN : bucket_func(v)
					}
					col = bucket_col
				}
				key_fields.push({field: field, col: col, desc: false})
			}
			level_ends.push(key_fields.length)
		}
		let level_n = levels.length
		// -> the first level where the keys of rows ri1 and ri2 differ.
		function first_diff_level(ri1, ri2) {
			let k = 0 // index into key_fields
			for (let level = 0; level < level_n; level++)
				for (; k < level_ends[level]; k++) {
					let {field, col} = key_fields[k]
					let storage = field.col_storage
					let v2 = storage.get(col, ri2)
					if (storage.compare_cell(col, ri1, v2, field))
						return level
				}
			return level_n
		}
		let ris = radix_sort(base_ris.slice(0, n), n, key_fields)
		let group_ris = [] // group slots in key order
		let open_ris = [] // the open group, by level
		for (let i = 0; i < n; i++) {
			let ri = ris[i]
			let level1 = i ? first_diff_level(ri, ris[i - 1]) : 0
			for (let level = level1; level < level_n; level++) {
				let group_ri = alloc_slot()
				e.row_flags[group_ri] = ROW_GROUP
				e.parent_ri[group_ri] = level ? open_ris[level - 1] : NONE
				for (let field of e.all_fields)
					field.col_storage.set(e.col_vals[field.fi], group_ri, null)
				for (let k = 0; k < level_ends[level]; k++) {
					let {field, col} = key_fields[k]
					let storage = field.col_storage
					storage.set(e.col_vals[field.fi], group_ri,
						storage.get(col, ri))
				}
				open_ris[level] = group_ri
				group_ris.push(group_ri)
			}
			e.parent_ri[ri] = open_ris[level_n - 1]
		}
		e.group_ris = Uint32Array.from(group_ris)
		e.group_fis = new Set(key_fields.map(kf => kf.field.fi))
		e.is_grouped = true
	}

	// group slots to free_ris; the data rows get their tree parents back.
	function remove_groups() {
		for (let ri of e.group_ris)
			e.free_ris.push(ri)
		e.group_ris = new Uint32Array(0)
		e.group_fis = new Set()
		e.is_grouped = false
		if (e.can_be_tree) {
			set_tree_parents()
		} else {
			for (let i = 0; i < e.row_n; i++)
				e.parent_ri[e.base_ris[i]] = NONE
		}
	}

	// some row has an edited cell in one of the levels' columns. a column
	// without input_vals has had no edit since the last full save.
	function has_edited_keys(levels) {
		for (let level of levels)
			for (let {field} of level) {
				let fi = field.fi
				if (!e.input_vals[fi])
					continue
				for (let i = 0; i < e.row_n; i++)
					if (changed_bit(e.base_ris[i], fi))
						return true
			}
		return false
	}

	// group_by: see parse_group_by(); null: ungroup. refused in tree view, and
	// while a row has an edited cell in a key column: grouping reads the
	// columns, so it would put such a row under its old value's group.
	// -> true if applied.
	e.set_group_by = function(group_by) {
		let levels = group_by ? parse_group_by(group_by) : []
		if (levels.length && (e.is_tree || has_edited_keys(levels)))
			return false
		if (e.is_grouped)
			remove_groups()
		e.group_by = levels.length ? group_by : null // group-by spec, or null
		if (levels.length)
			add_groups(levels)
		update_is_tree()
		update_tree_and_visible_ris()
		return true
	}

	/// row orders ------------------------------------------------------------

	let tree_ris_buf // tree_ris in tree view; sorted_ris holds it in flat view

	// parent_ri from the parent_id column: the rows sorted by parent_id and
	// the id index are walked together, both in sort key order. a parent_id
	// that isn't found makes the row a root.
	function set_tree_parents() {
		let id_field = e.id_field
		let parent_field = e.parent_field
		let id_ris = get_index(id_field.name).ris // rows sorted by id
		let pid_ris = radix_sort(e.base_ris.slice(0, e.row_n), e.row_n,
			[{field: parent_field, desc: false}]) // rows sorted by parent_id
		let id_col = e.col_vals[id_field.fi]
		let pid_col = e.col_vals[parent_field.fi]
		let i = 0 // index into id_ris
		for (let j = 0; j < e.row_n; j++) {
			let ri = pid_ris[j]
			let parent_id = parent_field.col_storage.get(pid_col, ri)
			let parent_ri = NONE
			if (parent_id != null) {
				while (i < id_ris.length && id_field.col_storage.compare_cell(
					id_col, id_ris[i], parent_id, id_field) < 0)
				{
					i++
				}
				if (i < id_ris.length && id_field.col_storage.compare_cell(
					id_col, id_ris[i], parent_id, id_field) == 0)
				{
					parent_ri = id_ris[i]
				}
			}
			e.parent_ri[ri] = parent_ri
		}
	}

	function update_is_tree() {
		e.is_tree = e.can_be_tree && !e.flat && !e.is_grouped // tree view
	}

	// stage 3. tree view or grouped: child lists in sorted_ris order, then
	// group_ris order; then a depth-first walk writes tree_ris, tree_i and
	// depth, and a backward walk adds up desc_count. flat view: tree_ris is
	// sorted_ris.
	function update_tree_ris() {
		let n = e.row_n
		if (!(e.is_tree || e.is_grouped)) {
			e.tree_ris = e.sorted_ris
			e.tree_n = n
			e.depth.fill(0)
			e.desc_count.fill(0)
			return
		}
		let parent_ri = e.parent_ri
		let first_child_ri = e.first_child_ri
		let next_sibling_ri = e.next_sibling_ri
		let first_root_ri = NONE
		// a group's children are all data rows or all groups, so pushing the
		// two lists one after the other never mixes them in one child list.
		for (let ris of [e.sorted_ris.subarray(0, n), e.group_ris])
			for (let i = 0; i < ris.length; i++)
				first_child_ri[ris[i]] = NONE
		for (let ris of [e.sorted_ris.subarray(0, n), e.group_ris]) {
			// pushing on the front in backward order keeps the list's order.
			for (let i = ris.length - 1; i >= 0; i--) {
				let ri = ris[i]
				let p = parent_ri[ri]
				if (p == NONE) {
					next_sibling_ri[ri] = first_root_ri
					first_root_ri = ri
				} else {
					next_sibling_ri[ri] = first_child_ri[p]
					first_child_ri[p] = ri
				}
			}
		}
		let tree_ris = tree_ris_buf
		let tree_i = e.tree_i
		let depth = e.depth
		let desc_count = e.desc_count
		let tree_n = 0 // rows reached
		let d = 0 // depth of ri
		let ri = first_root_ri
		while (ri != NONE) {
			tree_i[ri] = tree_n
			tree_ris[tree_n++] = ri
			depth[ri] = d
			desc_count[ri] = 0
			if (first_child_ri[ri] != NONE) {
				ri = first_child_ri[ri]
				d++
			} else {
				// climb to the nearest ancestor-or-self with a next sibling.
				while (ri != NONE && next_sibling_ri[ri] == NONE) {
					ri = parent_ri[ri]
					d--
				}
				if (ri != NONE)
					ri = next_sibling_ri[ri]
			}
		}
		for (let i = tree_n - 1; i >= 0; i--) {
			let ri = tree_ris[i]
			let p = parent_ri[ri]
			if (p != NONE)
				desc_count[p] += desc_count[ri] + 1
		}
		e.tree_ris = tree_ris
		e.tree_n = tree_n
	}

	// stage 4: has_pass_desc. walking tree_ris backwards visits every row's
	// descendants before the row.
	function update_pass_desc() {
		let tree_ris = e.tree_ris
		let row_flags = e.row_flags
		for (let i = 0; i < e.tree_n; i++)
			row_flags[tree_ris[i]] &= ~ROW_PASS_DESC
		if (!(e.is_tree || e.is_grouped))
			return
		let parent_ri = e.parent_ri
		for (let i = e.tree_n - 1; i >= 0; i--) {
			let ri = tree_ris[i]
			let p = parent_ri[ri]
			if (p != NONE && row_flags[ri] & (ROW_PASS | ROW_PASS_DESC))
				row_flags[p] |= ROW_PASS_DESC
		}
	}

	function update_tree_and_visible_ris() { // stages 3-5
		update_tree_ris()
		update_pass_desc()
		update_visible_ris()
	}

	// ri: the row; null: the roots, or every row if recursive.
	// recursive: the row's descendants too.
	e.set_collapsed = function(ri, collapsed, recursive) {
		if (!(e.is_tree || e.is_grouped))
			return
		let row_flags = e.row_flags
		if (ri == null) {
			for (let i = 0; i < e.tree_n; i++) {
				let ri1 = e.tree_ris[i]
				if (recursive || e.depth[ri1] == 0)
					set_bits(row_flags, ri1, ROW_COLLAPSED, collapsed)
			}
		} else if (recursive) {
			let i2 = e.tree_i[ri] + e.desc_count[ri] // last of the subtree
			for (let i = e.tree_i[ri]; i <= i2; i++)
				set_bits(row_flags, e.tree_ris[i], ROW_COLLAPSED, collapsed)
		} else {
			set_bits(row_flags, ri, ROW_COLLAPSED, collapsed)
		}
		update_visible_ris(true)
	}

	// flat view: the rows of a tree nav as a flat list.
	e.set_flat = function(flat) {
		e.flat = flat // flat view of a tree nav
		update_is_tree()
		update_tree_and_visible_ris()
	}

	// stage 5: rows shown, in display order. the two visible_ris buffers are
	// swapped so that the previous list stays readable. reset_sel: after a
	// filter change or a collapse, the selection becomes the focused cell.
	function update_visible_ris(reset_sel) {
		// the rectangle is in visible positions, which change below.
		if (reset_sel)
			set_rect(null, null, null, null)
		else
			commit_rect()
		let ris = e.prev_visible_ris
		e.prev_visible_ris = e.visible_ris
		e.prev_visible_n = e.visible_n
		e.visible_ris = ris
		let visible_i  = e.visible_i
		let tree_ris   = e.tree_ris
		let row_flags  = e.row_flags
		let desc_count = e.desc_count
		visible_i.fill(NONE)
		let n = 0 // visible row count
		for (let i = 0; i < e.tree_n; ) {
			let ri = tree_ris[i]
			let flags = row_flags[ri]
			if (!(flags & (ROW_PASS | ROW_PASS_DESC))) {
				i += desc_count[ri] + 1
			} else {
				visible_i[ri] = n
				ris[n++] = ri
				i += flags & ROW_COLLAPSED ? desc_count[ri] + 1 : 1
			}
		}
		e.visible_n = n

		if (e.focused_ri != null && visible_i[e.focused_ri] == NONE)
			e.focused_ri = null

		if (reset_sel) {
			clear_sel_mask()
			if (e.focused_ri != null)
				set_rect(e.focused_ri, e.focused_fi, e.focused_ri, e.focused_fi)
		} else if (e.has_sel_bits) {
			// hidden rows can't stay selected. only rows that were visible
			// can have bits, so walking the previous list finds all of them.
			let word_n = e.mask_word_n
			let sel_mask = e.sel_mask
			let prev_ris = e.prev_visible_ris
			for (let i = 0; i < e.prev_visible_n; i++) {
				let ri = prev_ris[i]
				if (visible_i[ri] == NONE)
					sel_mask.fill(0, ri * word_n, (ri + 1) * word_n)
			}
		}
	}

	/// loading ---------------------------------------------------------------

	// rs: {fields: [field1, ...], col_vals: [col1_vals, ...]}
	e.load = function(rs) {

		e.all_fields = [] // [field1, ...] by fi
		e.all_fields_map = {} // {col->field}
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let field = ui.create_field(rs.fields[fi])
			field.fi = fi // column index
			e.all_fields.push(field)
			e.all_fields_map[field.name] = field
		}

		let n = rs.col_vals[0].length // row count
		e.row_n = n // data row count
		e.col_vals = e.all_fields.map(field => // column values by fi, then ri
			field.col_storage.load_col(rs.col_vals[field.fi], n))

		e.row_flags        = new Uint16Array(n) // ROW_* bits by ri
		e.parent_ri        = new Uint32Array(n).fill(NONE) // parent, or NONE
		e.first_child_ri   = new Uint32Array(n) // child lists, by stage 3
		e.next_sibling_ri  = new Uint32Array(n) // child lists, by stage 3
		e.depth            = new Uint16Array(n) // indent level by ri
		e.desc_count       = new Uint32Array(n) // descendant count by ri
		e.tree_i           = new Uint32Array(n) // index in tree_ris by ri
		tree_ris_buf       = new Uint32Array(n)
		e.visible_i        = new Uint32Array(n) // index in visible_ris by ri
		e.visible_ris      = new Uint32Array(n) // ri's shown, in order
		e.prev_visible_ris = new Uint32Array(n) // visible_ris before stage 5
		e.visible_n = 0 // length of visible_ris

		// no filter yet: every row passes.
		e.filter = null // filter function, or null
		e.row_flags.fill(ROW_PASS)

		e.base_ris = new Uint32Array(n) // ri's in stored order
		for (let ri = 0; ri < n; ri++)
			e.base_ris[ri] = ri
		e.pos_field = rs.pos_col ? col_fields(rs.pos_col)[0] : null
		// stored order on pos_col navs is pos order.
		if (e.pos_field)
			e.base_ris = radix_sort(e.base_ris, n,
				[{field: e.pos_field, desc: false}])

		// unsorted: one array holds both orders. tree_ris until stage 3 below.
		e.order_by = null // sort columns, sort function, or null
		e.sorted_ris = e.base_ris // data rows' ri's in sort order
		e.tree_ris = e.sorted_ris // ri's, each parent before its descendants
		e.tree_n = n // length of tree_ris

		e.indexes = map() // {cols -> {fields:, ris:}}, built on first lookup
		e.pk = isarray(rs.pk) ? rs.pk.join(' ') : rs.pk // 'col1 ...' or null
		e.pk_fields = e.pk ? col_fields(e.pk) : null // [field1, ...]
		e.row_validator = ui.create_validator(e, [pk_rule], true) // row rules

		e.fields = e.all_fields.slice() // visible columns, in display order
		for (let i = 0; i < e.fields.length; i++)
			e.fields[i].index = i // position in fields
		e.mask_word_n = (e.all_fields.length + 31) >>> 5 // W: words per row
		e.sel_mask = new Uint32Array(n * e.mask_word_n) // selected cells' bits
		e.has_sel_bits = false // false: sel_mask is all zero
		e.focused_ri = null // focused row, or null
		e.focused_fi = null // focused column
		set_rect(null, null, null, null) // no selection rectangle

		e.changed_mask = new Uint32Array(n * e.mask_word_n) // edited cells
		e.changed_n = 0 // number of changed rows
		e.input_vals = [] // per fi: sparse Array of edited values by ri
		e.cell_errors = [] // per fi: sparse Array of failed results by ri
		e.row_errors = [] // sparse: failed row results by ri

		e.cap = n // capacity of every ri-indexed array
		e.slot_n = n // slots ever used, free ones included
		e.free_ris = [] // freed slots, used as a stack

		e.id_field = rs.id_col ? col_fields(rs.id_col)[0]
			: e.pk_fields?.length == 1 ? e.pk_fields[0] : null
		e.parent_field = rs.parent_col ? col_fields(rs.parent_col)[0] : null
		e.can_be_tree = !!(e.id_field && e.parent_field)
		e.flat ??= false // flat view of a tree nav
		e.group_by = null // group-by spec, or null
		e.is_grouped = false
		e.group_ris = new Uint32Array(0) // group synthetic rows in key order
		e.group_fis = new Set() // the group-by key columns' fi's
		update_is_tree()
		if (e.can_be_tree)
			set_tree_parents()
		update_tree_ris()
		// rows that the depth-first walk didn't reach are in a cycle.
		if (e.tree_n < e.row_n) {
			warn('nav2: circular parent refs: showing the rows flat')
			e.can_be_tree = false
			e.parent_ri.fill(NONE)
			update_is_tree()
			update_tree_ris()
		}
		update_pass_desc()
		update_visible_ris()
	}

	return e
}

}())
