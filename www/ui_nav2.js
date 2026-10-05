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
	tree nav   nav with id and parent_id columns, shown in tree view or in
	           flat view. In flat view the nav ignores parent_id.
	data row   row from the rowset or inserted by the user
	group row  slot made by group-by, never saved

Columns, one array each, indexed by ri:

	type    array         null
	------  ------------  ---------------------------------
	number  Float64Array  NaN (JSON numbers are never NaN)
	bool    Uint8Array    2
	string  Array         null

Each field type in ui_field.js names its storage in col_storage, which loads
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
	is_group       slot is a group row
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
	back up with parent_ri, so no stack is needed; write tree_ris and depth.
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
	                      tree navs: build the id index and fill parent_ri
	                      through it; stages 3-5
	sort                  stages 2, 3, 5
	unsort                sorted_ris = base_ris; stages 3, 5
	filter                is_pass = fn(ri) per data row; new and changed
	                      rows: is_pass stays 1 until saved; stages 4, 5
	insert k rows at i    refused under a new row or a row marked for
	                      deletion. take k slots from free_ris, then from the
	                      end, and reset their entries; is_new = 1,
	                      is_pass = 1; copy parent_ri and the parent_id cell
	                      from the row at i; grouped: copy the key cells too.
	                      unsorted: one copyWithin splices all k into
	                      base_ris before the row at i; pos_col: pos values
	                      spaced between the neighbors'. sorted: one
	                      copyWithin splices them into sorted_ris before the
	                      row at i, and the nav appends them to base_ris;
	                      pos_col: pos values after all siblings. merge them
	                      into the indexes; changed_n += k; stages 3-5
	delete k rows         is_removed = 1 on the rows; tree view: on their
	                      subtrees too (desc_count + 1 entries of tree_ris).
	                      a row with no_remove stays, and so do its
	                      ancestors. marked rows stay visible. changed_n +1
	                      per row that was clean. new rows: drop rows
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
	collapse/expand       flip is_collapsed in row_flags[ri]; stage 5
	collapse/expand all   set or clear is_collapsed in every row's flags;
	                      stage 5
	tree/flat view        stages 3-5
	group by levels       refused in tree view. a level's key is its column's
	                      cell, or for a ranged level (col/freq/unit/offset)
	                      the cell's bucket: a number step, or the month or
	                      year of a date. sort data rows by the level keys
	                      into a temporary array; one scan opens a group at
	                      each level where a key differs from the previous
	                      row's. the nav gives each group a slot: is_group =
	                      1, key cells written (the bucket's first value for
	                      ranged levels), is_pass = 0, parent_ri = enclosing
	                      group. each data row: parent_ri = innermost group.
	                      group_ris = group slots in key order; stages 3-5.
	                      a group row's label comes from its key cells and
	                      its level's range
	ungroup               group slots to free_ris; group_ris emptied; tree
	                      navs: parent_ri rebuilt from the parent_id cells
	                      through the id index; other navs: parent_ri =
	                      NONE; stages 3-5
	move k rows to i      only while unsorted, unfiltered and ungrouped, and
	                      not in flat view of a tree nav. rows: consecutive
	                      siblings; stage 3 puts their descendants under
	                      them. one compaction pass takes them out of
	                      base_ris; one copyWithin puts them before the row
	                      at i. new parent given by the grid: write parent_ri
	                      and the parent_id cells. pos_col: new pos values
	                      spaced between the neighbors'; no gap left:
	                      renumber that sibling list. changed_mask and
	                      changed_n as in update cell; stages 3-5
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
	      the search for a focusable cell, editing

*/

;(function () {
"use strict"
const ui = window.ui

const {
	assign, assert, isfunc, isstr, isarray, words, map, S,
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

// row config flags by the names set_row_flag() takes.
let row_config_bits = {
	no_focus : ROW_NO_FOCUS,
	no_change: ROW_NO_CHANGE,
	no_remove: ROW_NO_REMOVE,
	no_save  : ROW_NO_SAVE,
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
	// {field:, desc:}), last field first. stable: equal keys keep their order
	// in ris. ris is used as scratch. -> sorted ri's, ris or a new array.
	function radix_sort(ris, n, sort_fields) {
		let ris1 = new Uint32Array(n) // scatter target for ris
		let keys  = [new Uint32Array(n), new Uint32Array(n)] // key words by ris
		let keys1 = [new Uint32Array(n), new Uint32Array(n)] // scatter targets
		let counts = new Uint32Array(65536) // rows per digit value
		for (let sfi = sort_fields.length - 1; sfi >= 0; sfi--) {
			let {field, desc} = sort_fields[sfi]
			let word_n = field.col_storage.write_sort_keys(
				e.col_vals[field.fi], ris, n, field, keys[0], keys[1])
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
		// stage 3, flat: tree_ris is sorted_ris.
		e.tree_ris = e.sorted_ris
		update_visible_ris()
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
		if (field.readonly || e.row_flags[ri] & ROW_NO_CHANGE)
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

	e.revert_cell = function(ri, fi) {
		if (!changed_bit(ri, fi))
			return
		let was_changed = is_row_changed(ri)
		set_changed_bit(ri, fi, false)
		e.input_vals[fi][ri] = undefined
		if (e.cell_errors[fi])
			e.cell_errors[fi][ri] = undefined
		update_invalid(ri)
		update_changed_n(ri, was_changed)
	}

	// a new row is dropped; any other row gets its server values back.
	e.revert_row = function(ri) {
		if (e.row_flags[ri] & ROW_NEW) {
			drop_rows([ri])
		} else {
			e.row_errors[ri] = undefined
			for (let fi = 0; fi < e.all_fields.length; fi++)
				e.revert_cell(ri, fi)
			update_invalid(ri)
		}
	}

	// new rows are dropped, removed rows unmarked, edited cells reverted.
	e.revert_changes = function() {
		let new_ris = [] // new rows, dropped in one pass at the end
		for (let i = 0; i < e.row_n; i++) {
			let ri = e.base_ris[i]
			if (!is_row_changed(ri))
				continue
			if (e.row_flags[ri] & ROW_NEW) {
				new_ris.push(ri)
			} else {
				e.remove_rows([ri], 'undelete')
				e.revert_row(ri)
			}
		}
		if (new_ris.length)
			drop_rows(new_ris)
		e.input_vals = [] // per fi: sparse Array of edited values by ri
		e.cell_errors = [] // per fi: sparse Array of failed results by ri
	}

	/// slots, inserting and removing -----------------------------------------

	// every ri-indexed array grows to cap slots, keeping its contents.
	function set_capacity(cap) {
		let word_n = e.mask_word_n
		e.col_vals = e.all_fields.map(field =>
			field.col_storage.grow_col(e.col_vals[field.fi], cap))
		e.row_flags        = grow_typed(e.row_flags       , cap)
		e.desc_count       = grow_typed(e.desc_count      , cap)
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
	// sorted_ris at that place and at the end of base_ris.
	e.insert_rows = function(rows, at_ri) {
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
		}
		let n = e.row_n
		if (e.sorted_ris == e.base_ris) {
			let i = at_ri == null ? n : list_index(e.base_ris, n, at_ri)
			e.base_ris = insert_into_list(e.base_ris, n, i, ris, k)
			e.sorted_ris = e.base_ris
		} else {
			let i = at_ri == null ? n : list_index(e.sorted_ris, n, at_ri)
			e.sorted_ris = insert_into_list(e.sorted_ris, n, i, ris, k)
			e.base_ris = insert_into_list(e.base_ris, n, n, ris, k)
		}
		e.row_n += k
		// stage 3, flat: tree_ris is sorted_ris.
		e.tree_ris = e.sorted_ris
		e.tree_n = e.row_n
		add_to_indexes(ris)
		e.changed_n += k
		update_visible_ris()
		return ris
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
		// stage 3, flat: tree_ris is sorted_ris.
		e.tree_ris = e.sorted_ris
		e.tree_n = n
		for (let index of e.indexes.values())
			index.ris = index.ris.subarray(0,
				compact_list(index.ris, index.ris.length, is_dropped))
		for (let ri of ris) {
			if (is_row_changed(ri))
				e.changed_n--
			e.free_ris.push(ri)
		}
		update_visible_ris()
	}

	// op: 'delete' (default): mark the rows for deletion; new rows are
	// dropped. 'undelete': clear the marks. rows with no_remove are left
	// alone.
	e.remove_rows = function(ris, op) {
		let new_ris = [] // new rows to drop
		for (let ri of ris) {
			let flags = e.row_flags[ri]
			let was_changed = is_row_changed(ri)
			if (op == 'undelete') {
				set_bits(e.row_flags, ri, ROW_REMOVED, false)
			} else if (flags & ROW_NO_REMOVE) {
				continue
			} else if (flags & ROW_NEW) {
				new_ris.push(ri)
				continue
			} else {
				set_bits(e.row_flags, ri, ROW_REMOVED, true)
			}
			update_changed_n(ri, was_changed)
		}
		if (new_ris.length)
			drop_rows(new_ris)
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

	/// row orders ------------------------------------------------------------

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
		e.desc_count       = new Uint32Array(n) // descendant count by ri
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

		// unsorted and flat: one array holds all three orders.
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

		update_visible_ris()
	}

	return e
}

}())
