/*

	UI nav objects v2.
	Written by Cosmin Apreutesei. Public Domain.

A nav is an in-memory table with columns and rows, populated from a rowset*.
Once set up, rows can be sorted, filtered, grouped, form a tree, added, removed,
moved at different positions, cells can be focused, selected, modified, etc.
A nav is the data model for the grid widget.

*A rowset is a POD containing field definitions and cell values. It can come
from a http server as JSON, or constructed in JS. Rowset spec is scattered
between rowset.lua, this file and ui_field.js. Examples in ui-demo.html.

NAV CONFIG -------------------------------------------------------------------

Nav config:

	rowset_name    string       the server rowset loaded from and saved to
	reserves_ids   boolean      get autoinc ids from server before saving

Access options:
	per-nav and/or per-rowset:
		can_{add|remove|change|move}_rows, can_change_parent
	per-row:
		no_change, no_remove

NOTE: Nav enforces can_* options only on UI calls with ev.input.

DATA STRUCTURES --------------------------------------------------------------

The nav gives every row a slot number ri (row index) at load or insert and
keeps it until the row is deleted and the slot is reused. The nav stores every
per-row fact in a typed array indexed by ri, and every ordered list of rows as
a Uint32Array of ri's.

	n          number of rows
	k          number of rows passed to an op
	fi         field index in static all_fields (not in changing visible_fields)
	W          number of uint32s (i.e. words) needed per row for bitmasks
	NONE       0xFFFFFFFF
	tree nav   nav with id and parent_id columns, shown as tree or flat
	data row   row from the rowset or inserted by the user
	group row  synthetic row made by group-by, never saved

Column values, one array each, in col_vals[fi], indexed by ri:

	type    array         null
	------  ------------  ---------------------------------
	number  Float64Array  NaN (since we do not support NaN as value)
	bool    Uint8Array    2
	string  Array         null

Each field type in ui_field.js has a storage API in field.col_storage, which
loads a column, grows it, reads and writes its cells, writes radix sort keys
and compares a cell with a value in sort key order.

The columns hold the values last seen on the server. An edited cell's value
is input_vals[fi][ri] instead, which can be text that didn't parse;
changed_mask says which cells are edited.

The nav grows all ri-indexed typed arrays together by doubling, and takes new
slots from free_ris (the free list of removed rows) first.

Per-row arrays, indexed by ri, stable across row deletes:

	name             type        holds
	---------------  ----------  ------------------------------------------
ROW STATE & OPTIONS
	row_flags        Uint16      one bit per flag below; 0 by default
ROW VISIBILITY
	visible_i        Uint32      index into visible_ris; NONE if hidden
CELL SELECTION
	sel_mask         Uint32 x W  one bit per selected cell
CELL EDITING
	changed_mask     Uint32 x W  one bit per edited cell; nonzero: changed
	unset_mask       Uint32 x W  one bit per unset new row cell (see unset cell)
	input_vals[fi]   String      edited values (on-demand, sparse)
	cell_errors[fi]  Array       cell validation errors (on-demand, sparse)
	row_errors       Array       row validation errors (on-demand, sparse)
TREE
	parent_ri        Uint32      tree parent, group row or NONE
	first_child_ri   Uint32      first child, in current order
	next_sibling_ri  Uint32      next sibling, in current order
	depth            Uint16      indent level
	desc_count       Uint32      number of descendants
	tree_i           Uint32      index into tree_ris

Lists of rows, each a Uint32Array of ri's, shifted when rows are deleted:

	base_ris       all rows in stored order or pos_col order if nav has pos_col
	sorted_ris     all rows in current sort order
	tree_ris       all rows, each parent before its descendants
	visible_ris    visible rows in display order
	group_ris      group row in key order; empty if ungrouped

NOTE: A row's subtree is tree_ris[tree_i .. tree_i + desc_count].

Flags in row_flags. One word (uint32) per row, so stage 5 reads its three
flags with one load; ops that set a flag on all rows loop over row_flags.

	flag           bit             set when
	-------------  --------------  --------------------------------------------
ROW DISPLAY STATE
	is_collapsed   ROW_COLLAPSED   row is collapsed
	is_pass        ROW_PASS        row passes current filters
	has_pass_desc  ROW_PASS_DESC   some descendant passes current filters
	is_group       ROW_GROUP       row is a synthetic group row
ROW EDITING STATE
	is_new         ROW_NEW         inserted, not saved yet
	is_removed     ROW_REMOVED     marked for deletion
	is_invalid     ROW_INVALID     row or one of its cells failed validation
ROW OPTIONS
	no_focus       ROW_NO_FOCUS    row can't be focused
	no_change      ROW_NO_CHANGE   row's cells can't be edited
	no_remove      ROW_NO_REMOVE   row can't be deleted
	no_save        ROW_NO_SAVE     row is never saved

Other state:

	name           type         holds
	-------------  -----------  ---------------------------------------------
FIELDS
	all_fields     Array[fi]    field objects made with ui.create_field()
	all_fields_map object       {name->field}
	fields         Array[vfi]   visible columns in display order
	field.index    vfi          field position in fields array
	mask_word_n    number       W: words per row in sel_mask and changed_mask
ROW ALLOCATION
	cap            number       capacity of every ri-indexed array
	slot_n         number       row slots ever used, free ones included
	free_ris       Array        free row slots, used as a stack
EDITING
	changed_n      number       number of changed rows
CELL FOCUS & SELECTION
	focused_ri     number       focused row; null when no row is focused
	focused_fi     number       focused field
	sel_anchor_ri  number       selection rectangle from the anchor cell to
	sel_anchor_fi  number       the end cell, not yet written into sel_mask;
	sel_end_ri     number       it spans the visible rows and the visible
	sel_end_fi     number       fields between the two cells
	has_sel_bits   boolean      false: sel_mask is all zero, so clearing it
VISIBILE ROWS
	visible_n      number       number of visible rows (visible_ris).
	                            and stage 5's walk can be skipped
QUICKSEARCH
	quicksearch_text string     typed prefix of the focused cell's text;
	                            '': no quicksearch

INDEXES

The nav also builds these indexes:

	field(s)           when                     why
	-----------------  ------------------------ -------------------------------
	id_field           on load for trees        find parents
	pk                 on diff_merge            find existing rows
	any                lookup()                 user asked

An index is a Uint32Array of ris sorted by cols with radix sort. A lookup is
then a binary search in the array. The index also holds the column values,
and is bulk-updated on insert, delete and save ack, with one merge or
compaction pass per batch.

POS_COL VALUES

pos_col values are sparse, local to their parent (for trees), and fractional.
An insert or a move gives the placed rows values between their neighbors' and
leaves every other row alone. When no distinct fraction is left between two
neighbors to assign, the nav renumbers that list 1..m. On navs with pos_col,
base_ris holds ris in pos_col order and maintains that through pos_col changes.

UPDATE STAGES ----------------------------------------------------------------

The nav updates stored rows, sort order, tree order, filter results and
visible rows in five stages. After writing state, the nav runs the stages
needed to update the displayed rows.

1: stored order
	- load, insert, move, drop and merge write base_ris directly. Reverting or
	  accepting server changes to pos_col or parent_id cells also sorts it.

2: e.set_order_by()
	- sort base_ris into sorted_ris.
	- order_by = null        : no sort, use base_ris as sorted_ris.
	- order_by = column list : use radix sort in O(n) rows per digit.
	- order_by = cmp fn      : use sort(cmp) in O(n log n).

3: update_tree_ris()
	- read sorted_ris, group_ris, parent_ri, is_tree and is_grouped.
	- build first_child_ri and next_sibling_ri.
	- visit parents before descendants to write tree_ris, tree_i, tree_n and
	  depth, then count descendants in desc_count. O(n).
	- on a cycle, warn, disable tree view, clear parent_ri and show rows flat.
	- in flat view without groups, use sorted_ris directly as tree_ris and set
	  depth and desc_count to zero.

4: update_pass_desc()
	- read is_pass, tree_ris, parent_ri, is_tree and is_grouped.
	- set has_pass_desc for parents with passing descendants. O(n).

5: update_visible_ris()
	- read tree_ris, desc_count, is_pass, has_pass_desc, is_collapsed.
	- write visible_ris, visible_i and visible_n.
	- keeps the previous visible order in prev_visible_ris.
	- read and update focused_ri, focused_fi, quicksearch_text, sel_mask,
	  has_sel_bits, sel_anchor_ri, sel_anchor_fi, sel_end_ri and sel_end_fi to
	  clear hidden focus and selection. O(n) in the worst case.

Outside these stages:
	- load, group, ungroup, move and merge write parent_ri.
	- grouping creates group_ris. ungrouping and drop_empty_groups() shifts it.

GRID OPS ---------------------------------------------------------------------

SORT
	- run stages 2-5.

UNSORT
	- set sorted_ris to base_ris.
	- run stages 3-5.

FILTER
	- set is_pass from fn(ri) for each data row; keep it set for new and
	  changed rows until save.
	- run stages 4-5.

COLLAPSE/EXPAND
	- set or clear is_collapsed on the row and its subtree.
	- run stage 5.

TOGGLE TREE/FLAT VIEW
	- run stages 3-5.

GROUP
	- read key columns, not input_vals. use each column cell as the level key;
	  for ranged columns, use its bucket (number step, month or year).
	- sort data rows by level keys; create a group at each level where the key
	  changes from the previous row.
	- alloc a row slot per group; set is_group, key cells, is_pass and parent_ri.
	  ranged group keys use the bucket's first value; other cells are null.
	- set each data row's parent_ri to its innermost group; set group_ris in
	  key order.
	- run stages 3-5. Group labels use key cells and the level's range.

UNGROUP
	- free group row slots and empty group_ris.
	- if tree, rebuild parent_ri from parent_id through the id index, else set
	  parent_ri to NONE.
	- run stages 3-5.

LOOKUP
	- build the index on the first lookup; use binary search to find vals in cols.
	- return ri or none; O(log n).

SELECT
	- all    : set the selection rect; focus the first cell. O(1).
	- none   : clear sel_mask and the selection rect. O(n).
	- extend : move the selection rect's end cell; O(1).
	- set    : set sel_mask bits. start a new rect.

HIDE COLUMN
	- clear bit fi from every row's sel_mask.

FOCUS
	- move through visible_ris from visible_i[focused_ri], skipping no_focus rows.

QUICKSEARCH s fi
	- search visible_ris from the focused row, wrapping around.

EDITING OPS ------------------------------------------------------------------

UPDATE CELL
	- write input_vals[fi][ri] and set cell's changed_mask bit; clear it when the
	  value is set to the server value.
	- validate the cell: write or clear cell_errors[fi][ri]; set is_invalid from
	  cell and row errors. set is_pass.
	- O(1); no stage runs.

REVERT CELL
	- clear the changed_mask bit, input_vals entry and cell_errors entry.
	- run stages 3-5 when reverting pos_col or parent_id; otherwise no stage runs.

UNSET CELL
	- a cell in a new row with no value and no client_default at insert is unset;
	  cell_val is undefined and save omits it.
	- validate row checks it unless the field has a server default.
	- an edit, including null, gives it a value; revert cell makes it unset again.

REVERT ROW
	- drop a new row; otherwise revert each edited cell.
	- run stages 3-5 when dropping a new row or reverting pos_col or parent_id.

REVERT ALL
	- scan base_ris for changed rows; drop new rows in one pass and undelete and
	  revert other rows.
	- drop input_vals and cell_errors arrays.
	- run stages 3-5 when the scan drops new rows or reverts pos_col or parent_id changes.
	- O(n).

VALIDATE ROW
	- run when focus leaves an edited or new row, and during save.
	- validate every cell of a new row; set is_invalid from cell_errors and row_errors.

INSERT k ROWS AT i
	- allocate k slots from free_ris, then from the end; reset their entries.
	- set is_new and is_pass; copy parent_ri and parent_id from the row at i.
	- when grouped, find the tree parent through the id index and copy group keys.
	- unsorted: splice rows into base_ris before i; assign pos values between
	  neighbors on pos_col navs.
	- sorted: splice rows into sorted_ris before i and append them to base_ris;
	  assign pos values after their siblings on pos_col navs.
	- merge rows into indexes.
	- run stages 3-5.

DELETE k ROWS
	- mark rows is_removed; in tree or grouped view, mark their subtrees too.
	- never mark a group row; mark the rows below it instead.
	- keep marked rows visible.
	- drop new rows.
	- run stages 3-5 when new rows are dropped; otherwise no stage runs.

UNDELETE k ROWS
	- clear is_removed on marked rows and their marked ancestors.

DROP ROWS
	- remove the rows from base_ris and sorted_ris, return slots to free_ris.
	- remove rows from indexes; clear input_vals, cell_errors, row_errors.
	- free groups left without rows and remove them from group_ris.
	- run stages 3-5.

MOVE k ROWS TO i
	- remove rows from base_ris and insert them before i
	- write parent_ri and parent_id for rows changing parent.
	- assign pos_col values between neighbors or renumber the sibling list 1..ms.
	- write pos and parent_id changes as input_vals edits; write col_vals on new rows.
	- run stages 3-5.

SERVER OPS -------------------------------------------------------------------

LOAD
	- copy cell values from rowset into storage via field.col_storage.load_col().
	- set base_ris to 0..n-1 and sort it by pos_col if any.
	- build tree: fill parent_ri by matching parent_id (roots get ri=NONE).
	- run stages 3-5.

SAVE
	- Send requests to rowset_name one at a time; queue another save until the
	  current request is acknowledged.
	- With reserves_ids, reserve ids for new rows without ids before saving; a
	  resent insert then carries the same id and the server skips it.
	- Scan tree_ris backwards for changed rows; skip group rows, no_save rows,
	  rows awaiting a save reply and rows failing validation, except rows
	  marked for deletion.
	- Send new rows without unset cells, changed rows with pk:old and changed_mask
	  cells, and removed rows with pk:old. Children go before parents.
	- Wait for the server's reply before finishing the batch. Keep rows changed
	  if the request fails.
	- O(n); does not run a stage.

SAVE ACK
	- Process sent rows by position. Drop removed rows; record row_errors and
	  cell_errors on errors and leave the row changed.
	- Otherwise write server values, or sent values, into columns; edits equal to
	  column values stop counting as edits; clear is_new and unset bits.
	- Skip rows dropped before the server replied; invalidate indexes for written
	  columns.
	- when changed_n reaches 0, drop input_vals and cell_errors arrays.
	- run stages 3-5 when rows are dropped or pos_col or parent_id changes;
	  otherwise no stage runs.

MERGE ROWSET
	- Run on reload; load instead when columns or keys differ.
	- Radix-sort incoming rows by pk and merge them against the pk index.
	- For matched saved rows, copy changed cells column by column with
	  col_storage.copy_changed. Update edits and quicksearch only for copied
	  cells.
	- Leave a matched new row new when its reserved id matches; the next save
	  resends it and the server skips the insert.
	- Append unmatched incoming rows to base_ris as saved rows; drop unmatched
	  rows that aren't new.
	- Invalidate indexes for written columns; merge added rows into other indexes.
	- When filtered, recompute is_pass for rows that aren't changed.
	- When grouped, rebuild groups.
	- Rebuild tree parents only when rows are added or dropped, or id or parent_id
	  changes. Restore pos order when rows are added or pos changes. Run stage 2
	  when rows are added or any column changes.
	- Run stages 3-5; O(n).

RELOAD
	- Load rowset from rowset_name the first time; merge it on later reloads.
	- Wait for the save request to finish before reloading.
	- Reload on server notifications unless all update_ids are from our saves.
	- Run the stages needed by load or merge rowset.

IMPLEMENTATION PLAN ----------------------------------------------------------

For each step, add its operations to js/tests/nav-bench/nav2_bench.js.
Compare them with the same operations on ui_nav.js in nav_bench.js.

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
	assign, assert, isfunc, isstr, isarray, isobj, words, obj, map,
	warn, warn_if,
	num, floor, month, year, month_of, year_of,
	memoize, ajax, href,
} = glue

//// ROW STATE ---------------------------------------------------------------

const NONE = 0xFFFFFFFF

// row_flags bits.
const ROW_COLLAPSED = 2**0  // row is collapsed
const ROW_PASS      = 2**1  // row passes current filters
const ROW_PASS_DESC = 2**2  // a descendant passes current filters
const ROW_INVALID   = 2**3  // row or one of its cells failed validation
const ROW_NEW       = 2**4  // inserted, not saved yet
const ROW_REMOVED   = 2**5  // marked for deletion
const ROW_NO_FOCUS  = 2**6  // row can't be focused
const ROW_NO_CHANGE = 2**7  // row's cells can't be edited
const ROW_NO_REMOVE = 2**8  // row can't be deleted
const ROW_NO_SAVE   = 2**9  // row is never saved
const ROW_GROUP     = 2**10 // row is a synthetic group row

// bit names accepted by set_row_flag()
let row_config_bits = {
	no_focus : ROW_NO_FOCUS,
	no_change: ROW_NO_CHANGE,
	no_remove: ROW_NO_REMOVE,
	no_save  : ROW_NO_SAVE,
}

//// COMMON HELPERS ----------------------------------------------------------

// set or clear the bits in mask at a[i], where a is any typed array.
function set_bits(a, i, mask, on) {
	a[i] = on ? a[i] | mask : a[i] & ~mask
}

// copy typed array a into new array with room for n entries.
function grow_typed(a, n) {
	let a1 = new a.constructor(n)
	a1.set(a)
	return a1
}

// insert the first k entries of ris at index i in list. The list has len used
// entries. Return list, or a larger copy if there is not enough room.
function insert_into_list(list, len, i, ris, k) {
	if (len + k > list.length)
		list = grow_typed(list, Math.max(len + k, list.length * 2))
	list.copyWithin(i + k, i, len)
	list.set(ris.subarray(0, k), i)
	return list
}

// remove marked rows from the first len entries of list.
// return the number of entries left.
function compact_list(list, len, is_dropped) {
	let j = 0 // next index to write
	for (let i = 0; i < len; i++)
		if (!is_dropped[list[i]])
			list[j++] = list[i]
	return j
}

// find ri among the first len entries of list.
function list_index(list, len, ri) {
	let i = list.subarray(0, len).indexOf(ri)
	assert(i >= 0, 'row not in the nav: ', ri)
	return i
}

function between(x, a, b) {
	return a <= b ? x >= a && x <= b : x >= b && x <= a
}

//// GROUPING HELPERS --------------------------------------------------------

let group_level_sep_re = /\s*>\s*/ // between group-by levels
let last_segment_re = /\/[^\/]+$/ // '/...' at the end of a ranged column
let range_unit_re = /\/(month|year)$/

// for range {freq:, unit:, offset:}, return a function `f(v) -> start` that
// returns the start of the range that contains v`; use numeric ranges
// when unit is absent, or calendar ranges for 'month' and 'year' units.
// return null when no range is specified.
function range_bucket_func(range) {
	let freq = range.freq
	let unit = range.unit
	if (unit && freq == null)
		freq = 1
	let offset = range.offset || 0
	let bucket_func = null
	if (freq) {
		if (!unit)
			bucket_func = v => floor((v - offset) / freq) * freq + offset
		else if (unit == 'month') {
			if (freq == 1)
				bucket_func = v => month(v)
			else
				bucket_func = v => {
					let month_count = (year_of(v) - 1970) * 12 + month_of(v) - 1
					return month(v,
						floor((month_count - offset) / freq) * freq
							+ offset - month_count)
				}
		} else if (unit == 'year') {
			if (freq == 1)
				bucket_func = v => year(v)
			else
				bucket_func = v => {
					let year_count = year_of(v) - 1970
					return year(v,
						floor((year_count - offset) / freq) * freq
							+ offset - year_count)
				}
		}
	}
	return bucket_func
}

//// RADIX SORT -------------------------------------------------------------

/*
Sort the first n entries of ris by sort_fields.
- sort_fields = [{field:, desc:, [col:]}, ...].
- sort by the last field first so that earlier fields take priority.
- for each field, sort by successive groups of 16 bits, lowest first.
- in each pass, keep rows with equal keys in their previous order.
- use two alternating arrays: each pass reads ris from one array and writes
  them into the other and then swaps them. returns the array containing the
  final order; the caller must use the returned array.
*/
let counts
function radix_sort(col_vals, ris, n, sort_fields) {
	if (n < 2)
		return ris
	let ris1 = new Uint32Array(n) // row indices for the next pass
	let keys  = [new Uint32Array(n), new Uint32Array(n)] // keys by ris
	let keys1 = [new Uint32Array(n), new Uint32Array(n)] // next keys
	counts ??= new Uint32Array(65536) // rows per digit value
	for (let sfi = sort_fields.length - 1; sfi >= 0; sfi--) {

		// build this field's sort keys. Use col when supplied: for ranged
		// grouping, the nav passes each range's starting value in col.
		let {field, desc, col} = sort_fields[sfi]
		let word_n = field.col_storage.write_sort_keys(
			col ?? col_vals[field.fi], ris, n, field, keys[0], keys[1])

		// invert the keys for descending order, with null last.
		if (desc)
			for (let w = 0; w < word_n; w++) {
				let k = keys[w]
				for (let i = 0; i < n; i++)
					k[i] = ~k[i]
			}

		// process each key 16 bits at a time, starting with the lowest word
		// and with its lowest bits.
		for (let w = 0; w < word_n; w++) {
			for (let shift = 0; shift <= 16; shift += 16) {
				let k = keys[w]

				// count the rows per digit value.
				counts.fill(0)
				for (let i = 0; i < n; i++)
					counts[(k[i] >>> shift) & 0xFFFF]++
				// skip this pass if every row has the same digit.
				if (counts[(k[0] >>> shift) & 0xFFFF] == n)
					continue

				// replace each count with the first output index for that digit.
				let sum = 0 // rows with smaller digits
				for (let d = 0; d < 65536; d++) {
					let c = counts[d]
					counts[d] = sum
					sum += c
				}

				// copy each row index together with the key words needed by
				// later passes, from w onward.
				for (let i = 0; i < n; i++) {
					let j = counts[(k[i] >>> shift) & 0xFFFF]++ // target index
					ris1[j] = ris[i]
					for (let w2 = w; w2 < word_n; w2++)
						keys1[w2][j] = keys[w2][i]
				}

				// swap the arrays to read the sorted values in the next pass.
				let t = ris; ris = ris1; ris1 = t
				for (let w2 = w; w2 < word_n; w2++) {
					let t = keys[w2]; keys[w2] = keys1[w2]; keys1[w2] = t
				}
			}
		}
	}
	return ris
}

//// ROWSET NOTIFICATIONS ----------------------------------------------------

let rowset_listeners = {} // {rowset_name -> Set(fn(update_ids))}

// share one connection among all navs. When the server changes a rowset's
// rows, it sends 'NAME[:FILTER] UPDATE_ID...'.
let listen_rowset_events = memoize(function() {
	let es = new EventSource('/rowset.events')
	es.onmessage = function(ev) {
		let update_ids = words(ev.data)
		let [rowset_name, filter] = update_ids.shift().split(':')
		// ignore notifications for filtered loads.
		if (filter != null)
			return
		for (let fn of rowset_listeners[rowset_name] ?? [])
			fn(update_ids)
	}
})

//// NAV ---------------------------------------------------------------------

ui.nav2 = function(id, opt) {

	assert(id, 'nav id required')
	let e = assign({}, opt)
	e.id = id

	let cap
	let slot_n
	let free_ris
	let indexes
	let first_child_ri
	let next_sibling_ri
	let group_fis
	let has_sel_bits
	let sel_anchor_ri
	let sel_anchor_fi
	let sel_end_ri
	let sel_end_fi
	let prev_visible_ris

	e.get_debug_state = function() {
		return {
			cap: cap,
			slot_n: slot_n,
			free_ris: free_ris,
			indexes: indexes,
			first_child_ri: first_child_ri,
			next_sibling_ri: next_sibling_ri,
			group_fis: group_fis,
			has_sel_bits: has_sel_bits,
			sel_anchor_ri: sel_anchor_ri,
			sel_anchor_fi: sel_anchor_fi,
			sel_end_ri: sel_end_ri,
			sel_end_fi: sel_end_fi,
			prev_visible_ris: prev_visible_ris,
		}
	}

	/// indexes ---------------------------------------------------------------

	// 'col1 col2 ...' -> [field1, ...]
	function col_fields(cols) {
		return words(cols).map(col =>
			assert(e.all_fields_map[col], 'unknown column: ', col))
	}

	function invalidate_indexes(field) {
		for (let cols of indexes.keys())
			if (indexes.get(cols).fields.includes(field))
				indexes.delete(cols)
	}

	// Return {fields:, ris:}, with data row indices sorted by cols. Build and
	// cache the index on first use.
	function get_index(cols) {
		let index = indexes.get(cols)
		if (!index) {
			let fields = col_fields(cols)
			let sort_fields = fields.map(field => ({field: field, desc: false}))
			index = {
				fields: fields, // [field1, ...]
				ris: radix_sort(e.col_vals,
					e.base_ris.slice(0, e.row_n), e.row_n,
					sort_fields), // data rows' ri's, sorted by fields
			}
			indexes.set(cols, index)
		}
		return index
	}

	// Compare ri's cells with vals using fields in order. Return -1, 0 or 1.
	function compare_row(ri, fields, vals) {
		for (let i = 0; i < fields.length; i++) {
			let field = fields[i]
			let r = field.col_storage.compare_cell(
				e.col_vals[field.fi], ri, vals[i])
			if (r)
				return r
		}
		return 0
	}

	// Compare ri1 with ri2 using fields in order. Return -1, 0 or 1.
	function compare_rows(ri1, ri2, fields) {
		for (let field of fields) {
			let col = e.col_vals[field.fi]
			let r = field.col_storage.compare_cell(col, ri1,
				field.col_storage.get(col, ri2))
			if (r)
				return r
		}
		return 0
	}

	// Find the insertion index in ris after all rows with keys equal to ri's.
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

	// Add ris to each index after existing rows with equal keys. Use a binary
	// search for each new row and copy the rows in one pass.
	function add_to_indexes(ris) {
		if (!ris.length)
			return
		for (let index of indexes.values()) {
			let fields = index.fields

			// sort the new rows by key, then merge them into the old rows in
			// one pass.
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

	/// focus and selection ---------------------------------------------------

	function clear_sel_mask() {
		if (has_sel_bits) {
			e.sel_mask.fill(0)
			has_sel_bits = false
		}
	}

	function set_rect(anchor_ri, anchor_fi, end_ri, end_fi) {
		sel_anchor_ri = anchor_ri
		sel_anchor_fi = anchor_fi
		sel_end_ri = end_ri
		sel_end_fi = end_fi
	}

	// Return the rectangle's row and column positions in visible_ris and
	// fields.
	function rect_bounds() { // -> [row_i1, row_i2, col_i1, col_i2], inclusive
		let row_i1 = e.visible_i[sel_anchor_ri]
		let row_i2 = e.visible_i[sel_end_ri]
		let col_i1 = e.all_fields[sel_anchor_fi].index
		let col_i2 = e.all_fields[sel_end_fi].index
		return [
			Math.min(row_i1, row_i2), Math.max(row_i1, row_i2),
			Math.min(col_i1, col_i2), Math.max(col_i1, col_i2),
		]
	}

	// Set the sel_mask bits for every cell in the rectangle. Use each visible
	// column's fi. Visit each row once.
	function commit_rect() {
		if (sel_anchor_ri == null)
			return
		let [row_i1, row_i2, col_i1, col_i2] = rect_bounds()

		// Build the selection bits for the rectangle's columns.
		let word_n = e.mask_word_n
		let col_mask = new Uint32Array(word_n) // fi bits of the columns
		for (let col_i = col_i1; col_i <= col_i2; col_i++) {
			let fi = e.visible_fields[col_i].fi
			col_mask[fi >>> 5] |= 1 << (fi & 31)
		}

		// add those bits to each row of the rectangle.
		let sel_mask = e.sel_mask
		for (let i = row_i1; i <= row_i2; i++) {
			let word_i = e.visible_ris[i] * word_n // first word of the row
			for (let w = 0; w < word_n; w++)
				sel_mask[word_i + w] |= col_mask[w]
		}

		// Clear the rectangle after recording its selected cells in sel_mask.
		has_sel_bits = true
		set_rect(null, null, null, null)
	}

	// With select null, select only the focused cell. With 'expand', select
	// from the rectangle's anchor or the focused cell to (ri, fi). With
	// 'invert', toggle (ri, fi) and keep the rest. With 'all', focus the first
	// cell and select all cells.
	e.focus_cell = function(ri, fi, select) {
		// a hidden row can't be focused.
		if (ri != null && e.visible_i[ri] == NONE)
			ri = null

		// change the selection according to select.
		if (select == 'deselect_hidden') {
			if (has_sel_bits) {
				// Deselect hidden rows. Check the previous visible rows because
				// only those rows can have selected cells.
				let prev_ris = e.visible_ris
				for (let i = 0; i < e.visible_n; i++) {
					let ri = prev_ris[i]
					if (e.visible_i[ri] == NONE)
						clear_row_mask(e.sel_mask, ri)
				}
			}
		} else if (select == 'all') {
			clear_sel_mask()
			let has_cells = e.visible_n > 0 && e.visible_fields.length > 0
			ri = has_cells ? e.visible_ris[0] : null
			fi = has_cells ? e.visible_fields[0].fi : null
			if (has_cells)
				set_rect(ri, fi, e.visible_ris[e.visible_n - 1],
					e.visible_fields[e.visible_fields.length - 1].fi)
			else
				set_rect(null, null, null, null)
		} else if (select == 'expand') {
			if (sel_anchor_ri != null)
				set_rect(sel_anchor_ri, sel_anchor_fi, ri, fi)
			else if (e.focused_ri != null)
				set_rect(e.focused_ri, e.focused_fi, ri, fi)
			else
				set_rect(ri, fi, ri, fi)
		} else if (select == 'invert') {
			commit_rect()
			let word_i = ri * e.mask_word_n + (fi >>> 5) // word of the cell
			e.sel_mask[word_i] ^= 1 << (fi & 31)
			has_sel_bits = true
		} else {
			clear_sel_mask()
			set_rect(ri, fi, ri, fi)
		}

		// End quicksearch when focusing another cell.
		if (ri != e.focused_ri || fi != e.focused_fi)
			e.quicksearch_text = ''
		e.focused_ri = ri
		e.focused_fi = fi
	}

	e.is_cell_selected = function(ri, fi) {
		if (cell_bit(e.sel_mask, ri, fi))
			return true

		// Check the selection rectangle if the cell has no bit in sel_mask. Use
		// its visible row and column positions.
		if (sel_anchor_ri == null || e.visible_i[ri] == NONE)
			return false
		let visible_i = e.visible_i
		let all_fields = e.all_fields
		return between(visible_i[ri],
				visible_i[sel_anchor_ri], visible_i[sel_end_ri])
			&& between(all_fields[fi].index,
				all_fields[sel_anchor_fi].index, all_fields[sel_end_fi].index)
	}

	// Call fn(ri) for each row with a selected cell, in display order. Check
	// only visible rows because hidden rows cannot be selected.
	e.each_selected_row = function(fn) {
		commit_rect()
		if (!has_sel_bits)
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

	/// row orders ------------------------------------------------------------

	let tree_ris_buf // separate tree order buffer; unused in flat view

	// Set parent_ri from the parent_id column. Sort rows by parent_id and
	// compare them with the id index in order. Use no parent when no id
	// matches.
	function set_tree_parents() {
		let id_field = e.id_field
		let parent_field = e.parent_field
		let id_ris = get_index(id_field.name).ris // rows sorted by id
		let pid_ris = radix_sort(e.col_vals,
			e.base_ris.slice(0, e.row_n), e.row_n,
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
					id_col, id_ris[i], parent_id) < 0)
				{
					i++
				}
				if (i < id_ris.length && id_field.col_storage.compare_cell(
					id_col, id_ris[i], parent_id) == 0)
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

	// Stage 3. Build child lists from sorted_ris and group_ris. Visit each
	// parent before its children to write tree_ris, tree_i and depth. Count
	// descendants by visiting the rows backward. In flat view, use sorted_ris
	// directly as tree_ris.
	function update_tree_ris() {
		let n = e.row_n
		if (!(e.is_tree || e.is_grouped)) {
			e.tree_ris = e.sorted_ris
			e.tree_n = n
			e.depth.fill(0)
			e.desc_count.fill(0)
			return
		}

		// build each row's child list, in sort order.
		let parent_ri = e.parent_ri
		let first_root_ri = NONE
		let ris_lists = [e.sorted_ris.subarray(0, n), e.group_ris]
		// Process data rows and group rows separately. Each group has only data
		// rows or only subgroups as children.
		for (let ris of ris_lists)
			for (let i = 0; i < ris.length; i++)
				first_child_ri[ris[i]] = NONE
		for (let ris of ris_lists) {
			// Visit rows backward and prepend each one to preserve their order.
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

		// Visit each parent before its children. Record each row's position and
		// depth.
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
				// Find a next sibling. If this row has none, try its parent and
				// continue upward.
				while (ri != NONE && next_sibling_ri[ri] == NONE) {
					ri = parent_ri[ri]
					d--
				}
				if (ri != NONE)
					ri = next_sibling_ri[ri]
			}
		}

		// Count descendants backward so that each child has its count before
		// adding it to the parent's count.
		for (let i = tree_n - 1; i >= 0; i--) {
			let ri = tree_ris[i]
			let p = parent_ri[ri]
			if (p != NONE)
				desc_count[p] += desc_count[ri] + 1
		}
		e.tree_ris = tree_ris
		e.tree_n = tree_n

		// Check for cycles by comparing the number of rows visited with the
		// total row count.
		if (e.is_tree && tree_n < n) {
			warn(e.id, 'circular parent refs: showing the rows flat')
			e.can_be_tree = false
			e.parent_ri.fill(NONE)
			update_is_tree()
			update_tree_ris()
		}
	}

	// Stage 4. Mark parents with descendants passing the filter. Visit
	// tree_ris backward to check descendants before their parents.
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

	// Stage 5. Build the visible row order and keep the previous order in the
	// other buffer. With reset_sel, select only the focused cell after
	// filtering or collapsing. Clear focus if the focused row is hidden. To
	// choose a nearby row, the UI must read visible_i before the operation.
	function update_visible_ris(reset_sel) {
		// Record or clear the selection rectangle before changing visible
		// positions.
		if (reset_sel)
			set_rect(null, null, null, null)
		else
			commit_rect()

		// Write visible rows into the other buffer. Skip a row and its
		// descendants if none pass the filter. Include a collapsed row without
		// its descendants.
		let ris = prev_visible_ris
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

		// Clear focus from hidden rows. Deselect hidden rows, or select only
		// the focused cell with reset_sel.
		e.focus_cell(e.focused_ri, e.focused_fi,
			reset_sel ? null : 'deselect_hidden')

		// show the new list; keep the old buffer for the next run.
		prev_visible_ris   = e.visible_ris
		e.visible_ris = ris
		e.visible_n = n
	}

	function update_tree_and_visible_ris() { // stages 3-5
		update_tree_ris()
		update_pass_desc()
		update_visible_ris()
	}

	/// collapse/expand -------------------------------------------------------

	// Collapse or expand ri. With recursive, include its descendants. With ri
	// null, change all roots, or all rows if recursive is set.
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

	// Show a tree nav's rows as a flat list.
	e.set_flat = function(flat) {
		e.flat = flat // flat view of a tree nav
		update_is_tree()
		update_tree_and_visible_ris()
	}

	/// sorting ---------------------------------------------------------------

	// parse order_by, 'col1[:desc] ...', into [{field:, desc:}, ...].
	// ignore unknown columns and columns that cannot be sorted.
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

	// move changed rows first, in base_ris order, then keep the remaining rows
	// in sort order. return a new array, or sorted_ris if no row is changed.
	function move_changed_rows_first(sorted_ris) {
		if (!e.changed_n)
			return sorted_ris
		let n = e.row_n
		let ris = new Uint32Array(n) // result
		let j = 0 // next index into ris

		// copy changed rows in stored order.
		for (let i = 0; i < n; i++)
			if (is_row_changed(e.base_ris[i]))
				ris[j++] = e.base_ris[i]

		// copy the remaining rows in sort order.
		for (let i = 0; i < n; i++)
			if (!is_row_changed(sorted_ris[i]))
				ris[j++] = sorted_ris[i]
		return ris
	}

	// Stage 2. order_by = 'col1[:desc] ...' | cmp(ri1, ri2) | null.
	// put changed rows first, in base_ris order.
	e.set_order_by = function(order_by) {
		let sort_fields = isstr(order_by) ? parse_order_by(order_by) : null
		if (isfunc(order_by)) {
			e.order_by = order_by
			e.sorted_ris = move_changed_rows_first(
				e.base_ris.slice(0, e.row_n).sort(order_by))
		} else if (sort_fields?.length) {
			e.order_by = order_by
			e.sorted_ris = move_changed_rows_first(radix_sort(e.col_vals,
				e.base_ris.slice(0, e.row_n), e.row_n, sort_fields))
		} else {
			e.order_by = null
			e.sorted_ris = e.base_ris
		}
		update_tree_and_visible_ris()
	}

	/// filtering -------------------------------------------------------------

	// filter by fn(ri) -> is_visible; always include changed rows until saved
	// set_filter(null) clears the filter.
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

	/// quicksearch -----------------------------------------------------------

	// End quicksearch after writing the focused cell, since its text may no
	// longer start with the typed prefix.
	function end_quicksearch_at(ri, fi) {
		if (ri == e.focused_ri && fi == e.focused_fi)
			e.quicksearch_text = ''
	}

	// Search column fi for text starting with s, ignoring case. Pass '' to end
	// quicksearch. With offset 0 (the default), search forward from the
	// focused row; with 1, start at the next row; with -1, search backward
	// from the previous row. If no row is focused, start as if the first row
	// were focused. Continue from the other end after reaching either end.
	// Skip no_focus rows. Focus the first matching row and return its ri, or
	// return null if none matched.
	e.quicksearch = function(s, fi, offset) {
		if (!s) {
			e.quicksearch_text = ''
			return null
		}
		let field = e.all_fields[fi]
		let s_lower = s.toLowerCase()
		let n = e.visible_n
		let dir = offset < 0 ? -1 : 1 // walk direction
		// Add n to keep i nonnegative when searching backward. Use i % n to
		// read each row.
		let i = (e.focused_ri != null ? e.visible_i[e.focused_ri] : 0)
			+ (offset ?? 0) + n // index into visible_ris, before % n
		for (let k = 0; k < n; k++, i += dir) {
			let ri = e.visible_ris[i % n]
			if (!(e.row_flags[ri] & ROW_NO_FOCUS)
				&& cell_text(ri, field).toLowerCase().startsWith(s_lower)
			) {
				e.focus_cell(ri, fi)
				e.quicksearch_text = s
				return ri
			}
		}
		return null
	}

	/// grouping --------------------------------------------------------------

	// Parse group_by as 'col1 col2 > col3 ...', with '>' between levels and
	// spaces between columns in a level. For ranged columns, accept
	// 'col[/offset][/unit]/freq' and group values by range. Return [[{field:,
	// bucket_func:}, ...], ...], one array per level. Ignore unknown columns,
	// columns that cannot be grouped, and empty levels.
	function parse_group_by(group_by) {
		let levels = []
		for (let level_expr of group_by.split(group_level_sep_re)) {
			let level = []
			for (let col of words(level_expr)) {
				let range = {} // {freq:, unit:, offset:}

				// Read and remove the range arguments from the end: freq, then
				// unit, then offset.
				col = col.replace(last_segment_re,
					k => { range.freq = num(k.substring(1)); return '' })
				col = col.replace(range_unit_re,
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

	// Sort data rows by grouping columns. Create a group whenever a value
	// differs from the previous row's. Store the group keys in its cells,
	// using range starts for ranged columns, and null in the other cells.
	function add_groups(levels) {
		let n = e.row_n
		let base_ris = e.base_ris

		// Collect the sort keys for each level. For ranged columns, write range
		// starts into a separate column.
		let key_fields = [] // [{field:, col:, desc:}, ...]: all levels' keys
		let level_ends = [] // end index into key_fields, by level
		for (let level of levels) {
			for (let {field, bucket_func} of level) {
				// Keep col to read existing data rows, even if alloc_slot()
				// replaces the column arrays. Write new group cells to
				// e.col_vals.
				let col = e.col_vals[field.fi]
				if (bucket_func) {
					let bucket_col = new Float64Array(cap) // range start by ri
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
		// Return the first grouping level with different keys for ri1 and ri2.
		function first_diff_level(ri1, ri2) {
			let k = 0 // index into key_fields
			for (let level = 0; level < level_n; level++)
				for (; k < level_ends[level]; k++) {
					let {field, col} = key_fields[k]
					let storage = field.col_storage
					let v2 = storage.get(col, ri2)
					if (storage.compare_cell(col, ri1, v2))
						return level
				}
			return level_n
		}

		// Sort and visit the data rows. Find the first level differing from the
		// previous row, then create new groups at that level and below it.
		let ris = radix_sort(e.col_vals, base_ris.slice(0, n), n, key_fields)
		let group_ris = [] // group slots in key order
		let open_ris = [] // the open group, by level
		for (let i = 0; i < n; i++) {
			let ri = ris[i]
			let level1 = i ? first_diff_level(ri, ris[i - 1]) : 0
			for (let level = level1; level < level_n; level++) {
				let group_ri = alloc_slot()
				e.row_flags[group_ri] = ROW_GROUP
				e.parent_ri[group_ri] = level ? open_ris[level - 1] : NONE

				// Set the group cells to null, then copy the keys for this level
				// and for the levels above it from the group's first row.
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

			// put the data row under the innermost open group.
			e.parent_ri[ri] = open_ris[level_n - 1]
		}
		e.group_ris = Uint32Array.from(group_ris)
		group_fis = new Set(key_fields.map(kf => kf.field.fi))
		e.is_grouped = true
	}

	// Free all group row slots for reuse.
	function remove_groups() {
		commit_rect()
		for (let ri of e.group_ris)
			free_slot(ri)
		e.group_ris = new Uint32Array(0)
		group_fis = new Set()
		e.is_grouped = false
	}

	// Free groups with no rows left. Visit group_ris backward to check
	// subgroups before their parents.
	function drop_empty_groups() {
		// count the data rows directly under each group.
		let child_n = new Uint32Array(cap) // kept children by group
		for (let i = 0; i < e.row_n; i++)
			child_n[e.parent_ri[e.base_ris[i]]]++

		// free the empty groups, and count each kept group as a child of its
		// parent group.
		let is_dropped = new Uint8Array(cap) // 1: group being dropped
		for (let i = e.group_ris.length - 1; i >= 0; i--) {
			let ri = e.group_ris[i]
			let p = e.parent_ri[ri]
			if (!child_n[ri]) {
				is_dropped[ri] = 1
				free_slot(ri)
			} else if (p != NONE) {
				child_n[p]++
			}
		}
		e.group_ris = e.group_ris.subarray(0,
			compact_list(e.group_ris, e.group_ris.length, is_dropped))
	}

	// Check for edits in grouping columns. Skip columns without input_vals
	// because no cells in those columns have pending edits.
	function has_edited_keys(levels) {
		for (let level of levels)
			for (let {field} of level) {
				let fi = field.fi
				if (!e.input_vals[fi])
					continue
				for (let i = 0; i < e.row_n; i++)
					if (cell_bit(e.changed_mask, e.base_ris[i], fi))
						return true
			}
		return false
	}

	// Use the syntax accepted by parse_group_by(), or pass null to ungroup.
	// Refuse grouping in tree view or with pending changes in a tree nav.
	// Refuse edited grouping columns in a flat nav because the nav groups by
	// stored values. Return true if applied.
	e.set_group_by = function(group_by) {
		let levels = group_by ? parse_group_by(group_by) : []
		if (levels.length && (e.is_tree || e.can_be_tree && e.changed_n
			|| has_edited_keys(levels)))
			return false

		// Remove current groups. Before regrouping, unfocus and deselect old
		// group rows so that add_groups() can reuse their slots. When
		// ungrouping, restore tree parents or clear the parents for a flat nav.
		if (e.is_grouped) {
			remove_groups()
			if (levels.length) {
				e.focus_cell(e.focused_ri, e.focused_fi, 'deselect_hidden')
			} else if (e.can_be_tree) {
				set_tree_parents()
			} else {
				for (let i = 0; i < e.row_n; i++)
					e.parent_ri[e.base_ris[i]] = NONE
			}
		}

		// add the new groups, if any, and update the rows shown.
		e.group_by = levels.length ? group_by : null // group-by spec, or null
		if (levels.length)
			add_groups(levels)
		update_is_tree()
		update_tree_and_visible_ris()
		return true
	}

	/// cell values, edits and validation -------------------------------------

	// value last seen on the server.
	function col_val(ri, fi) {
		return e.all_fields[fi].col_storage.get(e.col_vals[fi], ri)
	}

	// mask bit of cell (ri, fi).
	function cell_bit(mask, ri, fi) {
		return mask[ri * e.mask_word_n + (fi >>> 5)] & (1 << (fi & 31))
	}

	function set_cell_bit(mask, ri, fi, on) {
		set_bits(mask, ri * e.mask_word_n + (fi >>> 5), 1 << (fi & 31), on)
	}

	function clear_row_mask(mask, ri) {
		mask.fill(0, ri * e.mask_word_n, (ri + 1) * e.mask_word_n)
	}

	// return the cell's unedited value, or undefined for an unset cell.
	function unedited_val(ri, fi) {
		return cell_bit(e.unset_mask, ri, fi) ? undefined : col_val(ri, fi)
	}

	// check whether the row is new, marked for deletion, or edited.
	function is_row_changed(ri) {
		let flags = e.row_flags[ri]
		if (flags & (ROW_NEW | ROW_REMOVED))
			return true
		let word_n = e.mask_word_n
		for (let w = ri * word_n, w2 = w + word_n; w < w2; w++)
			if (e.changed_mask[w])
				return true
		return false
	}

	// adjust changed_n if the row became changed or became clean.
	function update_changed_n(ri, was_changed) {
		let is_changed = is_row_changed(ri)
		if (is_changed != was_changed)
			e.changed_n += is_changed ? 1 : -1
	}

	// return the edited value, or the value last seen on the server when the
	// cell has no edit, or undefined for a new row's unset cell.
	e.cell_val = function(ri, fi) {
		return cell_bit(e.changed_mask, ri, fi)
			? e.input_vals[fi][ri] : unedited_val(ri, fi)
	}

	// the cell's display text.
	function cell_text(ri, field) {
		let v = e.cell_val(ri, field.fi)
		if (v == null)
			return field.null_text
		if (v === '')
			return field.empty_text
		return field.to_text(v)
	}

	// return null if valid, otherwise copy the validator's results into
	// [result1, ...] with .failed set to true.
	function validate_cell(field, v) {
		if (v === undefined && field.has_server_default)
			return null
		if (field.validator.validate(v, 'failed'))
			return null
		let errors = []
		errors.failed = true
		for (let result of field.validator.results)
			errors.push(assign({}, result))
		return errors
	}

	function set_cell_errors(ri, fi, errors) {
		if (errors) {
			e.cell_errors[fi] ??= [] // made on the column's first error
			e.cell_errors[fi][ri] = errors
		} else if (e.cell_errors[fi]) {
			e.cell_errors[fi][ri] = undefined
		}
	}

	// mark the row invalid if it has cell errors or row errors.
	function update_invalid(ri) {
		let invalid = !!e.row_errors[ri]
		for (let fi = 0; !invalid && fi < e.all_fields.length; fi++)
			invalid = !!e.cell_errors[fi]?.[ri]
		set_bits(e.row_flags, ri, ROW_INVALID, invalid)
	}

	// return true if the row and its cells are valid.
	e.validate_row = function(ri) {
		if (e.row_flags[ri] & ROW_NEW)
			for (let field of e.all_fields) {
				let fi = field.fi
				let v = e.cell_val(ri, fi)
				let errors = validate_cell(field, v)
				set_cell_errors(ri, fi, errors)
			}
		update_invalid(ri)
		return !(e.row_flags[ri] & ROW_INVALID)
	}

	// set cell's edited value; clear the edit if v equals server value (revert).
	function set_input_val(ri, fi, v) {
		let was_changed = is_row_changed(ri)
		// for an unset cell, clear the edit only for undefined.
		// treat null as an input value.
		if (cell_bit(e.unset_mask, ri, fi) ? v === undefined
			: v === col_val(ri, fi)
		) {
			set_cell_bit(e.changed_mask, ri, fi, false)
			if (e.input_vals[fi])
				e.input_vals[fi][ri] = undefined
		} else {
			set_cell_bit(e.changed_mask, ri, fi, true)
			e.input_vals[fi] ??= [] // made on the column's first edit
			e.input_vals[fi][ri] = v
		}
		update_changed_n(ri, was_changed)
		end_quicksearch_at(ri, fi)
	}

	function is_cell_editable(ri, fi) {
		if (e.row_flags[ri] & ROW_GROUP) // group row cell
			return false
		if (fi == e.pos_field?.fi)
			return false
		if (e.can_be_tree && (fi == e.id_field.fi || fi == e.parent_field.fi))
			return false
		if (e.is_grouped && group_fis.has(fi)) // grouped-by col while grouped
			return false
		return true
	}

	// store the parsed value when parsing succeeds, or keep the typed text
	// when it fails. Clear the edit if the value equals the server value. With
	// ev.input, refuse the edit if can_change_val() returns false.
	e.set_cell_val = function(ri, fi, v, ev) {
		if (!(ev?.input ? e.can_change_val(ri, fi) : is_cell_editable(ri, fi)))
			return

		// validate and parse v. Stop if it equals the current value.
		let field = e.all_fields[fi]
		let errors = validate_cell(field, v)
		if (!field.validator.parse_failed)
			v = field.validator.value
		if (v === e.cell_val(ri, fi))
			return

		// Store the edit and its cell errors. Clear the row errors because they
		// were reported for the previous values.
		set_input_val(ri, fi, v)
		set_cell_errors(ri, fi, errors)
		e.row_errors[ri] = undefined
		update_invalid(ri)

		// Keep the edited row visible until the next filter.
		set_bits(e.row_flags, ri, ROW_PASS, true)
	}

	// Return true for a pos or parent_id cell. The caller must then restore
	// the row's position or parent from the reverted value.
	function revert_cell_val(ri, fi) {
		set_input_val(ri, fi, unedited_val(ri, fi))
		set_cell_errors(ri, fi, null)
		return fi == e.pos_field?.fi || fi == e.parent_field?.fi
	}

	// Return true if a pos or parent_id edit was reverted.
	function revert_row_vals(ri) {
		e.row_errors[ri] = undefined
		let is_moved = false
		for (let fi = 0; fi < e.all_fields.length; fi++)
			if (cell_bit(e.changed_mask, ri, fi) && revert_cell_val(ri, fi))
				is_moved = true
		update_invalid(ri)
		return is_moved
	}

	e.revert_cell = function(ri, fi) {
		if (!cell_bit(e.changed_mask, ri, fi))
			return
		let is_moved = revert_cell_val(ri, fi)
		update_invalid(ri)
		if (is_moved) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// Drop a new row, or restore the server values of a saved row.
	e.revert_row = function(ri) {
		if (e.row_flags[ri] & ROW_NEW) {
			drop_rows([ri])
			update_tree_and_visible_ris()
		} else if (revert_row_vals(ri)) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// Drop new rows, unmark rows marked for deletion, and revert edited cells.
	e.revert_changes = function() {
		let new_ris = [] // new rows, dropped in one pass at the end
		let moved_ris = [] // rows whose pos or parent_id was reverted

		// Unmark and revert saved rows. Collect new rows to drop afterward.
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

		// Restore the positions and parents of reverted rows, then drop new
		// rows.
		if (moved_ris.length)
			update_row_places(moved_ris)
		if (new_ris.length)
			drop_rows(new_ris)
		if (new_ris.length || moved_ris.length)
			update_tree_and_visible_ris()

		e.input_vals = [] // edited values by fi, then ri
		e.cell_errors = [] // cell errors by fi, then ri
	}

	// Set selected cells to null through set_cell_val(), with the usual edit
	// restrictions.
	e.set_null_selected_cells = function(ev) {
		let word_n = e.mask_word_n
		let sel_mask = e.sel_mask
		e.each_selected_row(ri => {
			for (let w = 0; w < word_n; w++) {
				let bits = sel_mask[ri * word_n + w] // selected cells of the word
				// Find the column for the lowest set bit, then clear that bit.
				while (bits) {
					let fi = w * 32 + 31 - Math.clz32(bits & -bits)
					e.set_cell_val(ri, fi, null, ev)
					bits &= bits - 1
				}
			}
		})
	}

	/// editing policy --------------------------------------------------------

	// Check these permissions only on calls from the user, with ev.input.
	e.can_add_rows    ??= true // the user may insert rows
	e.can_remove_rows ??= true // the user may remove rows
	e.can_change_rows ??= true // the user may edit saved rows
	e.can_move_rows   ??= true // the user may move rows

	// name: 'no_focus' | 'no_change' | 'no_remove' | 'no_save'
	e.set_row_flag = function(ri, name, on) {
		let bit = assert(row_config_bits[name], 'unknown row flag: ', name)
		set_bits(e.row_flags, ri, bit, on)
	}

	// the user may edit the cell.
	e.can_change_val = function(ri, fi) {
		let flags = e.row_flags[ri]
		if (e.all_fields[fi].readonly || flags & (ROW_NO_CHANGE | ROW_REMOVED))
			return false
		// Check can_change_rows only for saved rows.
		if (!(flags & ROW_NEW)
			&& !(e.can_change_rows && e.rowset_can_change_rows)
		) {
			return false
		}
		return is_cell_editable(ri, fi)
	}

	/// row slots and inserting -----------------------------------------------

	// Grow every array indexed by ri to cap slots. Keep the existing values.
	function set_capacity(cap1) {
		let word_n = e.mask_word_n
		e.col_vals = e.all_fields.map(field =>
			field.col_storage.grow_col(e.col_vals[field.fi], cap1))
		e.row_flags        = grow_typed(e.row_flags       , cap1)
		e.parent_ri        = grow_typed(e.parent_ri       , cap1)
		first_child_ri     = grow_typed(first_child_ri  , cap1)
		next_sibling_ri    = grow_typed(next_sibling_ri , cap1)
		e.depth            = grow_typed(e.depth           , cap1)
		e.desc_count       = grow_typed(e.desc_count      , cap1)
		e.tree_i           = grow_typed(e.tree_i          , cap1)
		tree_ris_buf       = grow_typed(tree_ris_buf      , cap1)
		e.visible_i        = grow_typed(e.visible_i       , cap1)
		e.visible_ris      = grow_typed(e.visible_ris     , cap1)
		prev_visible_ris   = grow_typed(prev_visible_ris, cap1)
		e.sel_mask         = grow_typed(e.sel_mask        , cap1 * word_n)
		e.changed_mask     = grow_typed(e.changed_mask    , cap1 * word_n)
		e.unset_mask       = grow_typed(e.unset_mask      , cap1 * word_n)
		cap = cap1
	}

	// allocate a row slot. reuse a freed slot before extending the arrays.
	function alloc_slot() {
		let ri
		if (free_ris.length) {
			ri = free_ris.pop()
		} else {
			if (slot_n == cap)
				set_capacity(Math.max(1, cap * 2))
			ri = slot_n++
			e.parent_ri[ri] = NONE
		}
		return ri
	}

	function free_slot(ri) {
		// Make apply_result() skip this row if the nav is saving it. The nav
		// may reuse its slot before the server replies.
		let batch_i = saving_ris.get(ri) // index in save_batch.ris
		if (batch_i != null) {
			save_batch.ris[batch_i] = NONE
			saving_ris.delete(ri)
		}

		// Subtract the row from changed_n if changed. Clear its state before
		// reusing the slot.
		if (is_row_changed(ri))
			e.changed_n--
		e.row_flags[ri] = 0
		e.parent_ri[ri] = NONE
		e.desc_count[ri] = 0
		e.visible_i[ri] = NONE
		clear_row_mask(e.changed_mask, ri)
		clear_row_mask(e.unset_mask, ri)
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			if (e.input_vals[fi])
				e.input_vals[fi][ri] = undefined
			set_cell_errors(ri, fi, null)
		}
		e.row_errors[ri] = undefined
		free_ris.push(ri)
	}

	// Accept rows as [[v1, ...] | null, ...], with cells in fi order. Use
	// client_default for undefined cells or for a null row. Insert before
	// at_ri, or at the end when at_ri is null. Return the new row indices, or
	// an empty array if refused. When sorted, insert at the chosen position in
	// sorted_ris and append to base_ris. Otherwise insert at that position in
	// base_ris. In a tree nav, use the same parent as at_ri. When grouped,
	// require a data row and copy its group keys. Refuse insertion under a new
	// parent because it has no id yet. With ev.input, also refuse a parent
	// marked for deletion or denied by policy.
	e.insert_rows = function(rows, at_ri, ev) {
		let none = new Uint32Array(0) // refused: no rows
		if (ev?.input)
			if (!e.can_add_rows || !e.rowset_can_add_rows)
				return none

		// Use at_ri's parent, or no parent when inserting at the end. When
		// grouped, look up the tree parent using at_ri's parent_id cell.
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

		// Refuse a new parent, and for user calls also a parent marked for
		// deletion.
		let refused_parent_flags = ev?.input ? ROW_NEW | ROW_REMOVED : ROW_NEW
		if (tree_parent_ri != NONE
			&& e.row_flags[tree_parent_ri] & refused_parent_flags
		) {
			return none
		}

		// take a slot for each new row and fill in its cells.
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
				// Leave the cell unset if neither a value nor a client default
				// was supplied.
				if (v === undefined)
					set_cell_bit(e.unset_mask, ri, field.fi, true)
				field.col_storage.set(e.col_vals[field.fi], ri, v ?? null)
			}
			e.row_flags[ri] = ROW_NEW | ROW_PASS
			e.parent_ri[ri] = parent_ri

			// Write parent_id so that the server and set_tree_parents() can read
			// the row's parent.
			if (e.can_be_tree) {
				let parent_field = e.parent_field
				parent_field.col_storage.set(e.col_vals[parent_field.fi], ri,
					parent_id)
				set_cell_bit(e.unset_mask, ri, parent_field.fi, false)
			}

			// Copy the grouping values from at_ri so that the new row belongs to
			// the same group, including for ranged columns.
			if (e.is_grouped)
				for (let fi of group_fis) {
					let field = e.all_fields[fi]
					field.col_storage.set(e.col_vals[fi], ri, col_val(at_ri, fi))
					set_cell_bit(e.unset_mask, ri, fi, false)
				}
		}

		// Insert before at_ri in stored order when unsorted. When sorted,
		// insert before at_ri in sort order and append to stored order.
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

		// update the counts, the pos values, the indexes and the rows shown.
		e.row_n += k
		e.changed_n += k
		if (e.pos_field)
			place_pos(base_i, k, true)
		add_to_indexes(ris)
		update_tree_and_visible_ris()
		return ris
	}

	/// row moving ------------------------------------------------------------

	// Write a pos or parent_id cell during a move, without the edit
	// restrictions or validation in set_cell_val(). Write directly to column
	// storage for new rows and store an edit for saved rows.
	function write_cell(ri, fi, v, is_indexed = true) {
		if (e.row_flags[ri] & ROW_NEW) {
			let field = e.all_fields[fi]
			field.col_storage.set(e.col_vals[fi], ri, v)
			set_cell_bit(e.unset_mask, ri, fi, false)
			if (cell_bit(e.changed_mask, ri, fi)) {
				set_cell_bit(e.changed_mask, ri, fi, false)
				e.input_vals[fi][ri] = undefined
			}
			if (is_indexed)
				invalidate_indexes(field)
			end_quicksearch_at(ri, fi)
		} else {
			set_input_val(ri, fi, v)
		}
	}

	// Compare parent_id values to check whether the rows share a position
	// list. In a flat nav, use one position list for all rows.
	function same_pos_list(ri1, ri2) {
		if (!e.can_be_tree)
			return true
		let parent_fi = e.parent_field.fi
		return e.cell_val(ri1, parent_fi) === e.cell_val(ri2, parent_fi)
	}

	// Assign pos values to the k rows starting at base_ris[i], between their
	// neighbors in the same position list. At either end, assign values before
	// or after the one neighbor. Renumber the list 1..m if floating point
	// precision is too low to assign distinct values between the neighbors.
	function place_pos(i, k, is_insert) {
		// find the pos values on both sides of the k rows, skipping rows of
		// other lists.
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

		// Space k values evenly between the neighbors. With one neighbor, count
		// by 1 before or after it. With neither, use 1..k.
		let vals = [] // the new pos values, in order
		for (let j = 1; j <= k; j++)
			vals.push(pos1 != null && pos2 != null
				? pos1 + (pos2 - pos1) * j / (k + 1)
				: pos1 != null ? pos1 + j
				: pos2 != null ? pos2 - (k + 1 - j)
				: j)

		// Check that the assigned values are distinct and between the
		// neighbors. Floating point precision may be too low for a narrow gap.
		let fits = (pos1 == null || vals[0] > pos1)
			&& (pos2 == null || vals[k - 1] < pos2)
		for (let j = 1; fits && j < k; j++)
			fits = vals[j] > vals[j - 1]

		// Write the assigned values, or renumber the whole list 1..m if needed.
		if (fits) {
			for (let j = 0; j < k; j++)
				write_cell(ris[i + j], pos_fi, vals[j], !is_insert)
		} else {
			let m = 0 // pos of the last renumbered row
			for (let j = 0; j < e.row_n; j++)
				if (same_pos_list(ris[j], ri))
					write_cell(ris[j], pos_fi, ++m,
						!is_insert || j < i || j >= i + k)
		}
	}

	// Restore parents and positions after changing pos or parent_id cells.
	// Look up each parent_id to set parent_ri, then sort base_ris by pos.
	// Include edited pos values; the nav writes these only during moves and
	// always as numbers.
	function update_row_places(ris) {
		// Look up each row's current parent_id, including pending edits, to set
		// its parent.
		if (e.can_be_tree) {
			let parent_fi = e.parent_field.fi
			for (let ri of ris) {
				let parent_id = e.cell_val(ri, parent_fi)
				e.parent_ri[ri] = parent_id != null
					? e.lookup(e.id_field.name, [parent_id]) ?? NONE : NONE
			}
		}

		// Sort base_ris by pos. Since radix_sort() reads column storage, copy
		// the pos column and write pending edits into the copy first.
		if (!e.pos_field)
			return
		let field = e.pos_field
		let col = e.col_vals[field.fi]
		if (e.input_vals[field.fi]) {
			col = col.slice() // pos with the edited values written in
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (cell_bit(e.changed_mask, ri, field.fi))
					field.col_storage.set(col, ri, e.input_vals[field.fi][ri])
			}
		}
		let was_unsorted = e.sorted_ris == e.base_ris
		e.base_ris = radix_sort(e.col_vals, e.base_ris, e.row_n,
			[{field: field, desc: false, col: col}])
		if (was_unsorted)
			e.sorted_ris = e.base_ris
	}

	// Refuse moves while sorted or grouped. To change parents, require a tree
	// nav and refuse a new row as parent because it has no id yet. Refuse a
	// parent among the moved rows or their descendants.
	function is_move_valid(ris, parent_ri) {
		if (e.order_by || e.is_grouped)
			return false
		let is_parent_change = false
		for (let ri of ris)
			if (e.parent_ri[ri] != parent_ri)
				is_parent_change = true
		if (!is_parent_change)
			return true
		if (!e.can_be_tree)
			return false
		if (parent_ri != NONE) {
			if (e.row_flags[parent_ri] & ROW_NEW)
				return false
			for (let p = parent_ri; p != NONE; p = e.parent_ri[p])
				if (ris.includes(p))
					return false
		}
		return true
	}

	// Allow the user to move sibling rows with their descendants only while
	// unsorted, unfiltered and ungrouped. Require tree view for a tree nav.
	// Require pos_col to reorder siblings. To change parents, require
	// can_change_parent and a writable parent_id. Refuse a new parent that is
	// new, marked for deletion, or among the moved rows and their descendants.
	e.can_actually_move_rows = function(ris, parent_ri) {
		if (!(e.can_move_rows && e.rowset_can_move_rows))
			return false
		if (e.filter || e.can_be_tree && !e.is_tree)
			return false

		// the rows must be siblings.
		let old_parent_ri = e.parent_ri[ris[0]]
		for (let ri of ris)
			if (e.parent_ri[ri] != old_parent_ri)
				return false

		// Require a pos column to reorder siblings. To change parents, require
		// a writable parent_id and a parent not marked for deletion.
		if (parent_ri == old_parent_ri) {
			if (!e.pos_field)
				return false
		} else if (!e.is_tree || !e.can_change_parent
			|| e.parent_field.readonly
			|| parent_ri != NONE && e.row_flags[parent_ri] & ROW_REMOVED
		) {
			return false
		}
		return is_move_valid(ris, parent_ri)
	}

	// Move ris before at_ri under parent_ri, or under no parent for NONE. With
	// at_ri null, append after the parent's children. Assign pos values
	// between the new neighbors. Return false if is_move_valid() refuses the
	// move, or with ev.input if can_actually_move_rows() refuses it.
	e.move_rows = function(ris, at_ri, parent_ri, ev) {
		let can_move = ev?.input
			? e.can_actually_move_rows(ris, parent_ri)
			: is_move_valid(ris, parent_ri)
		if (!can_move)
			return false

		// take the rows out of the stored order.
		let k = ris.length
		let is_moved = new Uint8Array(cap) // 1: row being moved
		for (let ri of ris)
			is_moved[ri] = 1
		let n = compact_list(e.base_ris, e.row_n, is_moved)

		// Insert the moved rows before at_ri. Leave descendants in stored
		// order; stage 3 places them after their parents in tree order.
		let i = at_ri == null ? n : list_index(e.base_ris, n, at_ri)
		e.base_ris = insert_into_list(e.base_ris, n, i,
			Uint32Array.from(ris), k)
		e.sorted_ris = e.base_ris

		// For each row changing parent, write the new parent to parent_ri and
		// to its parent_id cell.
		let parent_id = parent_ri != NONE
			? col_val(parent_ri, e.id_field.fi) : null
		for (let ri of ris)
			if (e.parent_ri[ri] != parent_ri) {
				e.parent_ri[ri] = parent_ri
				write_cell(ri, e.parent_field.fi, parent_id)
			}

		// give the rows pos values between their new neighbors.
		if (e.pos_field)
			place_pos(i, k)
		update_tree_and_visible_ris()
		return true
	}

	/// row removing ------------------------------------------------------------

	// Remove the rows from every list and index. Free their slots for reuse.
	function drop_rows(ris) {
		commit_rect()

		// take the rows out of the row orders and the indexes.
		let is_dropped = new Uint8Array(cap) // 1: row being dropped
		for (let ri of ris)
			is_dropped[ri] = 1
		let row_n = compact_list(e.base_ris, e.row_n, is_dropped)
		if (e.sorted_ris != e.base_ris)
			compact_list(e.sorted_ris, e.row_n, is_dropped)
		e.row_n = row_n
		for (let index of indexes.values())
			index.ris = index.ris.subarray(0,
				compact_list(index.ris, index.ris.length, is_dropped))

		// free each slot once: remove_rows() passes a new row twice when it
		// removes overlapping subtrees.
		for (let ri of ris)
			if (is_dropped[ri]) {
				is_dropped[ri] = 0
				free_slot(ri)
			}
		if (e.is_grouped)
			drop_empty_groups()
	}

	// Mark a saved row for deletion, or collect a new row in new_ris to drop
	// it. Leave group rows unmarked because they are not records. Return false
	// if is_input is set and the row has no_remove.
	function mark_removed(ri, new_ris, is_input) {
		let flags = e.row_flags[ri]
		if (is_input && flags & ROW_NO_REMOVE)
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

	// Mark ri and its descendants for deletion. For user calls, keep rows with
	// no_remove and keep their ancestors. Walk backward to check descendants
	// before their parents. Set is_kept to 1 for each parent of a kept row.
	function mark_subtree_removed(ri, new_ris, is_kept, is_input) {
		let i1 = e.tree_i[ri] // the subtree in tree_ris: [i1 .. i2]
		let i2 = i1 + e.desc_count[ri]
		for (let i = i2; i >= i1; i--) {
			let ri1 = e.tree_ris[i]
			if (is_kept[ri1] || !mark_removed(ri1, new_ris, is_input)) {
				let parent_ri = e.parent_ri[ri1]
				if (parent_ri != NONE)
					is_kept[parent_ri] = 1
			}
		}
	}

	// Unmark ri and its marked ancestors. Unmark its marked descendants too,
	// stopping at each unmarked data row. Continue through group rows because
	// they are not records.
	function unmark_subtree_removed(ri) {
		let row_flags = e.row_flags
		if (!(row_flags[ri] & (ROW_REMOVED | ROW_GROUP)))
			return

		// unmark the row and its marked ancestors, as a kept row can't have a
		// deleted parent.
		if (row_flags[ri] & ROW_REMOVED)
			unmark_removed(ri)
		for (let p = e.parent_ri[ri];
			p != NONE && row_flags[p] & ROW_REMOVED; p = e.parent_ri[p]
		) {
			unmark_removed(p)
		}

		// unmark its marked descendants, down to the first unmarked row on
		// each branch.
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

	// With op 'delete' (the default), mark rows for deletion and drop new
	// rows. In tree or grouped view, include their descendants. With
	// 'undelete', clear the marks. With ev.input, refuse deletion if policy
	// demands it, and keep rows with no_remove.
	e.remove_rows = function(ris, op, ev) {
		let has_parents = e.is_tree || e.is_grouped
		if (op == 'undelete') {
			for (let ri of ris)
				if (has_parents)
					unmark_subtree_removed(ri)
				else
					unmark_removed(ri)
		} else if (!ev?.input || (e.can_remove_rows && e.rowset_can_remove_rows)) {
			let new_ris = [] // new rows to drop
			if (has_parents) {
				let is_kept = new Uint8Array(cap) // see mark_subtree_removed()
				for (let ri of ris)
					mark_subtree_removed(ri, new_ris, is_kept, ev?.input)
			} else {
				for (let ri of ris)
					mark_removed(ri, new_ris, ev?.input)
			}

			// Drop new rows now because they have not been saved to the server.
			if (new_ris.length) {
				drop_rows(new_ris)
				update_tree_and_visible_ris()
			}
		}
	}

	/// saving ----------------------------------------------------------------

	let save_req = null // pending id or save request, or null
	let save_batch = null // pending batch: {rows: [...], ris: [...]}
	let saving_ris = map() // batch row positions: {ri -> index}
	let want_save = false // save requested during a pending request
	let want_reload = false // reload requested during a pending request
	let own_update_ids = new Set() // ids of this nav's saves

	function rowset_url() {
		return href('/rowset.json/' + e.rowset_name)
	}

	// Copy the last saved primary key so that the server can find the row.
	function add_old_pk(values, ri) {
		for (let field of e.pk_fields)
			values[field.name + ':old'] = col_val(ri, field.fi)
	}

	// Pack a changed row in rowset.lua's save format. Return null if there is
	// nothing to send.
	function pack_row(ri) {
		let flags = e.row_flags[ri]
		let values = {} // {col -> val}
		if (flags & ROW_REMOVED) {
			add_old_pk(values, ri)
			return {type: 'remove', values: values}
		}
		if (flags & ROW_NEW) {
			for (let field of e.all_fields) {
				let v = e.cell_val(ri, field.fi)
				// Omit unset cells so that the server can use its defaults.
				if (!field.nosave && v !== undefined)
					values[field.name] = v
			}
			return {type: 'new', values: values}
		}

		// Send a saved row's edited cells and its last saved primary key so
		// that the server can find it.
		let has_vals = false
		for (let field of e.all_fields)
			if (!field.nosave && cell_bit(e.changed_mask, ri, field.fi)) {
				values[field.name] = e.input_vals[field.fi][ri]
				has_vals = true
			}
		if (!has_vals)
			return null
		add_old_pk(values, ri)
		return {type: 'update', values: values}
	}

	// Return {rows: [...], ris: [...]} in rowset.lua's save format, or null if
	// no row is ready. Walk tree_ris backward to send children before parents.
	// Skip no_save rows and invalid rows, except rows marked for deletion.
	// Keep the batch until apply_result() or end_save(), and allow only one
	// batch at a time.
	e.pack_changes = function() {
		assert(!save_batch)
		let batch = {rows: [], ris: []}
		for (let i = e.tree_n - 1; i >= 0; i--) {
			let ri = e.tree_ris[i]
			let flags = e.row_flags[ri]
			if (flags & (ROW_GROUP | ROW_NO_SAVE) || !is_row_changed(ri))
				continue
			// Send rows marked for deletion without validating their cells.
			if (!(flags & ROW_REMOVED) && !e.validate_row(ri))
				continue
			let t = pack_row(ri)
			if (!t)
				continue
			saving_ris.set(ri, batch.ris.length)
			batch.rows.push(t)
			batch.ris.push(ri)
		}
		if (!batch.ris.length)
			return null
		save_batch = batch
		return batch
	}

	// Finish the batch. Keep any changes not accepted by apply_result() for
	// the next save.
	function end_save() {
		save_batch = null
		saving_ris.clear()
	}

	// Return the values sent in t, indexed by fi. Leave unsent cells
	// undefined.
	function sent_vals(t) {
		let vals = []
		for (let col in t.values) {
			// Skip the 'col:old' values used to identify the saved row.
			let field = e.all_fields_map[col]
			if (field)
				vals[field.fi] = t.values[col]
		}
		return vals
	}

	// Write vals[fi] into column storage, leaving cells unchanged for
	// undefined. Mark the row saved and keep only edits differing from the
	// server values. Set is_changed_col[fi] for each changed column. Return
	// true if pos or parent_id changed.
	function set_server_vals(ri, vals, is_changed_col) {
		// Mark the row saved and clear its unset cells.
		let was_changed = is_row_changed(ri)
		set_bits(e.row_flags, ri, ROW_NEW, false)
		clear_row_mask(e.unset_mask, ri)
		update_changed_n(ri, was_changed)

		// Write the server values into the columns and clear edits equal to
		// them.
		let is_moved = false
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			let v = vals[fi]
			if (v === undefined)
				continue
			let field = e.all_fields[fi]
			if (v !== col_val(ri, fi)) {
				field.col_storage.set(e.col_vals[fi], ri, v)
				is_changed_col[fi] = 1
				update_server_cell(ri, fi)
				if (fi == e.pos_field?.fi || fi == e.parent_field?.fi)
					is_moved = true
			} else {
				// Clear the edit even if the server value equals the stored value
				// of a previously unset cell.
				clear_edit_if_same(ri, fi)
			}
		}
		return is_moved
	}

	// Clear an edit equal to the cell's server value.
	function clear_edit_if_same(ri, fi) {
		if (cell_bit(e.changed_mask, ri, fi)
			&& e.input_vals[fi][ri] === col_val(ri, fi)
		) {
			let was_changed = is_row_changed(ri)
			set_cell_bit(e.changed_mask, ri, fi, false)
			e.input_vals[fi][ri] = undefined
			update_changed_n(ri, was_changed)
		}
	}

	// Update the edit and quicksearch after writing a server value into the
	// cell.
	function update_server_cell(ri, fi) {
		// End quicksearch only for an unedited cell, since the nav displays the
		// pending value of an edited cell.
		if (!cell_bit(e.changed_mask, ri, fi))
			end_quicksearch_at(ri, fi)
		clear_edit_if_same(ri, fi)
	}

	function invalidate_changed_cols(is_changed_col) {
		for (let fi = 0; fi < is_changed_col.length; fi++)
			if (is_changed_col[fi])
				invalidate_indexes(e.all_fields[fi])
	}

	// Store errors reported by rowset.lua: rt.error is a message, or true for
	// field errors alone; rt.field_errors is {col -> message}. Keep the row
	// changed so that the user can correct it.
	function set_server_errors(ri, rt) {
		let errors // validator error results
		if (isstr(rt.error)) {
			errors = [{error: rt.error, failed: true}]
			errors.failed = true
		}
		e.row_errors[ri] = errors
		for (let col in rt.field_errors) {
			let fi = e.all_fields_map[col].fi
			let cell_errors = [{error: rt.field_errors[col], failed: true}]
			cell_errors.failed = true
			set_cell_errors(ri, fi, cell_errors)
		}
		update_invalid(ri)
	}

	// Apply rowset.lua's reply, with one result per sent row.
	e.apply_result = function(batch, result) {
		let drop_ris = [] // rows the server removed
		let moved_ris = [] // rows whose pos or parent_id changed
		let is_changed_col = new Uint8Array(e.all_fields.length) // by fi

		// Apply the server's reply to each sent row: remove it, store its
		// errors, or mark it saved.
		for (let k = 0; k < batch.ris.length; k++) {
			let ri = batch.ris[k]
			// Skip rows dropped before the server replied.
			if (ri == NONE)
				continue
			let rt = result.rows[k]
			if (rt.remove) {
				drop_ris.push(ri)
			} else if (rt.error || rt.field_errors) {
				set_server_errors(ri, rt)
			} else {
				// Use the sent values if the server did not return row values.
				let vals = rt.values ?? sent_vals(batch.rows[k])
				if (set_server_vals(ri, vals, is_changed_col))
					moved_ris.push(ri)
			}
		}

		// end the batch, then update the indexes, put moved rows back in
		// place and drop the removed rows.
		end_save()
		invalidate_changed_cols(is_changed_col)
		if (moved_ris.length)
			update_row_places(moved_ris)
		if (drop_ris.length)
			drop_rows(drop_ris)
		if (drop_ris.length || moved_ris.length)
			update_tree_and_visible_ris()

		// Discard the edit and error arrays if no changed rows remain.
		if (!e.changed_n) {
			e.input_vals = [] // edited values by fi, then ri
			e.cell_errors = [] // cell errors by fi, then ri
		}
	}

	// Reserve ids before saving new rows so that the nav can resend an insert
	// with the same id. Return true if a request was sent. Try saving again
	// when the request finishes.
	function reserve_ids() {
		// collect the new rows to save that have no id yet.
		let pk_fi = e.pk_fields[0].fi
		let new_ris = [] // new rows without an id
		for (let i = 0; i < e.row_n; i++) {
			let ri = e.base_ris[i]
			if ((e.row_flags[ri] & (ROW_NEW | ROW_NO_SAVE)) == ROW_NEW
				&& e.cell_val(ri, pk_fi) == null
			) {
				new_ris.push(ri)
				// Request at most 1000 ids, the limit in rowset.lua. Reserve the
				// remaining ids in later requests.
				if (new_ris.length == 1000)
					break
			}
		}
		if (!new_ris.length)
			return false

		// ask the server for that many ids; on success, write them and save
		// again.
		save_req = ajax({
			url: rowset_url(),
			upload: {exec: 'reserve_ids', n: new_ris.length},
			success: function(res) {
				if (this != save_req)
					return
				for (let i = 0; i < new_ris.length; i++) {
					let ri = new_ris[i]
					// The nav may have dropped this row and reused its slot since
					// requesting ids.
					if (e.row_flags[ri] & ROW_NEW && e.cell_val(ri, pk_fi) == null)
						write_cell(ri, pk_fi, res.ids[i])
				}
				want_save = true
			},
			done: end_request,
		})
		save_req.send()
		return true
	}

	// Finish the request whether it succeeded or failed. Keep unsaved changes
	// after a failure. Then run any waiting reload or save.
	function end_request() {
		// Ignore a request canceled by load() or free().
		if (this != save_req)
			return
		save_req = null
		end_save()
		if (want_reload) {
			want_reload = false
			e.reload()
		}
		if (want_save) {
			want_save = false
			e.save()
		}
	}

	// Send changed rows to their server rowset, one request at a time. Defer
	// save() if another request is still running.
	e.save = function() {
		assert(e.rowset_name, 'save: rowset_name required')
		if (save_req) {
			want_save = true
			return
		}
		if (e.reserves_ids && reserve_ids())
			return
		let batch = e.pack_changes()
		if (!batch)
			return

		// Assign a save id so that rowset_changed() can ignore the server
		// notification for this save.
		let update_id = floor(Math.random() * 2**52).toString(36)
		own_update_ids.add(update_id)
		save_req = ajax({
			url: rowset_url(),
			upload: {
				exec: 'save',
				changes: {rows: batch.rows},
				update_id: update_id,
			},
			success: function(result) {
				if (this == save_req)
					e.apply_result(batch, result)
			},
			done: end_request,
		})
		save_req.send()
	}

	/// merging ---------------------------------------------------------------

	// Check whether rs has the same columns and keys as the loaded rowset.
	function is_same_rowset(rs) {
		if (!isobj(rs) || !isarray(rs.fields))
			return false
		if (rs.fields.length != e.all_fields.length)
			return false
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let rs_field = rs.fields[fi]
			if (!isobj(rs_field))
				return false
			// Use all_field_types.type when the field has no explicit type.
			let type = rs_field.type ?? ui.all_field_types.type
			if (rs_field.name !== e.all_fields[fi].name
				|| type !== e.all_fields[fi].type
			) {
				return false
			}
		}
		let pk = rs.pk
		if (isarray(pk)) {
			for (let col of pk)
				if (!check_col_name(col))
					return false
			pk = pk.join(' ')
		} else if (!isstr(pk)) {
			return false
		}
		return pk === e.pk
			&& (rs.pos_col ?? null) === (e.pos_field?.name ?? null)
			&& (rs.parent_col ?? null) === (e.parent_field?.name ?? null)
			&& (rs.id_col == null || rs.id_col === e.id_field?.name)
	}

	// Compare ri's primary key with incoming row in_i's primary key. Return
	// -1, 0 or 1.
	function compare_pk(ri, in_col_vals, in_i) {
		for (let field of e.pk_fields) {
			let storage = field.col_storage
			let r = storage.compare_cell(e.col_vals[field.fi], ri,
				storage.get(in_col_vals[field.fi], in_i))
			if (r)
				return r
		}
		return 0
	}

	// Merge a reloaded rowset, matching rows by primary key. Use load(rs) if
	// the columns or keys differ. Copy server values into matched saved rows
	// and keep edits differing from them. Keep matched new rows new. Add rows
	// found only on the server and drop saved rows no longer on the server.
	// Sort incoming rows by primary key and compare them with the nav's
	// primary key index.
	e.diff_merge = function(rs) {
		if (!is_same_rowset(rs)) {
			e.load(rs)
			return
		}

		// load the incoming rows into columns and sort them by pk.
		let fields = e.all_fields
		let in_cols = rowset_col_vals(rs, fields.length)
		if (!in_cols)
			return
		let m = in_cols[0].length // incoming row count
		let in_col_vals = fields.map(field => // incoming columns, by fi
			field.col_storage.load_col(in_cols[field.fi], m))
		let in_is = new Uint32Array(m) // incoming row indexes, by pk
		for (let i = 0; i < m; i++)
			in_is[i] = i
		in_is = radix_sort(e.col_vals, in_is, m, e.pk_fields.map(field =>
			({field: field, desc: false, col: in_col_vals[field.fi]})))

		// Compare the nav's rows with incoming rows in primary key order. Drop
		// saved rows found only in the nav, add rows found only on the server,
		// and collect matching rows.
		let pk_ris = get_index(e.pk).ris // the rows, by pk
		let is_changed_col = new Uint8Array(fields.length) // by fi
		let match_ris = new Uint32Array(m) // matched saved rows
		let match_is = new Uint32Array(m) // their incoming row indexes
		let match_n = 0 // length of match_ris and match_is
		let drop_ris = [] // rows the server no longer has
		let add_is = [] // incoming rows to add
		let pk_i = 0 // index in pk_ris
		let j = 0 // index in in_is
		while (pk_i < pk_ris.length || j < m) {
			let ri = pk_i < pk_ris.length ? pk_ris[pk_i] : NONE
			let r = j == m ? -1 : ri == NONE ? 1
				: compare_pk(ri, in_col_vals, in_is[j])
			if (r < 0) {
				if (!(e.row_flags[ri] & ROW_NEW))
					drop_ris.push(ri)
				pk_i++
			} else if (r > 0) {
				add_is.push(in_is[j])
				j++
			} else {
				// Keep a new row new when its reserved id matches a server row.
				// If the server inserted it but the reply was lost, resend it on
				// the next save; the server skips the duplicate insert.
				if (!(e.row_flags[ri] & ROW_NEW)) {
					match_ris[match_n] = ri
					match_is[match_n++] = in_is[j]
				}
				pk_i++
				j++
			}
		}

		// Copy changed cells from matched saved rows, one column at a time.
		// Update edits and quicksearch only for the copied cells.
		let changed_ks = new Uint32Array(match_n) // indexes in match_ris
		for (let field of fields) {
			let fi = field.fi
			let changed_cell_n = field.col_storage.copy_changed(e.col_vals[fi],
				match_ris, in_col_vals[fi], match_is, match_n, changed_ks)
			if (changed_cell_n)
				is_changed_col[fi] = 1
			for (let c = 0; c < changed_cell_n; c++)
				update_server_cell(match_ris[changed_ks[c]], fi)
		}

		// Remove the current groups and rows no longer on the server. Clear
		// their focus and selection before alloc_slot() reuses their slots.
		// Rebuild groups afterward.
		let levels = e.is_grouped ? parse_group_by(e.group_by) : null
		if (levels)
			remove_groups()
		if (drop_ris.length)
			drop_rows(drop_ris)
		if (levels || drop_ris.length)
			e.focus_cell(e.focused_ri, e.focused_fi, 'deselect_hidden')

		// add the rows that only the server has, at the end of the stored
		// order.
		let k = add_is.length
		let new_ris = new Uint32Array(k) // the added rows' slots
		for (let a = 0; a < k; a++) {
			let ri = alloc_slot()
			new_ris[a] = ri
			for (let field of fields)
				field.col_storage.set(e.col_vals[field.fi], ri,
					field.col_storage.get(in_col_vals[field.fi], add_is[a]))
			e.row_flags[ri] = ROW_PASS
		}
		let was_unsorted = e.sorted_ris == e.base_ris
		e.base_ris = insert_into_list(e.base_ris, e.row_n, e.row_n, new_ris, k)
		if (was_unsorted)
			e.sorted_ris = e.base_ris
		e.row_n += k

		// invalidate the indexes of the columns written, and add the new rows
		// to the other indexes.
		invalidate_changed_cols(is_changed_col)
		add_to_indexes(new_ris)

		// Apply the filter again to unchanged rows. Keep changed rows visible.
		if (e.filter)
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (!is_row_changed(ri))
					set_bits(e.row_flags, ri, ROW_PASS, e.filter(ri))
			}

		// Rebuild parents, positions and sort order only when the corresponding
		// values changed.
		let has_added_or_dropped = k > 0 || drop_ris.length > 0
		let edited_parent_ris = [] // rows with parent_id edits
		if (levels) {
			add_groups(levels)
		} else if (e.can_be_tree && (has_added_or_dropped
			|| is_changed_col[e.id_field.fi]
			|| is_changed_col[e.parent_field.fi])
		) {
			set_tree_parents()
			let parent_fi = e.parent_field.fi
			if (e.input_vals[parent_fi])
				for (let i = 0; i < e.row_n; i++)
					if (cell_bit(e.changed_mask, e.base_ris[i], parent_fi))
						edited_parent_ris.push(e.base_ris[i])
		}
		let is_pos_changed = !!e.pos_field
			&& (k > 0 || !!is_changed_col[e.pos_field.fi])
		// Restore parents from pending parent_id edits and restore pos order.
		if (edited_parent_ris.length || is_pos_changed)
			update_row_places(edited_parent_ris)
		if (e.order_by
			&& (k > 0 || is_pos_changed || is_changed_col.includes(1))
		) {
			e.set_order_by(e.order_by)
		} else {
			update_tree_and_visible_ris()
		}
	}

	/// reloading -------------------------------------------------------------

	let load_req = null // pending load request, or null

	// Load the server rowset with load() the first time and with diff_merge()
	// afterward. Wait for a pending save to finish before reloading, because
	// the server may not have saved those values yet.
	e.reload = function() {
		assert(e.rowset_name, 'reload: rowset_name required')
		if (save_req) {
			want_reload = true
			return
		}
		load_req?.abort()
		load_req = ajax({
			url: rowset_url(),
			success: function(rs) {
				if (this != load_req)
					return
				if (e.all_fields)
					e.diff_merge(rs)
				else
					e.load(rs)
			},
			done: function() {
				if (this == load_req)
					load_req = null
			},
		})
		load_req.send()
	}

	// Reload for server notifications, except those from this nav's own saves.
	function rowset_changed(update_ids) {
		let is_own = true
		for (let update_id of update_ids)
			if (!own_update_ids.delete(update_id))
				is_own = false
		if (!is_own)
			e.reload()
	}

	// Stop listening for server notifications, abort loading, and ignore
	// replies to pending saves.
	e.free = function() {
		rowset_listeners[e.rowset_name]?.delete(rowset_changed)
		load_req?.abort()
		load_req = null
		save_req = null
	}

	/// loading ---------------------------------------------------------------

	// Convert row arrays to col_n column arrays.
	function rows_to_cols(rows, col_n) {
		if (warn_if(!isarray(rows), e.id, 'invalid rows'))
			return null
		let cols = []
		for (let fi = 0; fi < col_n; fi++)
			cols.push(new Array(rows.length))
		for (let ri = 0; ri < rows.length; ri++) {
			let row = rows[ri]
			if (warn_if(!isarray(row), e.id, 'invalid row:', ri))
				return null
			for (let fi = 0; fi < col_n; fi++)
				cols[fi][ri] = row[fi]
		}
		return cols
	}

	// accept server values as one array per row or one array per column.
	function rowset_col_vals(rs, col_n) {
		if (rs.col_vals == null)
			return rows_to_cols(rs.rows, col_n)
		if (warn_if(!isarray(rs.col_vals) || rs.col_vals.length != col_n,
			e.id, 'invalid col_vals'))
			return null
		for (let fi = 0; fi < col_n; fi++) {
			let col_vals = rs.col_vals[fi]
			if (warn_if(!(isarray(col_vals)
				|| col_vals instanceof Float64Array
				|| col_vals instanceof Uint8Array),
				e.id, 'invalid col_vals:', fi))
				return null
		}
		return rs.col_vals
	}

	let invalid_col_name_re = /^[0-9]|[^a-z0-9_]/

	function check_col_name(col) {
		let ok = isstr(col) && col.length > 0 && !invalid_col_name_re.test(col)
		warn_if(!ok, e.id, 'invalid field name: ', col)
		return ok
	}

	function col_field(col, all_fields_map) {
		if (col == null || !check_col_name(col))
			return
		let field = all_fields_map[col]
		if (warn_if(!field, e.id, 'unknown column:', col))
			return null
		return field
	}

	// Accept rs with fields and either col_vals or rows. After accepting the
	// rowset, ignore replies to pending saves because the nav has replaced
	// their rows.
	e.load = function(rs) {
		if (warn_if(!isarray(rs.fields), e.id, 'fields array required'))
			return
		if (warn_if(!rs.fields.length, e.id, 'no fields'))
			return

		// Create one field per column. Refuse invalid or duplicate names and
		// fields rejected by ui.create_field().
		let all_fields = [] // [field1, ...] by fi
		let all_fields_map = obj() // {col->field}
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let field_opt = rs.fields[fi]
			let name = field_opt?.name
			if (!check_col_name(name))
				return
			if (warn_if(all_fields_map[name], e.id, 'duplicate field name:', name))
				return
			let field = ui.create_field(field_opt, e.id)
			if (!field)
				return
			field.fi = fi // column index
			all_fields.push(field)
			all_fields_map[name] = field
		}

		// find the pk columns (required) and the pos, id and parent columns.
		// stop on an unknown column.
		let pk = isarray(rs.pk) ? rs.pk.join(' ') : rs.pk
		let pk_cols = isarray(rs.pk) ? rs.pk : words(rs.pk ?? '')
		if (warn_if(!(isarray(pk_cols) && pk_cols.length),
			e.id, 'pk required'))
			return
		let pk_fields = []
		for (let col of pk_cols) {
			if (!check_col_name(col))
				return
			let field = all_fields_map[col]
			if (warn_if(!field, e.id, 'unknown column:', col))
				return
			pk_fields.push(field)
		}
		let pos_field = col_field(rs.pos_col, all_fields_map)
		let id_field = rs.id_col == null
			? pk_fields.length == 1 ? pk_fields[0] : null
			: col_field(rs.id_col, all_fields_map)
		let parent_field = col_field(rs.parent_col, all_fields_map)
		if (rs.pos_col != null && !pos_field
			|| rs.id_col != null && !id_field
			|| rs.parent_col != null && !parent_field)
			return

		let col_vals = rowset_col_vals(rs, all_fields.length)
		if (!col_vals)
			return
		let n = col_vals[0].length // row count
		let cap1 = n + 1
		let e_col_vals = all_fields.map(field =>
			field.col_storage.load_col(col_vals[field.fi], cap1))

		// Ignore the pending save's reply and clear any waiting save or reload
		// before replacing the rows.
		save_req = null
		end_save()
		want_save = false
		want_reload = false
		e.all_fields = all_fields
		e.all_fields_map = all_fields_map

		e.row_n = n // data row count
		e.col_vals = e_col_vals // column values by fi, then ri

		cap = cap1 // capacity of every ri-indexed array (+1 for 1 free insert)
		e.row_flags        = new Uint16Array(cap) // ROW_* bits by ri
		e.parent_ri        = new Uint32Array(cap).fill(NONE) // parent, or NONE
		first_child_ri     = new Uint32Array(cap) // set by stage 3
		next_sibling_ri    = new Uint32Array(cap) // set by stage 3
		e.depth            = new Uint16Array(cap) // indent level by ri
		e.desc_count       = new Uint32Array(cap) // descendant count by ri
		e.tree_i           = new Uint32Array(cap) // index in tree_ris by ri
		tree_ris_buf       = new Uint32Array(cap)
		e.visible_i        = new Uint32Array(cap) // index in visible_ris by ri
		e.visible_ris      = new Uint32Array(cap) // ri's shown, in order
		prev_visible_ris   = new Uint32Array(cap) // visible_ris before stage 5
		e.visible_n = 0 // length of visible_ris

		// Include every row before applying a filter.
		e.filter = null // filter function, or null
		e.row_flags.fill(ROW_PASS)

		// Stage 1: init base_ris and sorted_ris.
		e.base_ris = new Uint32Array(n) // ri's in stored order
		for (let ri = 0; ri < n; ri++)
			e.base_ris[ri] = ri
		e.pos_field = pos_field
		// Use pos order as stored order when pos_col is set.
		if (e.pos_field)
			e.base_ris = radix_sort(e.col_vals, e.base_ris, n,
				[{field: e.pos_field, desc: false}])

		// Use the same array for both orders when unsorted.
		e.order_by = null // sort columns, sort function, or null
		e.sorted_ris = e.base_ris // data rows' ri's in sort order

		indexes = map() // {cols -> {fields:, ris:}}, built on first lookup
		e.pk = pk // 'col1 ...'
		e.pk_fields = pk_fields // [field1, ...]

		// Check rowset permissions only for calls from the user, with ev.input.
		e.rowset_can_add_rows    = rs.can_add_rows    != false // user inserts
		e.rowset_can_remove_rows = rs.can_remove_rows != false // user removals
		e.rowset_can_change_rows = rs.can_change_rows != false // user edits
		e.rowset_can_move_rows   = rs.can_move_rows   != false // user moves
		e.reserves_ids = !!rs.reserves_ids // reserve ids before saving new rows

		e.visible_fields = e.all_fields.slice() // visible columns, in display order
		for (let i = 0; i < e.visible_fields.length; i++)
			e.visible_fields[i].index = i // position in fields
		e.mask_word_n = (e.all_fields.length + 31) >>> 5 // W: words per row
		e.sel_mask = new Uint32Array(cap * e.mask_word_n) // selected cells' bits
		has_sel_bits = false // false: sel_mask is all zero
		e.focused_ri = null // focused row, or null
		e.focused_fi = null // focused column
		e.quicksearch_text = '' // typed prefix of the focused cell's text
		set_rect(null, null, null, null) // no selection rectangle

		e.changed_mask = new Uint32Array(cap * e.mask_word_n) // edited cells
		e.unset_mask = new Uint32Array(cap * e.mask_word_n) // server default
		e.changed_n = 0 // number of changed rows
		e.input_vals = [] // edited values by fi, then ri
		e.cell_errors = [] // cell errors by fi, then ri
		e.row_errors = [] // row errors by ri

		slot_n = n // slots ever used, free ones included
		free_ris = [] // freed slots, used as a stack

		e.id_field = id_field
		e.parent_field = parent_field
		e.can_be_tree = !!(e.id_field && e.parent_field)
		e.flat ??= false // flat view of a tree nav
		e.group_by = null // group-by spec, or null
		e.is_grouped = false
		e.group_ris = new Uint32Array(0) // group row indices in key order
		group_fis = new Set() // the group-by key columns' fi's
		update_is_tree()
		if (e.can_be_tree)
			set_tree_parents()
		update_tree_and_visible_ris()
	}

	// Load the named server rowset and listen for reload notifications.
	if (e.rowset_name) {
		listen_rowset_events()
		rowset_listeners[e.rowset_name] ??= new Set()
		rowset_listeners[e.rowset_name].add(rowset_changed)
		e.reload()
	}

	return e
}

}())
