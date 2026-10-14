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

	rowset_name    string       the rowset in ui.rowsets or on the server

Access options:
	per-nav and/or per-rowset:
		can_{add|remove|change|move}_rows, can_change_parent
	per-row:
		readonly, no_remove

NOTE: Nav enforces can_* options only on UI calls with ev.input.

DATA STRUCTURES --------------------------------------------------------------

The nav gives every row a slot number ri (row index) at load or insert and
keeps it until the row is deleted and the slot is reused. The nav stores every
per-row fact in a typed array indexed by ri, and every ordered list of rows as
a Uint32Array of ris.

	n          number of rows
	k          number of rows passed to an op
	ri         row index; NONE = 0xFFFFFFFF
	fi         field index in stable all_fields
	vfi        field index in visible_fields
	W          number of uint32s (i.e. words) needed per row for bitmasks
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
modified_mask says which cells are edited.

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
	modified_mask    Uint32 x W  one bit per edited cell; nonzero: modified
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
	tree_i           Uint32      index in tree_ris

Row lists, each a Uint32Array of ris, shifted when rows are deleted:

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
	is_unplaced    ROW_UNPLACED    row stays where the user left it, outside
	                               the sort and the filter
ROW EDITING STATE
	is_new         ROW_NEW         inserted, not saved yet
	is_removed     ROW_REMOVED     marked for deletion
	is_invalid     ROW_INVALID     row or one of its cells failed validation
ROW OPTIONS
	no_focus       ROW_NO_FOCUS    row can't be focused
	readonly       ROW_READONLY    row's cells can't be edited
	no_remove      ROW_NO_REMOVE   row can't be deleted
	no_save        ROW_NO_SAVE     row is never saved

Other state:

	name           type         holds
	-------------  -----------  ---------------------------------------------
FIELDS
	all_fields     Array[fi]    field objects made with ui.create_field()
	all_fields_map object       {name->field}
	fields         Array[vfi]   visible columns in display order
	field.fi       number       field index in all_fields array
	field.vfi      number       field index in visible_fields array
	mask_word_n    number       W: words per row in sel_mask and modified_mask
ROW ALLOCATION
	cap            number       capacity of every ri-indexed array
	slot_n         number       row slots ever used, free ones included
	free_ris       Array        free row slots, used as a stack
EDITING
	modified_n      number       number of modified rows
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
	pk                 on reload_rowset         find recorded rows
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
	- load, insert, move and drop write base_ris directly. Reverting or
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
	- load, group, ungroup and move write parent_ri.
	- grouping creates group_ris. ungrouping and drop_empty_groups() shifts it.

GRID OPS ---------------------------------------------------------------------

SORT
	- run stages 2-5.

UNSORT
	- set sorted_ris to base_ris.
	- run stages 3-5.

FILTER
	- set is_pass from row_filter(ri) for each data row; keep it set for new
	  and modified rows until save.
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
	- write input_vals[fi][ri] and set cell's modified_mask bit; clear it when the
	  value is set to the server value.
	- validate the cell: write or clear cell_errors[fi][ri]; set is_invalid from
	  cell and row errors. set is_pass.
	- O(1); no stage runs.

REVERT CELL
	- clear the modified_mask bit, input_vals entry and cell_errors entry.
	- run stages 3-5 when reverting pos_col or parent_id; otherwise no stage runs.

UNSET CELL
	- a cell in a new row with no value and no client_default at insert is unset;
	  cell_input_val is undefined and save omits it.
	- validate row checks it unless the field has a server default.
	- an edit, including null, gives it a value; revert cell makes it unset again.

REVERT ROW
	- drop a new row; otherwise revert each edited cell.
	- run stages 3-5 when dropping a new row or reverting pos_col or parent_id.

REVERT ALL
	- scan base_ris for modified rows; drop new rows in one pass and undelete and
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
	- With an auto_increment pk, reserve ids for new rows without ids before
	  saving.
	- Scan tree_ris forward for new and edited rows, then backward for rows
	  marked for deletion; skip group rows, no_save rows, rows awaiting a save
	  reply and rows failing validation, except rows marked for deletion.
	- Send new rows without unset cells, modified rows with pk:old and modified_mask
	  cells, and removed rows with pk:old. Parents go before children, except
	  for deletes, where children go before parents.
	- Wait for the server's reply before finishing the batch. Keep rows modified
	  if the request fails.
	- When the request fails, the server may have saved the batch anyway: reload
	  before the next save, so that the reload finds the rows that the server
	  inserted.
	- O(n); does not run a stage.

SAVE ACK
	- Process sent rows by position. Drop removed rows; record row_errors and
	  cell_errors on errors and leave the row modified.
	- Otherwise write server values, or sent values, into columns; edits equal to
	  column values stop counting as edits; clear is_new and unset bits.
	- Drop a new row marked for deletion while it was in flight if its insert
	  failed; invalidate indexes for written columns.
	- when modified_n reaches 0, drop input_vals and cell_errors arrays.
	- run stages 3-5 when rows are dropped or pos_col or parent_id changes;
	  otherwise no stage runs.

MERGE k ROWS (merge_rows)
	- find the rows by pk, and the removed rows.
	- write server values into found rows; a new row found becomes the saved
	  row, with its values that differ as edits. Add the rows not found.
	- if no row moves, appears or goes away: done, O(k).
	- a found row moves when pos or parent_id changes, or, without pending
	  changes, when its sort or group keys or filter result change or it is
	  unplaced.
	- otherwise: append added rows, place moved and added rows by pos and
	  parent; sort the rows that are neither modified nor unplaced into their
	  positions; filter; rebuild groups; run stages 3-5. O(n).

RELOAD ROWSET
	- check if row definition differs and load instead if it does.
	- record the pending changes and collapsed flags by pk.
	- load the rows, keeping the fields, the filters, order_by, group_by,
	  cols and the flat mode; reset focus, selection and quicksearch.
	- find each recorded row by pk and write its edits and deletion mark again.
	  A new row that the server has becomes that saved row. Add a new row that
	  the server doesn't have again, unless it is marked for deletion. Drop a
	  saved row that the server doesn't have, unless it is outside the
	  requested param_vals.
	- collapse the recorded rows again, except the ancestors of modified rows.
	- put rows with pending parent_id or pos edits back in their places
	- sort, filter, group
	- run stages 3-5; O(n).

RELOAD
	- load rowset from rowset_name the first time; reload it on later reloads.
	- wait for the save request to finish before reloading.
	- reload on server notifications unless all update_ids are from our saves.
	- run the stages needed by load or reload rowset.

*/

;(function () {
"use strict"
const ui = window.ui

const {
	assign, assert, isfunc, isstr, isarray, isobj, words, obj, map, empty,
	warn, warn_if,
	num, floor, abs, min, max, clamp, strict_sign, month, year, month_of, year_of,
	memoize, ajax, href,
	return_true, return_false, captures, json, keys, url_parse, url_format, S,
	time, copy_to_clipboard,
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
const ROW_READONLY  = 2**7  // row's cells can't be edited
const ROW_NO_REMOVE = 2**8  // row can't be deleted
const ROW_NO_SAVE   = 2**9  // row is never saved
const ROW_GROUP     = 2**10 // row is a synthetic group row
const ROW_UNPLACED  = 2**11 // row stays where the user left it

// bit names accepted by set_row_flag()
let row_config_bits = {
	no_focus : ROW_NO_FOCUS,
	readonly : ROW_READONLY,
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
		list = grow_typed(list, max(len + k, list.length * 2))
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

//// RADIX SORT -------------------------------------------------------------

/*
Sort the first n entries of ris by sort_fields.
- sort_fields = [{field:, desc:, [vals:]}, ...].
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
	let ris1 = new Uint32Array(n) // ris for the next pass
	let keys  = [new Uint32Array(n), new Uint32Array(n)] // keys by ris
	let keys1 = [new Uint32Array(n), new Uint32Array(n)] // next keys
	counts ??= new Uint32Array(65536) // rows per digit value
	for (let sfi = sort_fields.length - 1; sfi >= 0; sfi--) {

		// build this field's sort keys. Use vals when supplied: for ranged
		// grouping, the nav passes each range's starting value in vals.
		let {field, desc, vals} = sort_fields[sfi]
		vals ??= col_vals[field.fi]
		let word_n = field.col_storage.write_sort_keys(
			vals, ris, n, field, keys[0], keys[1])

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

//// LOCAL ROWSETS -----------------------------------------------------------

ui.rowsets = {} // {rowset_name -> rowset}

//// SHARED NAVS -------------------------------------------------------------

// Ref-counted garbage-collected shared navs for lookup rowsets.
// Navs are kept in a LRU and freed based on number of rows cached (crude).

{
let max_unused_nav_count = 20
let max_unused_row_count =  1000000
let max_unused_val_count = 10000000

let shared_navs = {} // {name: nav}
let gclist = []
let oldest_last = function(nav1, nav2) {
	let t1 = nav1.last_used_time
	let t2 = nav2.last_used_time
	return t1 == t2 ? 0 : (t1 < t2 ? 1 : -1) // reverse order
}
let gc = function() {
	gclist.length = 0
	let nav_count = 0
	let row_count = 0
	let val_count = 0
	for (let name in shared_navs) {
		let nav = shared_navs[name]
		if (!nav.rc) {
			nav_count += 1
			row_count += nav.row_n
			val_count += nav.row_n * nav.all_fields.length
			gclist.push(nav)
		}
	}
	if (  nav_count > max_unused_nav_count
		|| row_count > max_unused_row_count
		|| val_count > max_unused_val_count
	) {
		gclist.sort(oldest_last)

		while (
			   nav_count > max_unused_nav_count
			|| row_count > max_unused_row_count
			|| val_count > max_unused_val_count
		) {
			let nav = gclist.pop()

			// count down before freeing: free() empties the nav's rows.
			nav_count -= 1
			row_count -= nav.row_n
			val_count -= nav.row_n * nav.all_fields.length

			delete shared_navs[nav.shared_name]
			nav.free()
		}
	}
}

ui.shared_nav = function(opt) {

	let name = opt.rowset_name

	let ln = shared_navs[name]
	if (!ln) {
		ln = ui.nav('shared_nav.'+name, opt)
		ln.shared_name = name // for gc() to drop the right key
		ln.rc = 0
		ln.ref = function() {
			if (!this.rc++) // jshint ignore:line
				gc()
		}
		ln.unref = function() {
			if (!--this.rc)
				this.last_used_time = time()
		}
		shared_navs[name] = ln
	}
	return ln
}

ui.shared_navs = shared_navs // for debugging

} // end shared nav scope

function lookup_display_field(field, ln = field.lookup_nav) {
	if (!ln) return
	return (field.display_col != null && ln.all_fields_map[field.display_col])
		|| ln.display_field
}

function lookup_nav(rowset_name) {
	return ui.shared_nav({
		rowset_name     : rowset_name,
		is_picker       : true,
		cell_select_mode : false,
		can_add_rows    : false,
		can_remove_rows : false,
		can_change_rows : false,
		can_move_rows   : false,
	})
}

// the lookup nav's field whose value this field stores. multi-col lookups
// have no single value to pick, so they have none.
function lookup_val_field(field, ln = field.lookup_nav) {
	let col = field.lookup_cols || ln.pk
	if (col == null || col.includes(' ')) return
	return ln.all_fields_map[col]
}

function can_pick_lookup_val(field, ln = field.lookup_nav) {
	return ln.ready
		&& lookup_val_field(field, ln)
		&& lookup_display_field(field, ln)
}

//// ROWSET NOTIFICATIONS ----------------------------------------------------

let rowset_listeners = {} // {rowset_name -> Set(fn(update_ids, filter))}

// share one connection among all navs. When the server changes a rowset's
// rows, it sends 'NAME[:FILTER] UPDATE_ID...'.
let listen_rowset_events = memoize(function() {
	let es = new EventSource('/rowset.events')
	es.onmessage = function(ev) {
		let update_ids = words(ev.data)
		let [rowset_name, filter] = update_ids.shift().split(':')
		for (let fn of rowset_listeners[rowset_name] ?? [])
			fn(update_ids, filter)
		ui.animate()
	}
})

//// NAV ---------------------------------------------------------------------

ui.nav = function(id, opt) {

	assert(id, 'nav id required')
	let e = assign({}, opt)
	e.id = id

	// get option value from saved state or from opt.
	function saved_opt(k) {
		let ss = ui.saved_state[e.id] // {cols:, group_by:, order_by:}
		return ss?.[k] !== undefined ? ss[k] : opt?.[k]
	}

	// permissions for calls from UI, with ev.input.
	e.can_add_rows    ??= true
	e.can_remove_rows ??= true
	e.can_change_rows ??= true
	e.can_move_rows   ??= true
	e.can_sort_rows   ??= true

	e.rowset_can_add_rows    = null
	e.rowset_can_remove_rows = null
	e.rowset_can_change_rows = null
	e.rowset_can_move_rows   = null

	// focus and selection modes
	e.cell_select_mode     ??= true // cell-select vs row-select mode
	e.can_select_multiple  ??= true // false: select the focused cell only
	e.can_select_non_siblings ??= true // false: can select siblings only

	// editing modes
	e.auto_advance_row     ??= false // wrap around on left/right keys
	e.stay_in_edit_mode    ??= true
	e.enter_edit_on_click  ??= false
	e.enter_edit_on_click_focused ??= false
	e.exit_edit_on_enter   ??= false
	e.exit_edit_on_escape  ??= true
	e.advance_on_enter     ??= 'next_row' // next_row | next_cell | null
	e.auto_jump_cells      ??= true // move between cells at text ends

	// fields (static)
	e.all_fields = null
	e.all_fields_map = null
	e.pk = null // 'col1 ...'
	e.pk_fields = null // [field1, ...]
	e.pos_field = null
	e.id_field = null
	e.parent_field = null
	e.tree_field = null
	e.display_field = null
	e.mask_word_n = null // how many 32-bit words per row for bitmasks
	let rowset_fields = null // fields loaded from the rowset
	let rowset_cols = null // visible cols when the cols option is not set
	let rowset_tree_col = null // tree col when tree_col is not set
	let group_field = null

	// fields (dynamic with column hiding and moving)
	e.visible_fields = null

	// rows (dynamic if grid is editable)
	e.row_n = null // data row count
	e.col_vals = null // column values by fi, then ri
	e.row_flags = null // ROW_* bits by ri
	e.parent_ri = null // parent, or NONE
	e.depth = null // indent level by ri
	e.desc_count = null // descendant count by ri
	e.tree_i = null // index in tree_ris by ri
	e.visible_i = null // index in visible_ris by ri
	e.base_ris = null // ris in stored order
	e.sorted_ris = null // ris in sort order
	e.tree_ris = null
	e.tree_n = null
	e.visible_ris = null // visible ris in display order
	e.visible_n = null // length of visible_ris
	let cap = null
	let slot_n = null // number of slots, including freed ones
	let free_ris = null // freed slots, used as a stack
	let first_child_ri = null // set by stage 3
	let next_sibling_ri = null // set by stage 3
	let tree_ris_buf = null // ris in tree order; unused in flat view
	let prev_visible_ris = null // visible_ris before stage 5

	// sorting, filtering, tree view and grouping
	e.order_by = null // sort columns, sort function, or null
	e.filter ??= null // filter function, or null
	e.param_vals ??= null // [{col: val, ...}, ...] | false | null
	e.is_filtered = false // row_filter is set: the nav filters rows itself
	let row_filter = null // fn(ri) combining all filters, or null
	e.can_be_tree = null
	e.is_tree = null
	e.flat ??= false // flat view of a tree nav
	e.group_by = null // group-by spec
	e.group_cols = null // group_by columns from parse_group_by(), in order
	e.is_grouped = null
	e.group_ris = null // group ris in key order
	let group_fis = null // field indices of the grouping columns
	let collapsed_group_paths = new Set() // group_path() of collapsed groups

	// indexes
	let indexes = null // {cols -> {fields:, ris:}}, built on first lookup

	// focus and selection
	e.focused_ri = null // focused row, or null
	e.focused_fi = null // focused column
	e.focus_changed = false // edge event: set by nav, reset by grid
	// last focused field, kept when no field is focused
	e.last_focused_fi = null
	e.sel_mask = null // selected cells' bits
	e.quicksearch_text = null // typed prefix of the focused cell's text
	let has_sel_bits = null // false: sel_mask is all zero
	let all_fields_mask = null // one bit per field
	let visible_fields_mask = null // one bit per visible field
	let sel_anchor_ri = null
	let sel_anchor_fi = null
	let sel_end_ri = null
	let sel_end_fi = null

	// editing state
	e.editing = false // the focused cell is being edited
	e.advance_on_exit = false // move to the next cell when the edit ends
	e.edit_sel_i = 0 // start of the initial text selection
	e.edit_sel_len = 1/0
	e.edit_open_popup = false // grid opens the dropdown when the edit starts
	e.modified_mask = null // edited cells
	e.unset_mask = null // server default
	e.modified_n = null // number of modified rows
	e.input_vals = null // edited values by fi, then ri
	e.cell_errors = null // cell errors by fi, then ri
	e.row_errors = null // row errors by ri

	// saving and loading
	// the rowset is not in ui.rowsets: load it from the server.
	let is_server_rowset = !!e.rowset_name && !ui.rowsets[e.rowset_name]
	e.ready = false // a rowset from ui.rowsets or the server is loaded
	let save_req = null // pending id or save request, or null
	let save_batch = null // pending batch: {rows: [...], ris: [...]}
	let saving_ris = new Set() // rows of the pending or lost batch
	let want_save = false // save requested during a pending request
	let want_reload = false // reload requested during a pending request
	let own_update_ids = new Set() // ids of this nav's saves
	let load_req = null // pending load request, or null

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
			all_fields_mask: all_fields_mask,
			visible_fields_mask: visible_fields_mask,
			sel_anchor_ri: sel_anchor_ri,
			sel_anchor_fi: sel_anchor_fi,
			sel_end_ri: sel_end_ri,
			sel_end_fi: sel_end_fi,
			prev_visible_ris: prev_visible_ris,
			rowset_fields: rowset_fields,
			rowset_cols: rowset_cols,
			rowset_tree_col: rowset_tree_col,
			group_field: group_field,
			is_saving: save_req != null,
			is_loading: load_req != null,
			saving_ris: saving_ris,
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

	function get_index(cols) {
		let index = indexes.get(cols)
		if (!index) {
			let fields = col_fields(cols)
			let sort_fields = fields.map(field => ({field: field, desc: false}))
			let ris = e.base_ris.slice(0, e.row_n)
			ris = radix_sort(e.col_vals, ris, e.row_n, sort_fields)
			index = {
				fields: fields, // [field1, ...]
				ris: ris, // ris, sorted by cols
			}
			indexes.set(cols, index)
		}
		return index
	}

	// compare ri's cells with vals using fields in order. return -1, 0 or 1.
	function compare_row(ri, fields, key_vals) {
		for (let i = 0; i < fields.length; i++) {
			let field = fields[i]
			let vals = e.col_vals[field.fi]
			let r = field.col_storage.compare_cell(vals, ri, key_vals[i])
			if (r)
				return r
		}
		return 0
	}

	// compare ri1 with ri2 using fields in order. Return -1, 0 or 1.
	function compare_rows(ri1, ri2, fields) {
		for (let field of fields) {
			let vals = e.col_vals[field.fi]
			let r = field.col_storage.compare_cell(vals, ri1,
				field.col_storage.get(vals, ri2))
			if (r)
				return r
		}
		return 0
	}

	// find the insertion index in ris after all rows with keys equal to ris.
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

	// add multiple ris to each index after existing rows with equal keys.
	// use binary search for each new row and copy the rows in one pass.
	function add_to_indexes(ris) {
		if (!ris.length)
			return
		for (let index of indexes.values()) {
			let fields = index.fields

			// sort the new rows by key, then merge them into the old rows in
			// one pass.
			let new_ris = Uint32Array.from(ris)
			new_ris.sort((ri1, ri2) => compare_rows(ri1, ri2, fields))
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

	// return a mask with one bit per field (32 fields per mask element).
	function fields_mask(fields) {
		let mask = new Uint32Array(e.mask_word_n)
		for (let field of fields)
			mask[field.fi >>> 5] |= 1 << (field.fi & 31)
		return mask
	}

	function clear_sel() {
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

	// return the rectangle's row positions in visible_ris.
	function rect_rows() { // -> [row_i1, row_i2], inclusive
		let row_i1 = e.visible_i[sel_anchor_ri]
		let row_i2 = e.visible_i[sel_end_ri]
		return [min(row_i1, row_i2), max(row_i1, row_i2)]
	}

	// return a column mask for the selection rectangle. in row-select mode,
	// include all fields. in cell-select mode, include only visible,
	// focusable fields between the anchor cell and the end cell.
	function rect_col_mask() {
		let col_mask
		if (!e.cell_select_mode) {
			col_mask = all_fields_mask
		} else {
			let col_i1 = e.all_fields[sel_anchor_fi].vfi
			let col_i2 = e.all_fields[sel_end_fi].vfi
			col_mask = new Uint32Array(e.mask_word_n)
			for (let col_i = min(col_i1, col_i2);
				col_i <= max(col_i1, col_i2); col_i++
			) {
				let field = e.visible_fields[col_i]
				if (is_rect_field(field))
					col_mask[field.fi >>> 5] |= 1 << (field.fi & 31)
			}
		}
		return col_mask
	}

	// exclude rows with no_focus from the selection rectangle. When
	// can_select_non_siblings is false, include only siblings of the anchor.
	function is_rect_row(ri) {
		return !(e.row_flags[ri] & ROW_NO_FOCUS)
			&& (e.can_select_non_siblings
				|| e.parent_ri[ri] == e.parent_ri[sel_anchor_ri])
	}

	function is_rect_field(field) {
		return field.focusable != false
	}

	// record the selected cells in sel_mask, then clear the rectangle.
	function commit_rect() {
		if (sel_anchor_ri == null)
			return
		let [row_i1, row_i2] = rect_rows()
		let col_mask = rect_col_mask()
		let word_n = e.mask_word_n
		let sel_mask = e.sel_mask
		for (let i = row_i1; i <= row_i2; i++) {
			let ri = e.visible_ris[i]
			if (!is_rect_row(ri))
				continue
			let word_i = ri * word_n // first word of the row
			for (let w = 0; w < word_n; w++)
				sel_mask[word_i + w] |= col_mask[w]
		}

		// Clear the rectangle after recording its selection.
		has_sel_bits = true
		set_rect(null, null, null, null)
	}

	// Clear the selection of hidden rows. Check the previous visible rows
	// because only those rows can be selected.
	function deselect_hidden_rows() {
		if (!has_sel_bits)
			return
		let prev_ris = e.visible_ris
		for (let i = 0; i < e.visible_n; i++) {
			let ri = prev_ris[i]
			if (e.visible_i[ri] == NONE)
				clear_row_mask(e.sel_mask, ri)
		}
	}

	// set focus and selection.
	// select:
	//   null     : reset to focused cell or row.
	//   'expand' : select from sel_anchor_ri/fi or focused_ri/fi to ri,fi.
	//   'invert' : toggle ri,fi only.
	//   'all'    : select all cells.
	//   'deselect_hidden': deselect hidden rows only.
	// 'expand' and 'invert' behave as null when can_select_multiple = false.
	function set_focus(ri, fi, select) {
		// a hidden row or field can't be focused.
		if (ri != null && e.visible_i[ri] == NONE)
			ri = null
		if (fi != null && e.all_fields[fi].vfi == null)
			fi = null

		// to select a cell, we need both ri and fi. To select a row, only ri.
		let has_target = ri != null && (fi != null || !e.cell_select_mode)
		if ((select == 'expand' || select == 'invert')
			&& (!e.can_select_multiple || !has_target))
			select = null

		// change the selection according to select.
		if (select == 'deselect_hidden') {
			deselect_hidden_rows()
		} else if (select == 'all') {
			clear_sel()
			let has_cells = e.visible_n > 0 && e.visible_fields.length > 0
			if (has_cells)
				set_rect(e.visible_ris[0], e.visible_fields[0].fi,
					e.visible_ris[e.visible_n - 1],
					e.visible_fields[e.visible_fields.length - 1].fi)
			else
				set_rect(null, null, null, null)
		} else if (select == 'expand') {
			let has_focused_target = e.focused_ri != null
				&& (e.focused_fi != null || !e.cell_select_mode)
			if (sel_anchor_ri != null)
				set_rect(sel_anchor_ri, sel_anchor_fi, ri, fi)
			else if (has_focused_target)
				set_rect(e.focused_ri, e.focused_fi, ri, fi)
			else
				set_rect(ri, fi, ri, fi)
		} else if (select == 'invert') {
			// toggle all fields of the row in row-select mode, else the cell.
			commit_rect()
			let word_n = e.mask_word_n
			if (!e.cell_select_mode) {
				let word_i = ri * word_n // first word of the row
				for (let w = 0; w < word_n; w++)
					e.sel_mask[word_i + w] ^= all_fields_mask[w]
			} else {
				let word_i = ri * word_n + (fi >>> 5) // word of the cell
				e.sel_mask[word_i] ^= 1 << (fi & 31)
			}
			has_sel_bits = true
		} else {
			clear_sel()
			if (has_target)
				set_rect(ri, fi, ri, fi)
			else
				set_rect(null, null, null, null)
		}

		// In row-select mode the user focuses rows, so no field is focused.
		if (!e.cell_select_mode)
			fi = null

		// End quicksearch when focusing another cell.
		let has_focus_changed = ri != e.focused_ri || fi != e.focused_fi
		if (has_focus_changed)
			e.quicksearch_text = ''
		e.focused_ri = ri
		e.focused_fi = fi
		if (fi != null)
			e.last_focused_fi = fi
		if (has_focus_changed)
			e.focus_changed = true
	}

	// Use the selection modes of set_focus(). End the edit before focusing
	// another cell or selecting 'all'.
	e.focus_cell = function(ri, fi, select) {
		if (ri != e.focused_ri || fi != e.focused_fi || select == 'all')
			e.exit_edit()
		set_focus(ri, fi, select)
	}

	// In row-select mode, every field of a selected row is selected.
	e.is_cell_selected = function(ri, fi) {
		if (cell_bit(e.sel_mask, ri, fi))
			return true

		// Check the selection rectangle if the cell has no bit in sel_mask. Use
		// its visible row and column positions. In row-select mode the
		// rectangle covers all fields.
		if (sel_anchor_ri == null || e.visible_i[ri] == NONE)
			return false
		let vi = e.visible_i
		let af = e.all_fields
		return between(vi[ri], vi[sel_anchor_ri], vi[sel_end_ri])
			&& is_rect_row(ri)
			&& (!e.cell_select_mode
				|| between(af[fi].vfi, af[sel_anchor_fi].vfi, af[sel_end_fi].vfi)
					&& is_rect_field(af[fi]))
	}

	// call fn(ri) for each row with a selected cell, in display order.
	// check only visible rows because hidden rows cannot be selected.
	e.each_selected_row = function(fn) {
		commit_rect()
		if (!has_sel_bits)
			return
		let word_n = e.mask_word_n
		let sel_mask = e.sel_mask
		for (let i = 0; i < e.visible_n; i++) {
			let ri = e.visible_ris[i]
			for (let w = 0; w < word_n; w++) {
				if (sel_mask[ri * word_n + w]) {
					fn(ri)
					break
				}
			}
		}
	}

	// -> index of the focused row in visible_ris, or null.
	e.focused_vri = function() {
		return e.focused_ri != null ? e.visible_i[e.focused_ri] : null
	}

	// -> index of the focused field in visible_fields, or null.
	e.focused_vfi = function() {
		return e.focused_fi != null ? e.all_fields[e.focused_fi].vfi : null
	}

	// -> the server value of the focused row's col, or null.
	e.focused_row_cell_val = function(col) {
		return e.focused_ri != null
			? col_val(e.focused_ri, e.all_fields_map[col].fi) : null
	}

	e.can_focus_cell = function(ri, fi) {
		return !(e.row_flags[ri] & ROW_NO_FOCUS)
			&& (!e.cell_select_mode || e.all_fields[fi].focusable != false)
	}

	// find a focusable cell at (rows, cols) relative distance from (ri, fi).
	// ri/fi = true: start at focused row/field.
	// ri/fi = null: start outside the nav to get to the first/last row/field.
	// if row can't move, field won't move.
	//   opt.editable          : skip cells the user can't edit.
	//   opt.must_move         : fail if neither the row nor the field moved.
	//   opt.must_not_move_row : fail if the row moved.
	//   opt.must_not_move_col : fail if the field moved.
	// -> [ri, fi], or [null, null] if no cell was found or a condition failed.
	e.first_focusable_cell = function(ri, fi, rows, cols, opt) {
		let editable = opt?.editable

		rows = rows ?? 0 // by default find the first focusable row.
		cols = cols ?? 0 // by default find the first focusable col.
		let vri_inc = strict_sign(rows)
		let vfi_inc = strict_sign(cols)
		rows = abs(rows)
		cols = abs(cols)

		let vri = ri === true ? e.focused_vri()
			: ri != null && e.visible_i[ri] != NONE ? e.visible_i[ri] : null
		let vfi = fi === true ? e.all_fields[e.last_focused_fi]?.vfi ?? null
			: fi != null ? e.all_fields[fi].vfi : null

		// When starting outside the rows or fields, count the first one found.
		if (vri == null && rows)
			rows--
		if (vfi == null && cols)
			cols--

		let move_row = rows >= 1
		let start_vri = vri
		let start_vfi = vfi

		// the default cell is the first or the last depending on direction.
		vri ??= vri_inc * -1/0
		vfi ??= vfi_inc * -1/0

		// clamp out-of-bound row/col indices.
		vri = clamp(vri, 0, e.visible_n - 1)
		vfi = clamp(vfi, 0, e.visible_fields.length - 1)

		// find the last valid row, stopping after the specified row count.
		let last_vri = null // last focusable row reached
		while (vri >= 0 && vri < e.visible_n) {
			let ri1 = e.visible_ris[vri]
			if (!(e.row_flags[ri1] & ROW_NO_FOCUS)
				&& (!editable || can_change_row(ri1))
			) {
				last_vri = vri
				if (rows <= 0)
					break
			}
			rows--
			vri += vri_inc
		}
		if (last_vri == null)
			return [null, null]
		let found_ri = e.visible_ris[last_vri]

		// Keep the field unchanged if the row could not move as requested.
		let row_moved = last_vri != start_vri
		if (move_row && !row_moved)
			cols = 0

		// In row-select mode, return null for the field.
		let last_vfi = null // last focusable field reached
		while (e.cell_select_mode && vfi >= 0
			&& vfi < e.visible_fields.length
		) {
			let fi1 = e.visible_fields[vfi].fi
			if (e.can_focus_cell(found_ri, fi1)
				&& (!editable || e.can_change_val(found_ri, fi1))
			) {
				last_vfi = vfi
				if (cols <= 0)
					break
			}
			cols--
			vfi += vfi_inc
		}

		let col_moved = last_vfi != start_vfi

		if (opt?.must_move && !(row_moved || col_moved))
			return [null, null]
		if ((opt?.must_not_move_row && row_moved)
			|| (opt?.must_not_move_col && col_moved))
			return [null, null]

		let found_fi = last_vfi != null ? e.visible_fields[last_vfi].fi : null
		return [found_ri, found_fi]
	}

	// move focus by the requested number of visible rows and fields.
	// Start editing with ev.enter_edit, or continue editing when
	// stay_in_edit_mode is set. Skip cells the user cannot edit in these
	// cases, unless ev.focus_non_editable_if_not_found is set.
	// -> false: no cell was found.
	e.move_focus = function(ri, fi, rows, cols, ev) {
		ev = ev || empty
		let was_editing = ev.was_editing || e.editing
		let enter_edit = !e.is_picker
			&& (ev.enter_edit || (was_editing && e.stay_in_edit_mode))
		let editable = (ev.editable || enter_edit)
			&& !ev.focus_non_editable_if_not_found

		let [ri1, fi1] = e.first_focusable_cell(ri, fi, rows, cols, {
			editable          : editable,
			must_move         : ev.must_move,
			must_not_move_row : ev.must_not_move_row,
			must_not_move_col : ev.must_not_move_col,
		})
		if (ri1 == null)
			return false

		e.focus_cell(ri1, fi1, ev.select)

		// Keep the dropdown closed when continuing an edit in another cell,
		// unless the caller requests it or the field requires it.
		if (enter_edit && fi1 != null)
			e.enter_edit({
				sel_i           : ev.sel_i,
				sel_len         : ev.sel_len,
				advance_on_exit : ev.advance_on_exit,
				open_popup      : ev.open_popup ?? false,
			})

		return true
	}

	e.focus_next_cell = function(cols, ev) {
		let dir = strict_sign(cols)
		let auto_advance_row = ev?.auto_advance_row || e.auto_advance_row
		return e.move_focus(true, true, dir * 0, cols,
				assign({must_move: true}, ev))
			|| (auto_advance_row
				&& e.move_focus(true, true, dir, dir * -1/0, ev))
	}

	e.is_last_row_focused = function() {
		let [ri] = e.first_focusable_cell(true, true, 1, 0, {must_move: true})
		return ri == null
	}

	// Select all cells without changing focus.
	e.select_all_cells = function() {
		e.focus_cell(e.focused_ri, e.focused_fi, 'all')
	}

	/// editing state ---------------------------------------------------------

	// Start editing the focused cell. Return false if the user can't edit it.
	// sel_i, sel_len: initial text selection, as in ui.select_text().
	// Select all text by default.
	// open_popup: false to leave the editor's dropdown closed, except for
	// fields with edits_in_popup.
	e.enter_edit = function(opt) {
		if (e.editing)
			return true
		let ri = e.focused_ri
		let fi = e.focused_fi
		if (ri == null || fi == null)
			return false
		if (e.is_picker || !e.can_change_val(ri, fi))
			return false
		e.editing = true
		e.advance_on_exit = opt?.advance_on_exit ?? false
		let sel_i   = opt?.sel_i
		let sel_len = opt?.sel_len
		if (sel_i == null) { // select all of it
			sel_i = 0
			sel_len = 1/0
		}
		e.edit_sel_i   = sel_i
		e.edit_sel_len = sel_len
		e.edit_open_popup = opt?.open_popup != false
			|| !!e.all_fields[fi].edits_in_popup
		return true
	}

	// End the edit. With ev.cancel, revert the edited cell.
	e.exit_edit = function(ev) {
		if (!e.editing)
			return
		e.editing = false
		e.advance_on_exit = false
		e.edit_open_popup = false
		if (ev?.cancel)
			e.revert_cell(e.focused_ri, e.focused_fi)
	}

	// cells that act on a click instead of opening an editor.
	e.cell_clickable = function(ri, fi) {
		return !e.is_picker && !!e.all_fields[fi].is_bool
			&& e.can_change_val(ri, fi)
	}

	e.do_cell_click = function(ri, fi, ev) {
		if (e.all_fields[fi].is_bool)
			e.set_cell_val(ri, fi, !e.cell_input_val(ri, fi), ev)
	}

	/// visible fields --------------------------------------------------------

	// Use e.cols, then the rowset's cols, then all non-hidden rowset fields.
	// Skip internal fields. When grouping, show $group first and hide the
	// grouping columns: we already show their values in the group label.
	// Unfocus hidden fields and reset selection to the focused cell or row.
	function update_visible_fields() {
		let fields = e.is_grouped ? [group_field] : []
		for (let field of e.all_fields)
			field.vfi = null
		for (let col of words(e.cols ?? rowset_cols)) {
			let field = e.all_fields_map[col]
			if (warn_if(!field, e.id, 'unknown column:', col))
				continue
			if (field.internal || field == group_field)
				continue
			if (e.is_grouped && group_fis.has(field.fi))
				continue
			fields.push(field)
		}
		for (let vfi = 0; vfi < fields.length; vfi++)
			fields[vfi].vfi = vfi
		e.visible_fields = fields // visible fields, in display order
		visible_fields_mask = fields_mask(fields)
		set_focus(e.focused_ri, e.focused_fi)
	}

	e.save_col_w = function(field) {
		ui.save_state(e.id+'.col_ws', field.name, field.w)
	}

	// move field before over_field, or to the end if over_field = null.
	// keeps grouping columns (which are hidden while grouped) in their places.
	// set e.cols to null if the result comes back as the default order.
	e.move_field = function(field, over_field, ev) {
		if (field == group_field || field == over_field)
			return
		e.exit_edit()
		let col_names = words(e.cols ?? rowset_cols)
		col_names.splice(col_names.indexOf(field.name), 1)
		let over_i = over_field == null ? col_names.length
			: over_field == group_field ? 0
			: col_names.indexOf(over_field.name)
		col_names.splice(over_i, 0, field.name)
		let cols = col_names.join(' ')
		e.cols = cols == rowset_cols ? null : cols
		update_visible_fields()
		if (ev?.input)
			ui.save_state(e.id, 'cols', e.cols)
	}

	/// row orders ------------------------------------------------------------

	// Set parent_ri from the parent_id column. Sort rows by parent_id and
	// compare them with the id index in order. Use no parent when no id
	// matches.
	function set_tree_parents() {
		let id_field = e.id_field
		let parent_field = e.parent_field
		let id_ris = get_index(id_field.name).ris // rows sorted by id
		let sort_fields = [{field: parent_field, desc: false}]
		let pid_ris = e.base_ris.slice(0, e.row_n)
		pid_ris = radix_sort(e.col_vals, pid_ris, e.row_n, sort_fields)
		let id_vals = e.col_vals[id_field.fi]
		let parent_vals = e.col_vals[parent_field.fi]
		let i = 0 // index into id_ris
		let id_cmp = id_field.col_storage.compare_cell
		for (let j = 0; j < e.row_n; j++) {
			let ri = pid_ris[j]
			let parent_id = parent_field.col_storage.get(parent_vals, ri)
			let parent_ri = NONE
			if (parent_id != null) {
				while (i < id_ris.length) {
					let cmp = id_cmp(id_vals, id_ris[i], parent_id)
					if (cmp >= 0) {
						if (cmp == 0)
							parent_ri = id_ris[i]
						break
					}
					i++
				}
			}
			e.parent_ri[ri] = parent_ri
		}
	}

	function update_is_tree() {
		e.is_tree = e.can_be_tree && !e.flat && !e.is_grouped // tree view
		let tree_col = e.tree_col ?? rowset_tree_col
		let tree_col_field = e.all_fields_map[tree_col]
		// the field that shows the indent and the collapse button
		e.tree_field = e.is_grouped ? group_field
			: !e.is_tree ? null
			: tree_col_field?.vfi != null ? tree_col_field
			: e.visible_fields[0] ?? null
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
	// other buffer. With reset_sel, select only the focused cell; moves and
	// server updates keep the selection. Clear focus if the focused row is
	// hidden. To
	// choose a nearby row, the UI must read visible_i before the operation.
	function update_visible_ris(reset_sel = true) {
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

		set_focus(e.focused_ri, e.focused_fi,
			reset_sel ? null : 'deselect_hidden')

		// show the new list; keep the old buffer for the next run.
		prev_visible_ris = e.visible_ris
		e.visible_ris = ris
		e.visible_n = n
	}

	function update_tree_and_visible_ris(reset_sel) { // stages 3-5
		update_tree_ris()
		update_pass_desc()
		update_visible_ris(reset_sel)
	}

	/// collapse/expand -------------------------------------------------------

	// mark parents of modified rows in tree_ris[i1 .. i2]. Visit children
	// before parents so that we also mark ancestors.
	function modified_desc_rows(i1, i2) { // -> Uint8Array by ri
		let has_modified_desc = new Uint8Array(cap)
		for (let i = i2; i >= i1; i--) {
			let ri = e.tree_ris[i]
			let p = e.parent_ri[ri]
			if (p != NONE && (has_modified_desc[ri] || is_row_modified(ri)))
				has_modified_desc[p] = 1
		}
		return has_modified_desc
	}

	// ri = null: change all roots; recursive: change descendants too.
	// ancestors of modified rows stay expanded so that edits are not hidden.
	e.set_collapsed = function(ri, collapsed, recursive) {
		if (!(e.is_tree || e.is_grouped))
			return
		e.exit_edit()
		// the rows affected, in tree_ris: [i1 .. i2]
		let i1 = ri == null ? 0 : e.tree_i[ri]
		let i2 = ri == null ? e.tree_n - 1 : i1 + e.desc_count[ri]
		let has_modified_desc = collapsed && e.modified_n
			? modified_desc_rows(i1, i2) : null
		let last_i = ri != null && !recursive ? i1 : i2 // last row to change
		let row_flags = e.row_flags
		for (let i = i1; i <= last_i; i++) {
			let ri1 = e.tree_ris[i]
			if ((ri != null || recursive || e.depth[ri1] == 0)
				&& !has_modified_desc?.[ri1]) {
				set_bits(row_flags, ri1, ROW_COLLAPSED, collapsed)
				// group rows are rebuilt: keep their state by label path.
				if (row_flags[ri1] & ROW_GROUP)
					if (collapsed)
						collapsed_group_paths.add(group_path(ri1))
					else
						collapsed_group_paths.delete(group_path(ri1))
			}
		}
		update_visible_ris(true)
	}

	// show a tree nav's rows as a flat list.
	e.set_flat = function(flat) {
		e.exit_edit()
		e.flat = flat // flat view of a tree nav
		update_is_tree()
		update_tree_and_visible_ris()
	}

	/// sorting ---------------------------------------------------------------

	// parse order_by, 'col1[:desc] ...', into map(field -> desc), in order.
	// ignore unknown columns and columns that cannot be sorted.
	function parse_order_by(order_by) {
		let sort_fields = map()
		for (let s of words(order_by)) {
			let [col, dir] = s.split(':')
			assert(dir == null || dir == 'asc' || dir == 'desc',
				'invalid sort direction: ', dir)
			let field = e.all_fields_map[col]
			if (field?.sortable)
				sort_fields.set(field, dir == 'desc')
		}
		return sort_fields
	}

	// move modified rows first, in base_ris order, then keep the remaining rows
	// in sort order. return a new array, or sorted_ris if no row is modified.
	function move_modified_rows_first(sorted_ris) {
		if (!e.modified_n)
			return sorted_ris
		let n = e.row_n
		let ris = new Uint32Array(n) // result
		let j = 0 // next index into ris

		// copy modified rows in stored order.
		for (let i = 0; i < n; i++)
			if (is_row_modified(e.base_ris[i]))
				ris[j++] = e.base_ris[i]

		// copy the remaining rows in sort order.
		for (let i = 0; i < n; i++)
			if (!is_row_modified(sorted_ris[i]))
				ris[j++] = sorted_ris[i]
		return ris
	}

	// Stage 2. order_by = 'col1[:desc] ...' | cmp(ri1, ri2) | null.
	// put modified rows first, in base_ris order.
	function sort_ris(order_by) {
		let sort_fields = isstr(order_by) ? parse_order_by(order_by) : null

		// mark each field with its place in order_by for the grid to draw.
		for (let field of e.all_fields) {
			field.sort_i = null
			field.sort_desc = null
		}
		let i = 0 // field's place in order_by
		if (sort_fields)
			for (let [field, desc] of sort_fields) {
				field.sort_i = i++
				field.sort_desc = desc
			}

		if (isfunc(order_by) || sort_fields?.size) {
			e.order_by = order_by
			e.sorted_ris = move_modified_rows_first(
				sorted_copy(e.base_ris, e.row_n, order_by))
		} else {
			e.order_by = null
			e.sorted_ris = e.base_ris
		}
		reset_unplaced()
	}

	// -> the first n entries of ris sorted by order_by, in a new array.
	function sorted_copy(ris, n, order_by) {
		let sorted_ris = ris.slice(0, n)
		if (isfunc(order_by))
			return sorted_ris.sort(order_by)
		let sort_fields = [...parse_order_by(order_by)]
			.map(([field, desc]) => ({field, desc}))
		return radix_sort(e.col_vals, sorted_ris, n, sort_fields)
	}

	// A full sort or filter by the user puts every row in place except the
	// modified rows.
	function reset_unplaced() {
		let row_flags = e.row_flags
		let has_modifications = e.modified_n > 0
		for (let i = 0; i < e.row_n; i++) {
			let ri = e.base_ris[i]
			set_bits(row_flags, ri, ROW_UNPLACED,
				has_modifications && is_row_modified(ri))
		}
	}

	e.set_order_by = function(order_by) {
		e.exit_edit()
		sort_ris(order_by)
		update_tree_and_visible_ris()
	}

	// dir: 'asc' | 'desc' | 'toggle' | false. A field already in order_by
	// keeps its priority.
	e.set_order_by_dir = function(field, dir, keep_others, ev) {
		if (ev?.input && !e.can_sort_rows)
			return
		if (!field.sortable)
			return
		if (dir == 'toggle')
			dir = field.sort_i == null ? 'asc' : field.sort_desc ? false : 'desc'
		let sort_fields = keep_others && isstr(e.order_by)
			? parse_order_by(e.order_by) : map()
		if (dir)
			sort_fields.set(field, dir == 'desc')
		else
			sort_fields.delete(field)
		let order_by = [...sort_fields]
			.map(([field, desc]) => field.name + (desc ? ':desc' : ''))
			.join(' ')
		e.set_order_by(order_by || null)
		if (ev?.input)
			ui.save_state(e.id, 'order_by', e.order_by)
	}

	/// filtering -------------------------------------------------------------

	// expr: [bin_oper, expr1, ...] | [un_oper, expr] | [bin_oper, col, val]
	e.expr_filter = function(expr) {
		let expr_bin_ops = {'&&': 1, '||': 1}
		let expr_un_ops = {'!': 1}
		let s = []
		function push_expr(expr) {
			let op = expr[0]
			if (op in expr_bin_ops) {
				assert(expr.length > 1)
				s.push('(')
				for (let i = 1; i < expr.length; i++) {
					if (i > 1)
						s.push(' '+op+' ')
					push_expr(expr[i])
				}
				s.push(')')
			} else if (op in expr_un_ops) {
				s.push('('+op+'(')
				push_expr(expr[1])
				s.push('))')
			} else {
				s.push('col_val(ri, '+e.all_fields_map[expr[1]].fi+') '
					+expr[0]+' '+json(expr[2]))
			}
		}
		push_expr(expr)
		if (!s.length)
			return return_true
		s = 'let f = function(ri) {\n\treturn ' + s.join('') + '\n}; f'
		return eval(s)
	}

	e.filter_rows = function(ris, expr) {
		let f = e.expr_filter(expr)
		return ris.filter(ri => f(ri))
	}

	function has_number_filter(field) {
		return !field.lookup_rowset_name
			&& !!(field.is_number || field.is_time || field.is_timeofday)
	}

	function val_filter_simple(field, expr) {

		let fi = field.fi

		let f = field.parse_filter?.(expr)
		if (f)
			return ri => f(col_val(ri, fi))

		if (has_number_filter(field)) {

			let parse = v => field.validator.parse(v)

			// range: n1..n2
			{
				let [v1, v2] = captures(expr, /^(.*?)\.\.(.*?)$/)
				if (v1 != null) {
					v1 = parse(v1)
					v2 = parse(v2)
					if (v1 == null || v2 == null)
						return
					return ri => col_val(ri, fi) >= v1 && col_val(ri, fi) <= v2
				}
			}

			// inequality: >= n, <= n, > n, < n
			{
				let [op, n] = captures(expr, /^(>=|<=|>|<)(.*)/)
				if (op != null) {
					n = parse(n)
					if (n == null)
						return
					if (op == '>=')
						return ri => col_val(ri, fi) >= n
					else if (op == '<=')
						return ri => col_val(ri, fi) <= n
					else if (op == '>')
						return ri => col_val(ri, fi) > n
					else if (op == '<')
						return ri => col_val(ri, fi) < n
					else
						return
				}
			}

			// exact match: n
			{
				let n = parse(expr)
				if (n == null)
					return
				return ri => col_val(ri, fi) === n
			}

		}

		let shown_text = ri =>
			(val_text(field, col_val(ri, fi)) ?? '').toLowerCase()
		expr = expr.toLowerCase()

		// exact match: =s
		if (expr.startsWith('=')) {
			let s = expr.slice(1)
			return ri => shown_text(ri) == s
		}

		// starts with: ^s
		if (expr.startsWith('^')) {
			let s = expr.slice(1)
			return ri => shown_text(ri).startsWith(s)
		}

		// ends with: s$
		if (expr.endsWith('$')) {
			let s = expr.slice(0, -1)
			return ri => shown_text(ri).endsWith(s)
		}

		// includes: [~]s
		if (expr.startsWith('~')) // prefix to avoid having to escape ^, $ etc.
			expr = expr.slice(1)
		return ri => shown_text(ri).includes(expr)

	}

	function val_filter(field, expr) {

		// negation: !expr
		if (expr.startsWith('!')) {
			expr = expr.slice(1)
			let filter = val_filter_simple(field, expr)
			return filter && (ri => !filter(ri))
		}

		return val_filter_simple(field, expr)

	}

	function create_filter_field(field) {
		let filter_field = ui.create_field({
			align: field.align,
			label: field.label,
			is_number_filter: has_number_filter(field),
		})
		filter_field.validator = ui.create_validator(filter_field, [{
			name     : 'filter',
			applies  : return_true,
			validate : (filter_field, s) => !!val_filter(field, s),
			error    : (filter_field, s) => S('validation_filter_error',
				'{0}: invalid filter', filter_field.label),
			rule     : (filter_field) => S('validation_filter_rule',
				'{0} must be a valid filter', filter_field.label),
		}], true)
		return filter_field
	}

	// match rows with any of the param_vals records.
	function param_vals_expr() {
		let expr = ['&&']
		if (e.param_vals.length == 1) {
			for (let k in e.param_vals[0])
				expr.push(['===', k, e.param_vals[0][k]])
		} else {
			let or_expr = ['||']
			for (let vals of e.param_vals) {
				let and_expr = ['&&']
				for (let k in vals)
					and_expr.push(['===', k, vals[k]])
				or_expr.push(and_expr.length > 1 ? and_expr : and_expr[1])
			}
			expr.push(or_expr)
		}
		return expr
	}

	// compress param_vals into a value array for single-key pks.
	function param_vals_filter() {
		if (!e.param_vals)
			return
		let cols = keys(e.param_vals[0])
		if (cols.length == 1) {
			let col = cols[0]
			return json(e.param_vals.map(vals => vals[col]))
		} else {
			return json(e.param_vals)
		}
	}

	// Combine the app filter, param_vals, column filters and excluded values
	// into row_filter. A server rowset filters by param_vals on the server.
	function update_row_filter() {
		let tests = [] // [fn(ri) -> passes, ...]
		if (e.filter)
			tests.push(e.filter)
		if (e.param_vals === false)
			tests.push(return_false)
		else if (e.param_vals && !is_server_rowset)
			tests.push(e.expr_filter(param_vals_expr()))
		for (let field of e.all_fields) {
			if (field.filter)
				tests.push(val_filter(field, field.filter) ?? return_false)
			if (field.exclude_vals)
				tests.push(ri => !field.exclude_vals.has(col_val(ri, field.fi)))
		}
		e.is_filtered = tests.length > 0
		let n = tests.length
		row_filter = n == 0 ? null : n == 1 ? tests[0] : function(ri) {
			for (let i = 0; i < n; i++)
				if (!tests[i](ri))
					return false
			return true
		}
	}

	// Set is_pass on data rows from row_filter. Keep modified rows, unplaced
	// rows and the edited row passing.
	function update_pass() {
		let row_flags = e.row_flags
		let ris = e.base_ris
		let has_modifications = e.modified_n > 0
		for (let i = 0; i < e.row_n; i++) {
			let ri = ris[i]
			set_bits(row_flags, ri, ROW_PASS, !row_filter
				|| (has_modifications && is_row_modified(ri))
				|| row_flags[ri] & ROW_UNPLACED
				|| (e.editing && ri == e.focused_ri)
				|| row_filter(ri))
		}
	}

	function refilter() {
		update_row_filter()
		reset_unplaced()
		update_pass()
		update_pass_desc()
		update_visible_ris(true)
	}

	// filter by fn(ri) -> is_visible; always include modified rows until saved
	// set_filter(null) clears the filter.
	e.set_filter = function(fn) {
		e.exit_edit()
		e.filter = fn // filter function, or null
		refilter()
	}

	// s: filter text, or null to clear the column filter.
	e.set_col_filter = function(fi, s) {
		e.exit_edit()
		let field = e.all_fields[fi]
		field.filter = s
		ui.save_state(e.id+'.col_filters', field.name, s)
		refilter()
	}

	function same_param_vals(param_vals1, param_vals2) {
		if (!isarray(param_vals1) || !isarray(param_vals2))
			return param_vals1 === param_vals2
		if (param_vals1.length != param_vals2.length)
			return false
		for (let i = 0; i < param_vals1.length; i++) {
			let vals1 = param_vals1[i]
			let vals2 = param_vals2[i]
			let n = 0 // keys in vals1
			for (let k in vals1) {
				if (vals1[k] !== vals2[k])
					return false
				n++
			}
			for (let k in vals2)
				n--
			if (n)
				return false
		}
		return true
	}

	// Show the rows matching any of param_vals: [{col: val, ...}, ...]. Pass
	// false to show no rows and null to show all rows. A server rowset loads
	// only the matching rows.
	e.set_param_vals = function(param_vals) {
		if (same_param_vals(param_vals, e.param_vals))
			return
		e.exit_edit()
		e.param_vals = param_vals
		if (param_vals && is_server_rowset) {
			update_row_filter()
			e.reload()
		} else {
			refilter()
			e.move_focus(null, null)
		}
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
				&& e.cell_text(ri, fi).toLowerCase().startsWith(s_lower)
			) {
				e.focus_cell(ri, fi)
				e.quicksearch_text = s
				return ri
			}
		}
		return null
	}

	/// grouping --------------------------------------------------------------

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
						let month_count =
							(year_of(v) - 1970) * 12 + month_of(v) - 1
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

	// Parse group_by as 'col1 col2 > col3 ...', with '>' between levels and
	// spaces between columns in a level. For ranged columns, accept
	// 'col[/offset][/unit]/freq' and group values by range. Return
	// [[{field:, bucket_func:, col_expr:, group_level:, group_i:}, ...], ...],
	// one array per level. Ignore unknown columns, columns that cannot be
	// grouped, and empty levels.
	function parse_group_by(group_by) {
		let levels = []
		let group_col_n = 0 // columns in all levels so far
		for (let level_expr of group_by.split(/\s*>\s*/)) {
			let level = []
			for (let col of words(level_expr)) {
				let col_expr = col // 'col[/offset][/unit]/freq'
				let range = {} // {freq:, unit:, offset:}

				// Read and remove the range arguments from the end: freq, then
				// unit, then offset.
				col = col.replace(/\/[^\/]+$/,
					k => { range.freq = num(k.substring(1)); return '' })
				col = col.replace(/\/(month|year)$/,
					k => { range.unit = k.substring(1); return '' })
				col = col.replace(/\/[^\/]+$/,
					k => { range.offset = num(k.substring(1)); return '' })
				let field = e.all_fields_map[col]
				if (field?.groupable)
					level.push({
						field: field,
						bucket_func: range_bucket_func(range),
						col_expr: col_expr,
						group_level: levels.length,
						group_i: group_col_n++, // index in e.group_cols
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
		let key_fields = [] // [{field:, vals:, desc:}, ...]: all levels' keys
		let level_ends = [] // end index into key_fields, by level
		for (let level of levels) {
			for (let {field, bucket_func} of level) {
				// Keep vals to read existing data rows, even if alloc_slot()
				// replaces the column arrays. Write new group cells to
				// e.col_vals.
				let vals = e.col_vals[field.fi]
				if (bucket_func) {
					let bucket_vals = new Float64Array(cap) // range start by ri
					for (let i = 0; i < n; i++) {
						let ri = base_ris[i]
						let v = field.col_storage.get(vals, ri)
						bucket_vals[ri] = v == null ? NaN : bucket_func(v)
					}
					vals = bucket_vals
				}
				key_fields.push({field: field, vals: vals, desc: false})
			}
			level_ends.push(key_fields.length)
		}

		let level_n = levels.length
		// Return the first grouping level with different keys for ri1 and ri2.
		function first_diff_level(ri1, ri2) {
			let k = 0 // index into key_fields
			for (let level = 0; level < level_n; level++)
				for (; k < level_ends[level]; k++) {
					let {field, vals} = key_fields[k]
					let storage = field.col_storage
					let v2 = storage.get(vals, ri2)
					if (storage.compare_cell(vals, ri1, v2))
						return level
				}
			return level_n
		}

		// Sort and visit the data rows. Find the first level differing from the
		// previous row, then create new groups at that level and below it.
		let ris = base_ris.slice(0, n)
		ris = radix_sort(e.col_vals, ris, n, key_fields)
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
					let {field, vals} = key_fields[k]
					let storage = field.col_storage
					storage.set(e.col_vals[field.fi], group_ri,
						storage.get(vals, ri))
				}

				// write this level's key values, joined with ' / ', into $group.
				let label = ''
				// index in key_fields of this level's first key
				let k1 = level ? level_ends[level - 1] : 0
				for (let k = k1; k < level_ends[level]; k++) {
					let {field, vals} = key_fields[k]
					let s = val_text(field, field.col_storage.get(vals, ri))
					label = k > k1 ? label + ' / ' + s : s
				}
				group_field.col_storage.set(
					e.col_vals[group_field.fi], group_ri, label)
				open_ris[level] = group_ri
				group_ris.push(group_ri)
			}

			// put the data row under the innermost open group.
			e.parent_ri[ri] = open_ris[level_n - 1]
		}
		e.group_ris = Uint32Array.from(group_ris)
		group_fis = new Set(key_fields.map(kf => kf.field.fi))
		e.is_grouped = true
		for (let ri of e.group_ris)
			if (collapsed_group_paths.has(group_path(ri)))
				e.row_flags[ri] |= ROW_COLLAPSED
	}

	// -> the labels of a group and of its parent groups, top level first.
	function group_path(ri) {
		let label_vals = e.col_vals[group_field.fi]
		let path = ''
		for (let p = ri; p != NONE; p = e.parent_ri[p])
			path = group_field.col_storage.get(label_vals, p) + '\0' + path
		return path
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
		let n = compact_list(e.group_ris, e.group_ris.length, is_dropped)
		e.group_ris = e.group_ris.subarray(0, n)
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
					if (cell_bit(e.modified_mask, e.base_ris[i], fi))
						return true
			}
		return false
	}

	// Use the syntax accepted by parse_group_by(), or pass null to ungroup.
	// Refuse grouping with pending changes in a tree nav.
	// Refuse edited grouping columns in a flat nav because the nav groups by
	// stored values. Return true if applied.
	e.set_group_by = function(group_by) {
		let levels = group_by ? parse_group_by(group_by) : []
		if (levels.length && (e.can_be_tree && e.modified_n
			|| has_edited_keys(levels)))
			return false
		e.exit_edit()

		// Remove current groups. Before regrouping, unfocus and deselect old
		// group rows so that add_groups() can reuse their slots. When
		// ungrouping, restore tree parents or clear the parents for a flat nav.
		if (e.is_grouped) {
			remove_groups()
			if (levels.length) {
				set_focus(e.focused_ri, e.focused_fi, 'deselect_hidden')
			} else if (e.can_be_tree) {
				set_tree_parents()
			} else {
				for (let i = 0; i < e.row_n; i++)
					e.parent_ri[e.base_ris[i]] = NONE
			}
		}

		// add the new groups, if any, and update the rows shown.
		collapsed_group_paths.clear()
		e.group_by = levels.length ? group_by : null // group-by spec, or null
		e.group_cols = levels.flat()
		if (levels.length)
			add_groups(levels)
		update_visible_fields()
		update_is_tree()
		update_tree_and_visible_ris()
		return true
	}

	// group_cols: [{col_expr:, group_level:}, ...] in order. Start a new level
	// wherever group_level changes. Return what set_group_by() returns.
	e.set_group_cols = function(group_cols, ev) {
		let level_exprs = [] // 'col1 col2 ...' per level
		let last_level
		for (let {col_expr, group_level} of group_cols) {
			if (level_exprs.length && group_level == last_level)
				level_exprs[level_exprs.length - 1] += ' ' + col_expr
			else
				level_exprs.push(col_expr)
			last_level = group_level
		}
		if (!e.set_group_by(level_exprs.join(' > ') || null))
			return false
		if (ev?.input)
			ui.save_state(e.id, 'group_by', e.group_by)
		return true
	}

	// remove field from group_by and show it before over_field (or where it was).
	e.ungroup_col = function(field, over_field, ev) {
		if (e.set_group_cols(e.group_cols.filter(gcol => gcol.field != field),
				ev))
			if (over_field)
				e.move_field(field, over_field, ev)
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

	// -> cell's unedited value, or undefined for an unset cell.
	function unedited_val(ri, fi) {
		return cell_bit(e.unset_mask, ri, fi) ? undefined : col_val(ri, fi)
	}

	// check whether the row is new, marked for deletion, or edited.
	function is_row_modified(ri) {
		let flags = e.row_flags[ri]
		if (flags & (ROW_NEW | ROW_REMOVED))
			return true
		let word_n = e.mask_word_n
		for (let w = ri * word_n, w2 = w + word_n; w < w2; w++)
			if (e.modified_mask[w])
				return true
		return false
	}

	// adjust modified_n if the row became modified or became clean.
	function update_modified_n(ri, was_modified) {
		let is_modified = is_row_modified(ri)
		if (is_modified != was_modified)
			e.modified_n += is_modified ? 1 : -1
	}

	// -> edited value, or the value last seen on the server when the
	// cell has no edit, or undefined for a new row's unset cell.
	e.cell_input_val = function(ri, fi) {
		return cell_bit(e.modified_mask, ri, fi)
			? e.input_vals[fi][ri] : unedited_val(ri, fi)
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
				let v = e.cell_input_val(ri, fi)
				let errors = validate_cell(field, v)
				set_cell_errors(ri, fi, errors)
			}
		update_invalid(ri)
		return !(e.row_flags[ri] & ROW_INVALID)
	}

	// set cell's edited value; clear the edit if v equals server value (revert).
	function set_input_val(ri, fi, v) {
		let was_modified = is_row_modified(ri)
		// for an unset cell, clear the edit only for undefined.
		// treat null as an input value.
		if (cell_bit(e.unset_mask, ri, fi) ? v === undefined
			: v === col_val(ri, fi)
		) {
			set_cell_bit(e.modified_mask, ri, fi, false)
			if (e.input_vals[fi])
				e.input_vals[fi][ri] = undefined
		} else {
			set_cell_bit(e.modified_mask, ri, fi, true)
			e.input_vals[fi] ??= [] // made on the column's first edit
			e.input_vals[fi][ri] = v
			e.row_flags[ri] |= ROW_UNPLACED
		}
		update_modified_n(ri, was_modified)
		end_quicksearch_at(ri, fi)
	}

	function is_cell_editable(ri, fi) {
		if (e.row_flags[ri] & ROW_GROUP) // group row cell
			return false
		if (fi == group_field.fi)
			return false
		if (fi == e.pos_field?.fi)
			return false
		if (e.all_fields[fi].immutable && !(e.row_flags[ri] & ROW_NEW))
			return false
		if (e.can_be_tree && (fi == e.id_field.fi || fi == e.parent_field.fi))
			return false
		if (e.is_grouped && group_fis.has(fi)) // grouped-by col while grouped
			return false
		return true
	}

	// store the parsed value when parsing succeeds, or keep the typed text
	// when it fails. Clear the edit if the value equals the server value. With
	function set_cell_val_only(ri, fi, v, ev) {
		if (!(ev?.input ? e.can_change_val(ri, fi) : is_cell_editable(ri, fi)))
			return false

		// validate and parse v. Stop if it equals the current value.
		let field = e.all_fields[fi]
		let errors = validate_cell(field, v)
		if (!field.validator.parse_failed)
			v = field.validator.value
		if (v === e.cell_input_val(ri, fi))
			return false

		// Store the edit and its cell errors. Clear the row errors because they
		// were reported for the previous values.
		set_input_val(ri, fi, v)
		set_cell_errors(ri, fi, errors)
		e.row_errors[ri] = undefined

		// Keep the edited row visible until the next filter.
		set_bits(e.row_flags, ri, ROW_PASS, true)
		return true
	}

	e.set_cell_val = function(ri, fi, v, ev) {
		if (set_cell_val_only(ri, fi, v, ev))
			e.validate_row(ri)
	}

	// Return true for a pos or parent_id cell. The caller must then restore
	// the row's position or parent from the reverted value.
	function revert_cell_val(ri, fi) {
		set_input_val(ri, fi, unedited_val(ri, fi))
		set_cell_errors(ri, fi, null)
		return fi == e.pos_field?.fi || fi == e.parent_field?.fi
	}

	// -> true if a pos or parent_id edit was reverted.
	function revert_row_vals(ri) {
		e.row_errors[ri] = undefined
		let is_moved = false
		for (let fi = 0; fi < e.all_fields.length; fi++)
			if (cell_bit(e.modified_mask, ri, fi) && revert_cell_val(ri, fi))
				is_moved = true
		update_invalid(ri)
		return is_moved
	}

	e.revert_cell = function(ri, fi) {
		if (!cell_bit(e.modified_mask, ri, fi))
			return
		e.exit_edit()
		let is_moved = revert_cell_val(ri, fi)
		update_invalid(ri)
		if (is_moved) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// drop a new row, or restore the server values of a saved row.
	// a new row in the pending or lost batch is marked for deletion, not dropped.
	e.revert_row = function(ri) {
		e.exit_edit()
		if (e.row_flags[ri] & ROW_NEW) {
			let new_ris = [] // the row, if it can be dropped
			mark_removed(ri, new_ris, false)
			if (new_ris.length) {
				drop_rows(new_ris)
				update_tree_and_visible_ris()
			}
		} else if (revert_row_vals(ri)) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// drop new rows, unmark rows marked for deletion, and revert edited cells.
	// new rows in the pending or lost batch are marked for deletion, not dropped.
	e.revert_changes = function() {
		e.exit_edit()
		let new_ris = [] // new rows, dropped in one pass at the end
		let moved_ris = [] // rows whose pos or parent_id was reverted

		// unmark and revert saved rows. collect new rows to drop afterward.
		for (let i = 0; i < e.row_n; i++) {
			let ri = e.base_ris[i]
			if (!is_row_modified(ri))
				continue
			if (e.row_flags[ri] & ROW_NEW) {
				mark_removed(ri, new_ris, false)
			} else {
				e.remove_rows([ri], 'undelete')
				if (revert_row_vals(ri))
					moved_ris.push(ri)
			}
		}

		// restore the positions and parents of reverted rows, then drop new rows.
		if (moved_ris.length)
			update_row_places(moved_ris)
		if (new_ris.length)
			drop_rows(new_ris)
		if (new_ris.length || moved_ris.length)
			update_tree_and_visible_ris()

		// marked rows of the pending or lost batch keep their edits.
		if (!e.modified_n) {
			e.input_vals = [] // edited values by fi, then ri
			e.cell_errors = [] // cell errors by fi, then ri
		}
	}

	// Set selected cells to null, with the same edit restrictions as
	// set_cell_val(). Set only visible fields, even in row-select mode.
	// Validate each modified row once, after setting its cells.
	e.set_null_selected_cells = function(ev) {
		e.exit_edit()
		let word_n = e.mask_word_n
		let sel_mask = e.sel_mask
		e.each_selected_row(ri => {
			let is_modified = false
			for (let w = 0; w < word_n; w++) {
				// selection bits for visible fields in this word
				let bits = sel_mask[ri * word_n + w] & visible_fields_mask[w]
				// Find the column for the lowest set bit, then clear that bit.
				while (bits) {
					let fi = w * 32 + 31 - Math.clz32(bits & -bits)
					if (set_cell_val_only(ri, fi, null, ev))
						is_modified = true
					bits &= bits - 1
				}
			}
			if (is_modified)
				e.validate_row(ri)
		})
	}

	/// editing policy --------------------------------------------------------

	// the user may edit some cells of the row.
	function can_change_row(ri) {
		let flags = e.row_flags[ri]
		if (flags & (ROW_READONLY | ROW_REMOVED | ROW_GROUP))
			return false
		// Check can_change_rows only for saved rows.
		return !!(flags & ROW_NEW)
			|| e.can_change_rows && e.rowset_can_change_rows
	}

	// the user may edit the cell.
	e.can_change_val = function(ri, fi) {
		return !e.all_fields[fi].readonly && can_change_row(ri)
			&& is_cell_editable(ri, fi)
	}

	/// row state -------------------------------------------------------------

	// name: 'no_focus' | 'readonly' | 'no_remove' | 'no_save'
	e.set_row_flag = function(ri, name, on) {
		let bit = assert(row_config_bits[name], 'unknown row flag: ', name)
		set_bits(e.row_flags, ri, bit, on)
	}

	e.is_new       = function(ri) { return !!(e.row_flags[ri] & ROW_NEW      ) }
	e.is_removed   = function(ri) { return !!(e.row_flags[ri] & ROW_REMOVED  ) }
	e.is_group_row = function(ri) { return !!(e.row_flags[ri] & ROW_GROUP    ) }
	e.is_collapsed = function(ri) { return !!(e.row_flags[ri] & ROW_COLLAPSED) }
	e.has_children = function(ri) { return e.desc_count[ri] > 0 }

	// -> true if the row has an edited cell.
	// -> true if one of the cells has errors, if with_errors = true.
	e.is_row_edited = function(ri, with_errors) {
		let word_n = e.mask_word_n
		for (let w = ri * word_n, w2 = w + word_n; w < w2; w++)
			if (e.modified_mask[w])
				return true
		if (with_errors)
			for (let fi = 0; fi < e.all_fields.length; fi++)
				if (e.cell_errors[fi]?.[ri])
					return true
		return false
	}

	/// cell state ------------------------------------------------------------

	e.is_cell_modified = function(ri, fi) {
		return !!cell_bit(e.modified_mask, ri, fi)
	}

	e.cell_has_errors = function(ri, fi) {
		return !!e.cell_errors[fi]?.[ri]
	}

	function val_text(field, v) {
		if (v == null)
			return field.null_text
		if (v === '')
			return field.empty_text
		return field.to_text(v)
	}

	e.cell_text = function(ri, fi) {
		return val_text(e.all_fields[fi], e.cell_input_val(ri, fi))
	}

	/// cell lookup display val -----------------------------------------------

	function init_field_lookup_nav(field) {
		if (field.lookup_rowset_name) {
			field.lookup_nav = lookup_nav(field.lookup_rowset_name)
			field.lookup_nav.ref()
		}
	}

	function free_field_lookup_nav(field) {
		if (!field.lookup_nav)
			return
		field.lookup_nav.unref()
		field.lookup_nav = null
	}

	function build_null_lookup_val(ri, field, opt) {
		if (ri == null || !field.null_lookup_col) return
		let nf = e.all_fields_map[field.null_lookup_col]  ; if (!nf || !nf.lookup_cols) return
		let ln = nf.lookup_nav                            ; if (!ln) return
		let nv = col_val(ri, nf.fi)
		let ln_ri = e.lookup_val(ri, nf, nv)              ; if (ln_ri == null) return
		let dcol = field.null_display_col ?? field.name
		let df = ln.all_fields_map[dcol]                  ; if (!df) return
		return ln.build_val(ln_ri, df, ln.cell_input_val(ln_ri, df.fi), opt)
	}

	// a lookup cell builds the display field's value, so the column aligns
	// the way that field does, not the way the local foreign-key field does.
	e.field_align = function(field) {
		if (field == e.tree_field)
			return 'left'
		return lookup_display_field(field)?.align ?? field.align
	}

	{
	let vals = []
	// lookup_cols default to the lookup nav's pk. a single lookup col is
	// matched against v itself; the rest of a multi-col lookup is matched
	// against this nav's local_cols, which default to the lookup col names.
	// -> ri in the lookup nav, or null.
	e.lookup_val = function(ri, field, v) {

		let ln = field.lookup_nav                     ; if (!ln || !ln.ready) return null
		let lookup_cols = field.lookup_cols || ln.pk  ; if (!lookup_cols) return null

		if (!lookup_cols.includes(' ')) {
			vals.length = min(vals.length, 1)
			vals[0] = v
			return ln.lookup(lookup_cols, vals)
		}

		let fs = [] // local fields matched against lookup_cols
		for (let col of words(field.local_cols || lookup_cols)) {
			let f = e.all_fields_map[col]
			if (!f) return null
			fs.push(f)
		}
		vals.length = min(vals.length, fs.length)
		for (let i = 0; i < fs.length; i++)
			vals[i] = fs[i] == field ? v : e.cell_input_val(ri, fs[i].fi)
		return ln.lookup(lookup_cols, vals)
	}
	}

	// opt: see field.build(). Without opt, return the text.
	e.build_val = function(ri, field, v, opt) {

		if (v == null) {
			let s = build_null_lookup_val(ri, field, opt)
			if (s) return s

			if (field.build_null)
				return field.build_null(opt)

			s = field.null_text
			if (s) return field.build_text(s, opt)

			return
		}

		if (v === '') {
			if (field.empty_text)
				return field.build_text(field.empty_text, opt)
			return
		}

		let ln_ri = e.lookup_val(ri, field, v)
		if (ln_ri != null) {
			let df = lookup_display_field(field)
			if (df) {
				let ln = field.lookup_nav
				return ln.build_val(ln_ri, df,
					ln.cell_input_val(ln_ri, df.fi), opt)
			}
		}

		return field.build(v, opt)
	}

	/// row slots and inserting -----------------------------------------------

	// grow every array indexed by ri to cap slots, keeping the data.
	function set_capacity(cap1) {
		let word_n = e.mask_word_n
		e.col_vals = e.all_fields.map(field =>
			field.col_storage.grow_col(e.col_vals[field.fi], cap1))
		e.row_flags        = grow_typed(e.row_flags       , cap1)
		e.parent_ri        = grow_typed(e.parent_ri       , cap1)
		first_child_ri     = grow_typed(first_child_ri    , cap1)
		next_sibling_ri    = grow_typed(next_sibling_ri   , cap1)
		e.depth            = grow_typed(e.depth           , cap1)
		e.desc_count       = grow_typed(e.desc_count      , cap1)
		e.tree_i           = grow_typed(e.tree_i          , cap1)
		tree_ris_buf       = grow_typed(tree_ris_buf      , cap1)
		e.visible_i        = grow_typed(e.visible_i       , cap1)
		e.visible_ris      = grow_typed(e.visible_ris     , cap1)
		prev_visible_ris   = grow_typed(prev_visible_ris  , cap1)
		e.sel_mask         = grow_typed(e.sel_mask        , cap1 * word_n)
		e.modified_mask    = grow_typed(e.modified_mask   , cap1 * word_n)
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
				set_capacity(max(1, cap * 2))
			ri = slot_n++
			e.parent_ri[ri] = NONE
		}
		return ri
	}

	function free_slot(ri) {
		// a row of the pending or lost batch is never dropped: the server may
		// have saved it.
		assert(!saving_ris.has(ri))

		// Subtract the row from modified_n if modified. Clear its state before
		// reusing the slot.
		if (is_row_modified(ri))
			e.modified_n--
		e.row_flags[ri] = 0
		e.parent_ri[ri] = NONE
		e.desc_count[ri] = 0
		e.visible_i[ri] = NONE
		clear_row_mask(e.modified_mask, ri)
		clear_row_mask(e.unset_mask, ri)
		group_field.col_storage.set(e.col_vals[group_field.fi], ri, null)
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			if (e.input_vals[fi])
				e.input_vals[fi][ri] = undefined
			set_cell_errors(ri, fi, null)
		}
		e.row_errors[ri] = undefined
		free_ris.push(ri)
	}

	// Accept rows as [[v1, ...] | null, ...], with cells in fi order. Use the
	// first param_vals record, then client_default, for undefined cells or for
	// a null row. Insert before
	// at_ri, or at the end when at_ri is null. Return the new ris, or
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
		let was_editing = e.editing
		e.exit_edit()

		// take a slot for each new row and fill in its cells.
		let parent_id = tree_parent_ri != NONE
			? col_val(tree_parent_ri, e.id_field.fi) : null
		let k = rows.length
		let ris = new Uint32Array(k) // the new rows' slots
		let param_vals = e.param_vals ? e.param_vals[0] : null // {col: val}
		for (let i = 0; i < k; i++) {
			let ri = alloc_slot()
			ris[i] = ri
			for (let field of e.all_fields) {
				let v = rows[i]?.[field.fi]
				if (v === undefined && param_vals)
					v = param_vals[field.name]
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
			e.row_flags[ri] = ROW_NEW | ROW_PASS | ROW_UNPLACED
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
		e.modified_n += k
		if (e.pos_field)
			place_pos(base_i, k, true)
		add_to_indexes(ris)
		update_tree_and_visible_ris()

		// With ev.focus_it, focus the first new row in the same field, and keep
		// editing if the user was editing.
		if (ev?.focus_it)
			e.move_focus(ris[0], true, 0, 0, {was_editing: was_editing})
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
			if (cell_bit(e.modified_mask, ri, fi)) {
				set_cell_bit(e.modified_mask, ri, fi, false)
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
		return e.cell_input_val(ri1, parent_fi) === e.cell_input_val(ri2, parent_fi)
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
		for (let j = i - 1; j >= 0; j--) {
			if (same_pos_list(ris[j], ri)) {
				pos1 = e.cell_input_val(ris[j], pos_fi)
				if (pos1 != null)
					break
			}
		}
		for (let j = i + k; j < e.row_n; j++) {
			if (same_pos_list(ris[j], ri)) {
				pos2 = e.cell_input_val(ris[j], pos_fi)
				if (pos2 != null)
					break
			}
		}

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
				let parent_id = e.cell_input_val(ri, parent_fi)
				e.parent_ri[ri] = parent_id != null
					? e.lookup(e.id_field.name, [parent_id]) ?? NONE : NONE
			}
		}

		// Sort base_ris by pos. Since radix_sort() reads column storage, copy
		// the pos column and write pending edits into the copy first.
		if (!e.pos_field)
			return
		let field = e.pos_field
		let vals = e.col_vals[field.fi]
		if (e.input_vals[field.fi]) {
			vals = vals.slice() // pos with the edited values written in
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (cell_bit(e.modified_mask, ri, field.fi))
					field.col_storage.set(vals, ri, e.input_vals[field.fi][ri])
			}
		}
		let was_unsorted = e.sorted_ris == e.base_ris
		e.base_ris = radix_sort(e.col_vals, e.base_ris, e.row_n,
			[{field: field, desc: false, vals: vals}])
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
		if (e.is_filtered || e.can_be_tree && !e.is_tree)
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
		e.exit_edit()

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
		update_tree_and_visible_ris(false)
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
	// it. Mark a new row of the pending or lost batch too, since the server
	// may have inserted it. Leave group rows unmarked because they are not
	// records. Return false if is_input is set and the row has no_remove.
	function mark_removed(ri, new_ris, is_input) {
		let flags = e.row_flags[ri]
		if (is_input && flags & ROW_NO_REMOVE)
			return false
		if (flags & ROW_GROUP)
			return true
		if (flags & ROW_NEW && !saving_ris.has(ri)) {
			new_ris.push(ri)
		} else {
			let was_modified = is_row_modified(ri)
			set_bits(e.row_flags, ri, ROW_REMOVED, true)
			update_modified_n(ri, was_modified)
		}
		return true
	}

	function unmark_removed(ri) {
		let was_modified = is_row_modified(ri)
		set_bits(e.row_flags, ri, ROW_REMOVED, false)
		update_modified_n(ri, was_modified)
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
		for (let p = e.parent_ri[ri]; p != NONE; p = e.parent_ri[p]) {
			if (!(row_flags[p] & ROW_REMOVED))
				break
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
	// rows, except new rows of the pending or lost batch. In tree or grouped
	// view, include their descendants. With 'undelete', clear the marks. With
	// ev.input, refuse deletion if policy demands it, and keep rows with
	// no_remove. With ev.refocus, if the focused row was dropped, focus the
	// row now at the first dropped row's position.
	e.remove_rows = function(ris, op, ev) {
		let has_parents = e.is_tree || e.is_grouped
		if (op == 'undelete') {
			e.exit_edit()
			for (let ri of ris)
				if (has_parents)
					unmark_subtree_removed(ri)
				else
					unmark_removed(ri)
		} else if (!ev?.input || (e.can_remove_rows && e.rowset_can_remove_rows)) {
			e.exit_edit()
			let had_focus = e.focused_ri != null
			let top_vri = 1/0 // first removed row's position in visible_ris
			for (let ri of ris)
				top_vri = min(top_vri, e.visible_i[ri])

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

			if (ev?.refocus && had_focus && e.focused_ri == null
				&& e.visible_n
			) {
				let ri = e.visible_ris[min(top_vri, e.visible_n - 1)]
				if (!e.move_focus(ri, true, null, null))
					e.move_focus(ri, true, -0, 0)
			}
		}
	}

	// Undo deletion marks on selected rows. Return false if none were marked.
	e.undelete_selected_rows = function(ev) {
		let ris = []
		e.each_selected_row(ri => {
			if (e.row_flags[ri] & ROW_REMOVED)
				ris.push(ri)
		})
		if (ris.length)
			e.remove_rows(ris, 'undelete', ev)
		return ris.length > 0
	}

	/// saving ----------------------------------------------------------------

	function rowset_url() {
		return href('/rowset.json/' + e.rowset_name)
	}

	// Copy the last saved primary key so that the server can find the row.
	function add_old_pk(values, ri) {
		for (let field of e.pk_fields)
			values[field.name + ':old'] = col_val(ri, field.fi)
	}

	// Pack a modified row in rowset.lua's save format. Return null if there is
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
				let v = e.cell_input_val(ri, field.fi)
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
			if (!field.nosave && cell_bit(e.modified_mask, ri, field.fi)) {
				values[field.name] = e.input_vals[field.fi][ri]
				has_vals = true
			}
		if (!has_vals)
			return null
		add_old_pk(values, ri)
		return {type: 'update', values: values}
	}

	function add_batch_row(batch, ri) {
		let flags = e.row_flags[ri]
		if (flags & (ROW_GROUP | ROW_NO_SAVE) || !is_row_modified(ri))
			return
		if (!(flags & ROW_REMOVED) && !e.validate_row(ri))
			return
		let t = pack_row(ri)
		if (!t)
			return
		saving_ris.add(ri)
		batch.rows.push(t)
		batch.ris.push(ri)
	}

	// Return {rows: [...], ris: [...]} in rowset.lua's save format, or null if
	// no row is ready. Walk tree_ris forward for new and edited rows, so that
	// parents go before children, then backward for rows marked for
	// deletion, so that children go before parents. Send the edits first:
	// a row moved out of a parent must leave it before the parent's delete.
	// Skip no_save rows and invalid rows, except rows marked for deletion.
	// Keep the batch until apply_result() or end_save(), and allow only one
	// batch at a time.
	e.pack_changes = function() {
		assert(!save_batch)
		let batch = {rows: [], ris: []}
		for (let i = 0; i < e.tree_n; i++)
			if (!(e.row_flags[e.tree_ris[i]] & ROW_REMOVED))
				add_batch_row(batch, e.tree_ris[i])
		for (let i = e.tree_n - 1; i >= 0; i--)
			if (e.row_flags[e.tree_ris[i]] & ROW_REMOVED)
				add_batch_row(batch, e.tree_ris[i])
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
	// server values. Set is_modified_col[fi] for each modified column. Return
	// true if pos or parent_id changed.
	function set_server_vals(ri, vals, is_modified_col) {
		// Mark the row saved and clear its unset cells.
		let was_modified = is_row_modified(ri)
		set_bits(e.row_flags, ri, ROW_NEW, false)
		clear_row_mask(e.unset_mask, ri)
		update_modified_n(ri, was_modified)

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
				is_modified_col[fi] = 1
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
		if (cell_bit(e.modified_mask, ri, fi)
			&& e.input_vals[fi][ri] === col_val(ri, fi)
		) {
			let was_modified = is_row_modified(ri)
			set_cell_bit(e.modified_mask, ri, fi, false)
			e.input_vals[fi][ri] = undefined
			update_modified_n(ri, was_modified)
		}
	}

	// Update the edit and quicksearch after writing a server value into the
	// cell.
	function update_server_cell(ri, fi) {
		// End quicksearch only for an unedited cell, since the nav displays the
		// pending value of an edited cell.
		if (!cell_bit(e.modified_mask, ri, fi))
			end_quicksearch_at(ri, fi)
		clear_edit_if_same(ri, fi)
	}

	function invalidate_changed_cols(is_modified_col) {
		for (let fi = 0; fi < is_modified_col.length; fi++)
			if (is_modified_col[fi])
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

	// Write server values into rows and drop rows that the server removed.
	// vals_list[k] holds the values of set_ris[k] by fi, undefined for cells
	// that the server didn't send.
	function apply_server_rows(set_ris, vals_list, drop_ris) {
		let moved_ris = [] // rows whose pos or parent_id changed
		let is_modified_col = new Uint8Array(e.all_fields.length) // by fi
		for (let k = 0; k < set_ris.length; k++)
			if (set_server_vals(set_ris[k], vals_list[k], is_modified_col))
				moved_ris.push(set_ris[k])

		// update the indexes, put moved rows back in place and drop the
		// removed rows.
		invalidate_changed_cols(is_modified_col)
		if (moved_ris.length)
			update_row_places(moved_ris)
		if (drop_ris.length)
			drop_rows(drop_ris)
		if (drop_ris.length || moved_ris.length)
			update_tree_and_visible_ris(false)

		// Discard the edit and error arrays if no modified rows remain.
		if (!e.modified_n) {
			e.input_vals = [] // edited values by fi, then ri
			e.cell_errors = [] // cell errors by fi, then ri
		}
	}

	// Apply rowset.lua's reply, with one result per sent row.
	e.apply_result = function(batch, result) {
		let set_ris = [] // rows the server saved
		let vals_list = [] // their server values, by fi
		let drop_ris = [] // rows the server removed

		// For each sent row, store its errors, or collect it to remove or to
		// mark saved.
		for (let k = 0; k < batch.ris.length; k++) {
			let ri = batch.ris[k]
			let rt = result.rows[k]
			if (rt.remove) {
				drop_ris.push(ri)
			} else if (rt.error || rt.field_errors) {
				// new row marked for deletion while in flight, insert failed:
				// the server never had it.
				if ((e.row_flags[ri] & (ROW_NEW | ROW_REMOVED))
					== (ROW_NEW | ROW_REMOVED))
					drop_ris.push(ri)
				else
					set_server_errors(ri, rt)
			} else {
				// Use the sent values if the server did not return row values.
				set_ris.push(ri)
				vals_list.push(rt.values ?? sent_vals(batch.rows[k]))
			}
		}

		// end the batch before dropping rows: free_slot() refuses a row of
		// the batch.
		end_save()
		apply_server_rows(set_ris, vals_list, drop_ris)
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
				&& e.cell_input_val(ri, pk_fi) == null
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
			dont_send: true,
			url: rowset_url(),
			upload: {exec: 'reserve_ids', n: new_ris.length},
			success: function(res) {
				if (this != save_req)
					return
				for (let i = 0; i < new_ris.length; i++) {
					let ri = new_ris[i]
					// The nav may have dropped this row and reused its slot since
					// requesting ids.
					if (e.row_flags[ri] & ROW_NEW && e.cell_input_val(ri, pk_fi) == null)
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
	function end_request(status) {
		// Ignore a request canceled by load() or free().
		if (this != save_req)
			return
		save_req = null
		// failed save: the server may have saved it anyway. keep its rows in
		// saving_ris until a reload settles what the server has.
		if (status == 'fail' && save_batch) {
			save_batch = null
		} else {
			end_save()
		}
		if (want_reload) {
			want_reload = false
			e.reload()
		}
		if (want_save) {
			want_save = false
			e.save()
		}
		ui.animate()
	}

	// Send modified rows to their server rowset, one request at a time. Defer
	// save() if another request is still running.
	e.save = function() {
		assert(e.rowset_name, 'save: rowset_name required')
		if (save_req) {
			want_save = true
			return
		}
		// rows of a failed save left in saving_ris: reload first, so that the
		// reload finds the rows that the server inserted and the nav doesn't
		// send them again.
		if (saving_ris.size) {
			want_save = true
			if (!load_req)
				e.reload()
			return
		}
		if (e.pk_fields[0].auto_increment && reserve_ids())
			return
		let batch = e.pack_changes()
		if (!batch)
			return

		// Assign a save id so that rowset_changed() can ignore the server
		// notification for this save.
		let update_id = floor(Math.random() * 2**52).toString(36)
		own_update_ids.add(update_id)
		save_req = ajax({
			dont_send: true,
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
		if (rs.fields.length != rowset_fields.length)
			return false
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let rs_field = rs.fields[fi]
			if (!isobj(rs_field))
				return false
			// Use all_field_types.type when the field has no explicit type.
			let type = rs_field.type ?? ui.all_field_types.type
			if (rs_field.name !== rowset_fields[fi].name
				|| type !== rowset_fields[fi].type
			) {
				return false
			}
		}
		let pk = rs.pk
		if (isarray(pk)) {
			if (!check_cols(pk, e.all_fields_map))
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

	// Add a row that the server sent and the nav doesn't have, with cells in
	// rowset field order. Return its slot.
	function add_server_row(row) {
		let ri = alloc_slot()
		for (let field of rowset_fields)
			field.col_storage.set(e.col_vals[field.fi], ri,
				row[field.fi] ?? null)
		group_field.col_storage.set(e.col_vals[group_field.fi], ri, null)
		e.row_flags[ri] = 0
		return ri
	}

	// -> [v, ...] by fi: a new row's values, edited or not, undefined for
	// unset cells.
	function new_row_vals(ri) {
		return rowset_fields.map(field => e.cell_input_val(ri, field.fi))
	}

	// -> [fi, ...]: the columns besides pos and parent_id whose values give
	// a row its place: the sort keys, every column for a sort function, and
	// the group keys.
	function place_fis() {
		let fis = isfunc(e.order_by) ? rowset_fields.map(field => field.fi)
			: e.order_by ? [...parse_order_by(e.order_by).keys()]
				.map(field => field.fi)
			: []
		if (e.is_grouped)
			fis.push(...group_fis)
		return fis
	}

	// Sort the rows of sorted_ris, except the rows with pending changes and
	// the rows that the user left where they are (R4): those keep their
	// positions, and the sorted rows fill the other positions.
	function sort_placed_rows() {
		let n = e.row_n
		let sorted_ris = e.sorted_ris
		let has_modifications = e.modified_n > 0
		let is_kept = new Uint8Array(n) // 1: row kept, by index in sorted_ris
		let placed_ris = new Uint32Array(n) // rows to sort, in sorted_ris order
		let m = 0 // number of rows to sort
		for (let i = 0; i < n; i++) {
			let ri = sorted_ris[i]
			if (e.row_flags[ri] & ROW_UNPLACED
				|| (has_modifications && is_row_modified(ri)))
				is_kept[i] = 1
			else
				placed_ris[m++] = ri
		}
		placed_ris = sorted_copy(placed_ris, m, e.order_by)
		let j = 0 // next index into placed_ris
		for (let i = 0; i < n; i++)
			if (!is_kept[i])
				sorted_ris[i] = placed_ris[j++]
	}

	// Rebuild the groups. Focus a focused group again by its label path.
	function regroup() {
		let focused_path = e.focused_ri != null
			&& e.row_flags[e.focused_ri] & ROW_GROUP
			? group_path(e.focused_ri) : null
		// clear the selection of the freed group slots before reusing them.
		remove_groups()
		deselect_hidden_rows()
		add_groups(parse_group_by(e.group_by))
		if (focused_path != null)
			e.focused_ri = e.group_ris.find(ri =>
				group_path(ri) == focused_path) ?? null
	}

	// Apply a change set from the server:
	//   {rows: [[v1, ...], ...], removed_pks: [[pk1, ...], ...]}
	// with the cells of each row in rowset field order. Write the values
	// into the rows found by pk, add the rows not found, and remove the rows
	// of removed_pks. If no row moves, appears or goes away, stop there.
	// Otherwise place the rows by pos and parent_id, then sort, filter and
	// group again, leaving the rows kept in place where they are.
	e.merge_rows = function(change_set) {
		assert(!saving_ris.size, 'merge_rows: a save batch is pending or lost')
		let rows = change_set.rows ?? []
		let removed_pks = change_set.removed_pks ?? []

		// find every row by pk before changing the pk index.
		let found_ris = rows.map(row =>
			e.lookup(e.pk, e.pk_fields.map(field => row[field.fi])))
		let drop_ris = [] // rows to remove
		for (let pk of removed_pks) {
			let ri = e.lookup(e.pk, pk)
			if (ri != null)
				drop_ris.push(ri)
		}

		// write the values. A new row with the same pk becomes the saved row,
		// and its values that differ from the server's become edits. A row
		// without pending changes must be placed again if its sort or group
		// keys or its filter result change, or if the user left it unplaced.
		let key_fis = place_fis()
		let added_ris = [] // rows not found
		let placed_ris = [] // found rows to place again
		let moved_ris = [] // found rows whose pos or parent_id changed
		let is_modified_col = new Uint8Array(e.all_fields.length) // by fi
		for (let k = 0; k < rows.length; k++) {
			let row = rows[k]
			let ri = found_ris[k]
			if (ri == null) {
				added_ris.push(add_server_row(row))
			} else {
				let was_modified = is_row_modified(ri)
				let has_new_keys = key_fis.some(fi =>
					row[fi] !== undefined && row[fi] !== col_val(ri, fi))
				let new_vals = e.row_flags[ri] & ROW_NEW ? new_row_vals(ri) : null
				if (set_server_vals(ri, row, is_modified_col))
					moved_ris.push(ri)
				if (new_vals)
					for (let fi = 0; fi < new_vals.length; fi++) {
						let v = new_vals[fi]
						if (v === undefined)
							continue
						set_input_val(ri, fi, v)
						if (cell_bit(e.modified_mask, ri, fi))
							set_cell_errors(ri, fi,
								validate_cell(e.all_fields[fi], v))
					}
				update_invalid(ri)
				let is_pass = !row_filter || row_filter(ri)
				if (!was_modified && (has_new_keys
					|| e.row_flags[ri] & ROW_UNPLACED
					|| is_pass != !!(e.row_flags[ri] & ROW_PASS))
				) {
					e.row_flags[ri] &= ~ROW_UNPLACED
					placed_ris.push(ri)
				}
			}
		}
		invalidate_changed_cols(is_modified_col)

		// Place rows only when one moves, appears or goes away. Append the
		// added rows, then put rows in pos order and under their parents.
		if (drop_ris.length || added_ris.length || moved_ris.length
			|| placed_ris.length
		) {
			if (drop_ris.length)
				drop_rows(drop_ris)
			let n = e.row_n // rows before adding
			let k = added_ris.length
			let was_unsorted = e.sorted_ris == e.base_ris
			let new_ris = Uint32Array.from(added_ris)
			e.base_ris = insert_into_list(e.base_ris, n, n, new_ris, k)
			e.sorted_ris = was_unsorted ? e.base_ris
				: insert_into_list(e.sorted_ris, n, n, new_ris, k)
			e.row_n += k
			add_to_indexes(added_ris)
			if (moved_ris.length || k)
				update_row_places(moved_ris.concat(added_ris))
			if (!was_unsorted)
				sort_placed_rows()
			update_pass()
			if (e.is_grouped)
				regroup()
			update_tree_and_visible_ris(false)
		}

		// Discard the edit and error arrays if no modified rows remain.
		if (!e.modified_n) {
			e.input_vals = [] // edited values by fi, then ri
			e.cell_errors = [] // cell errors by fi, then ri
		}
	}

	/// reloading -------------------------------------------------------------

	// Load the rowset again with reload_rowset(), which uses load() the
	// first time. Wait for a pending save to finish before reloading, because
	// the server may not have saved those values yet.
	e.reload = function() {
		assert(e.rowset_name, 'reload: rowset_name required')
		if (save_req) {
			want_reload = true
			return
		}
		if (!is_server_rowset) {
			e.reload_rowset(ui.rowsets[e.rowset_name])
			e.ready = true
		} else if (e.param_vals === false) { // no master row: load nothing
			load_req?.abort()
			load_req = null
			refilter()
		} else {
			let url = rowset_url()
			let filter = param_vals_filter()
			if (filter) {
				let u = url_parse(url)
				u.args = u.args || {}
				u.args.filter = filter
				url = url_format(u)
			}
			load_req?.abort()
			load_req = ajax({
				dont_send: true,
				url: url,
				success: function(rs) {
					if (this != load_req)
						return
					e.reload_rowset(rs)
					e.ready = true
					// the reload settled the failed save: run the save that waited.
					if (want_save) {
						want_save = false
						e.save()
					}
				},
				done: function() {
					if (this == load_req) {
						load_req = null
						ui.animate()
					}
				},
			})
			load_req.send()
		}
	}

	// Reload for server notifications, except those from this nav's own saves
	// and those for a load filtered by other param_vals.
	function rowset_changed(update_ids, filter) {
		let is_own = true
		for (let update_id of update_ids)
			if (!own_update_ids.delete(update_id))
				is_own = false
		if (!is_own && (filter == null || filter == param_vals_filter()))
			e.reload()
	}

	// Stop listening for server notifications, abort loading, and ignore
	// replies to pending saves.
	e.free = function() {
		for (let field of e.all_fields)
			free_field_lookup_nav(field)
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
			let vals = rs.col_vals[fi]
			if (warn_if(!(isarray(vals)
				|| vals instanceof Float64Array
				|| vals instanceof Uint8Array),
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

	function check_cols(cols, all_fields_map) {
		let fields = []
		for (let col of cols) {
			if (!check_col_name(col))
				return null
			let field = all_fields_map[col]
			if (warn_if(!field, e.id, 'unknown column:', col))
				return null
			fields.push(field)
		}
		return fields
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

		// validation: no state changes so we can early-return on failure.

		if (warn_if(!isarray(rs.fields), e.id, 'fields array required'))
			return
		if (warn_if(!rs.fields.length, e.id, 'no fields'))
			return
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
			field.fi = fi
			let saved_w = ui.saved_state[e.id+'.col_ws']?.[name]
			if (saved_w != null)
				field.w = saved_w
			let saved_filter = ui.saved_state[e.id+'.col_filters']?.[name]
			if (saved_filter !== undefined)
				field.filter = saved_filter
			field.filter_field = create_filter_field(field)
			all_fields.push(field)
			all_fields_map[name] = field
		}

		let pk = isarray(rs.pk) ? rs.pk.join(' ') : rs.pk
		let pk_cols = isarray(rs.pk) ? rs.pk : words(rs.pk ?? '')
		if (warn_if(!(isarray(pk_cols) && pk_cols.length), e.id, 'pk required'))
			return
		let pk_fields = check_cols(pk_cols, all_fields_map)
		if (!pk_fields)
			return
		// a server rowset's pk is one auto_increment number field, whose ids
		// the nav reserves before saving, or fields that the user fills in.
		let is_reserved_pk = pk_fields.length == 1
			&& pk_fields[0].is_number && pk_fields[0].auto_increment
		let is_typed_pk = pk_fields.every(field =>
			field.not_null && !field.has_server_default)
		if (warn_if(is_server_rowset && !is_reserved_pk && !is_typed_pk, e.id,
			'pk must be one auto_increment number field,'
			+ ' or not_null fields without a server default'))
			return

		let pos_field     = col_field(rs.pos_col    , all_fields_map)
		let id_field      = col_field(rs.id_col     , all_fields_map)
		let parent_field  = col_field(rs.parent_col , all_fields_map)
		let display_field = col_field(rs.display_col, all_fields_map)

		if (
			   rs.pos_col     != null && !pos_field
			|| rs.id_col      != null && !id_field
			|| rs.parent_col  != null && !parent_field
			|| rs.display_col != null && !display_field
		)
			return

		// id_col defaults to a one-column pk.
		if (rs.id_col == null && pk_fields.length == 1)
			id_field = pk_fields[0]

		if (warn_if(id_field && parent_field
				&& !(is_reserved_pk && id_field == pk_fields[0]), e.id,
			'tree id must be the pk, one auto_increment number field'))
			return

		let src_col_vals = rowset_col_vals(rs, all_fields.length)
		if (!src_col_vals)
			return

		// init: from here on, no more returns.

		e.exit_edit()

		if (e.all_fields)
			for (let field of e.all_fields)
				free_field_lookup_nav(field)
		for (let field of all_fields)
			init_field_lookup_nav(field)

		e.all_fields = all_fields
		e.all_fields_map = all_fields_map
		e.pk = pk
		e.pk_fields = pk_fields
		for (let field of pk_fields)
			field.immutable = true
		e.pos_field = pos_field
		e.id_field = id_field
		e.parent_field = parent_field
		e.display_field = display_field

		group_field = ui.create_field({
			name: '$group', label: 'Group', w: 12,
			is_group_field: true, readonly: true, nosave: true,
			movable: false, groupable: false, sortable: false,
		}, e.id)
		group_field.fi = e.all_fields.length // field index
		group_field.filter_field = create_filter_field(group_field)

		rowset_fields = e.all_fields.slice()
		rowset_cols = (rs.cols != null ? words(rs.cols)
			: rowset_fields.filter(field => !field.hidden)
				.map(field => field.name)).join(' ')
		rowset_tree_col = rs.tree_col
		e.all_fields.push(group_field)
		e.all_fields_map[group_field.name] = group_field

		e.rowset_can_add_rows    = rs.can_add_rows    != false
		e.rowset_can_remove_rows = rs.can_remove_rows != false
		e.rowset_can_change_rows = rs.can_change_rows != false
		e.rowset_can_move_rows   = rs.can_move_rows   != false

		e.mask_word_n = (e.all_fields.length + 31) >>> 5
		all_fields_mask = fields_mask(e.all_fields)
		e.last_focused_fi = null

		e.cols = saved_opt('cols')
		e.order_by = saved_opt('order_by')
		e.can_be_tree = !!(e.id_field && e.parent_field)
		e.group_by = null
		e.group_cols = []
		collapsed_group_paths.clear()

		// abort/clear any current requests (save or load).
		let cur_save_req = save_req
		save_req = null
		cur_save_req?.abort()
		end_save()
		want_save = false
		want_reload = false

		load_rows(src_col_vals, null, null)
		let group_by = saved_opt('group_by')
		if (group_by)
			e.set_group_by(group_by)
		e.move_focus(null, null)
	}

	// load rows from src_col_vals and re-apply filters, order_by, group_by,
	// cols, flat mode, edit state, collapsed flags.
	// resets focus, selection, quicksearch.
	function load_rows(src_col_vals, edit_state, collapsed_pks) {
		e.exit_edit()
		e.row_n = src_col_vals[0].length
		// capacity of ri-indexed arrays: the replay adds at most one row per
		// recorded row, +1 for 1 free insert.
		cap = e.row_n + (edit_state ? edit_state.rows.length : 0) + 1
		e.col_vals = rowset_fields.map(field =>
			field.col_storage.load_col(src_col_vals[field.fi], cap))
		e.col_vals[group_field.fi] = new Array(e.row_n).fill(null)

		e.row_flags        = new Uint16Array(cap)
		e.parent_ri        = new Uint32Array(cap).fill(NONE)
		first_child_ri     = new Uint32Array(cap)
		next_sibling_ri    = new Uint32Array(cap)
		e.depth            = new Uint16Array(cap)
		e.desc_count       = new Uint32Array(cap)
		e.tree_i           = new Uint32Array(cap)
		tree_ris_buf       = new Uint32Array(cap)
		e.visible_i        = new Uint32Array(cap)
		e.visible_ris      = new Uint32Array(cap)
		prev_visible_ris   = new Uint32Array(cap)
		e.visible_n = 0

		// include every row before applying a filter.
		e.row_flags.fill(ROW_PASS)

		// Stage 1: init base_ris and sorted_ris.
		e.base_ris = new Uint32Array(e.row_n)
		for (let ri = 0; ri < e.row_n; ri++)
			e.base_ris[ri] = ri
		// Use pos order as stored order when pos_col is set.
		if (e.pos_field)
			e.base_ris = radix_sort(e.col_vals, e.base_ris, e.row_n,
				[{field: e.pos_field, desc: false}])

		e.sorted_ris = e.base_ris

		indexes = map()

		e.sel_mask = new Uint32Array(cap * e.mask_word_n)
		has_sel_bits = false
		set_focus(null, null)
		e.quicksearch_text = ''
		set_rect(null, null, null, null) // no selection rectangle

		e.modified_mask = new Uint32Array(cap * e.mask_word_n)
		e.unset_mask = new Uint32Array(cap * e.mask_word_n)
		e.modified_n = 0
		e.input_vals = []
		e.cell_errors = []
		e.row_errors = []

		slot_n = e.row_n
		free_ris = []
		// slots of a lost save batch now hold other rows.
		saving_ris.clear()

		e.is_grouped = false
		e.group_ris = new Uint32Array(0)
		group_fis = new Set()

		if (edit_state)
			replay_edit_state(edit_state)
		if (collapsed_pks)
			for (let pk of collapsed_pks) {
				let ri = e.lookup(e.pk, pk)
				if (ri != null)
					set_bits(e.row_flags, ri, ROW_COLLAPSED, true)
			}

		if (e.can_be_tree)
			set_tree_parents()
		// put rows moved by pending parent_id or pos edits back in their
		// places. grouping below sets the parents of grouped rows again.
		if (edit_state) {
			let edited_parent_ris = [] // rows with parent_id edits
			let parent_fi = e.parent_field?.fi
			if (e.can_be_tree && e.input_vals[parent_fi])
				for (let i = 0; i < e.row_n; i++)
					if (cell_bit(e.modified_mask, e.base_ris[i], parent_fi))
						edited_parent_ris.push(e.base_ris[i])
			if (edited_parent_ris.length || e.pos_field)
				update_row_places(edited_parent_ris)
		}
		sort_ris(e.order_by)
		update_row_filter()
		update_pass()
		if (e.group_by)
			add_groups(parse_group_by(e.group_by))
		update_visible_fields()
		update_is_tree()

		// Rebuild the tree before expanding ancestors: update_tree_ris()
		// clears circular parent links. Expand the collapsed ancestors of
		// modified rows, because the nav never hides an edited cell.
		update_tree_ris()
		if (e.is_tree && collapsed_pks?.length)
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (is_row_modified(ri))
					for (let p = e.parent_ri[ri]; p != NONE; p = e.parent_ri[p])
						e.row_flags[p] &= ~ROW_COLLAPSED
			}
		update_pass_desc()
		update_visible_ris()
	}

	// -> [v1, ...]: the row's pk, with a new row's typed pk.
	function row_pk(ri) {
		return e.pk_fields.map(field => e.cell_input_val(ri, field.fi))
	}

	// A server rowset loads only the rows matching param_vals. Return true if
	// a row with row_vals {col: val} was among the rows requested.
	function is_requested_vals(row_vals) {
		if (!(e.param_vals && is_server_rowset))
			return true
		return e.param_vals.some(vals =>
			keys(vals).every(col => row_vals[col] === vals[col]))
	}

	// Return the pending changes as plain JSON, by pk and column name:
	//   {rows: [{pk: [v1, ...], is_new, is_removed, vals: {col: v},
	//     edits: {col: v}}, ...]}
	// vals holds the set column values: a new row's own values, or the server
	// values of a saved row.
	e.get_edit_state = function() {
		let rows = []
		for (let i = 0; i < e.row_n; i++) {
			let ri = e.base_ris[i]
			if (!is_row_modified(ri))
				continue
			let vals = {} // set column values, by col
			let edits = {} // edited values, by col
			for (let field of rowset_fields) {
				let fi = field.fi
				if (!cell_bit(e.unset_mask, ri, fi))
					vals[field.name] = col_val(ri, fi)
				if (cell_bit(e.modified_mask, ri, fi))
					edits[field.name] = e.input_vals[fi][ri]
			}
			let flags = e.row_flags[ri]
			rows.push({
				pk: row_pk(ri),
				is_new: !!(flags & ROW_NEW),
				is_removed: !!(flags & ROW_REMOVED),
				vals: vals,
				edits: edits,
			})
		}
		return {rows: rows}
	}

	// Add a recorded row that the server didn't return, with its recorded
	// column values. Return its slot.
	function add_recorded_row(row) {
		let ri = alloc_slot()
		for (let field of rowset_fields) {
			let v = row.vals[field.name]
			if (v === undefined)
				set_cell_bit(e.unset_mask, ri, field.fi, true)
			field.col_storage.set(e.col_vals[field.fi], ri, v ?? null)
		}
		group_field.col_storage.set(e.col_vals[group_field.fi], ri, null)
		e.row_flags[ri] = row.is_new ? ROW_NEW | ROW_PASS | ROW_UNPLACED
			: ROW_PASS
		if (row.is_new)
			e.modified_n++
		return ri
	}

	// Write edit_state from get_edit_state() over the server rows that
	// load_rows() just loaded, finding each recorded row by pk:
	//   saved row found: write the edits and the deletion mark again.
	//   new row found: the server saved it, so it becomes that saved row, and
	//     its values that differ from the server's become edits (R4).
	//   saved row not found: drop it, unless the server didn't load it
	//     because it doesn't match param_vals.
	//   new row not found: add it again, unless it is marked for deletion,
	//     because then its insert never committed.
	function replay_edit_state(edit_state) {
		let added_ris = [] // recorded rows added again
		for (let row of edit_state.rows) {
			let ri = e.lookup(e.pk, row.pk)
			let edits = row.edits // {col: v}
			if (ri != null) {
				if (row.is_new)
					edits = assign({}, row.vals, row.edits)
			} else {
				if (row.is_new ? row.is_removed : is_requested_vals(row.vals))
					continue
				ri = add_recorded_row(row)
				added_ris.push(ri)
			}
			for (let col in edits) {
				let field = e.all_fields_map[col]
				set_input_val(ri, field.fi, edits[col])
				// an edit equal to the server value is gone: nothing to check.
				if (cell_bit(e.modified_mask, ri, field.fi))
					set_cell_errors(ri, field.fi, validate_cell(field, edits[col]))
			}
			if (row.is_removed) {
				let was_modified = is_row_modified(ri)
				set_bits(e.row_flags, ri, ROW_REMOVED, true)
				update_modified_n(ri, was_modified)
			}
			update_invalid(ri)
		}

		// append the added rows to the stored order and the indexes.
		let k = added_ris.length
		if (k) {
			e.base_ris = insert_into_list(e.base_ris, e.row_n, e.row_n,
				Uint32Array.from(added_ris), k)
			e.sorted_ris = e.base_ris
			e.row_n += k
			add_to_indexes(added_ris)
		}
	}

	// reload rs, but keep and re-apply pending changes, collapsed flag and
	// view view settings. falls back to load(rs) if rowset definition differs.
	e.reload_rowset = function(rs) {
		if (!is_same_rowset(rs)) {
			e.load(rs)
			return
		}
		let src_col_vals = rowset_col_vals(rs, rowset_fields.length)
		if (!src_col_vals)
			return
		let edit_state = e.get_edit_state()
		// collapse flags on data rows matter only in a nav that can be a tree.
		let collapsed_pks = [] // pks of the collapsed rows
		if (e.can_be_tree)
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (e.row_flags[ri] & ROW_COLLAPSED)
					collapsed_pks.push(row_pk(ri))
			}
		load_rows(src_col_vals, edit_state, collapsed_pks)
		e.move_focus(null, null)
	}

	if (e.rowset_name && !is_server_rowset) {
		e.load(ui.rowsets[e.rowset_name])
		e.ready = true
	} else {
		// Start with no rows until the first load.
		e.load({fields: [{name: 'id', hidden: true, not_null: true}], pk: 'id',
			rows: []})
		if (is_server_rowset) {
			listen_rowset_events()
			rowset_listeners[e.rowset_name] ??= new Set()
			rowset_listeners[e.rowset_name].add(rowset_changed)
			e.reload()
		}
	}

	return e
}

//// LOOKUP_INPUT ------------------------------------------------------------

function lookup_input_update(id, s) {
	s.input_value = undefined
	let field = s.field
	let ln = s.lookup_nav
	let disabled = s.readonly || !can_pick_lookup_val(field, ln)

	ui.dropdown_update(id, s, disabled)

	if (s.opened)
		s.revert_value = s.value
	if (s.closed && !s.picked) {
		s.input_value = s.revert_value
	} else if (!disabled) {
		let ln_ri = ui.input_value(id+'.picker')
		if (ln_ri !== undefined)
			s.input_value = ln_ri != null
				? ln.cell_input_val(ln_ri, lookup_val_field(field, ln).fi) : null
	}

	if (!disabled && !field.not_null && ui.focused(id)
		&& ui.keydown('delete'))
		s.input_value = null
}

function free_lookup_input(s) {
	s.lookup_nav.unref()
}

ui.lookup_input = function(id, value, field, fr, readonly) {
	let picker_id = id+'.picker'
	let s = ui.state(id)
	if (!s.lookup_nav) {
		s.lookup_nav = lookup_nav(field.lookup_rowset_name)
		s.lookup_nav.ref()
		ui.on_free(id, free_lookup_input)
	}
	readonly ??= field.readonly
	s.field = field
	s.readonly = readonly
	s = ui.state(id, lookup_input_update)
	let ln = s.lookup_nav

	ui.default_min_w(ui.em_input())
	ui.stack('', fr, 's', 's')

	ui.focusable(id)
	let open = ui.dropdown(id)
	if (!open && ui.focus_inside(picker_id))
		ui.focus(id)

	value = ui.set_value(id, s, value, open ? null : field)

	let val_field = lookup_val_field(field, ln)
	let display_field = lookup_display_field(field, ln)
	let ln_ri = ln.ready && value != null && val_field && display_field
		? ln.lookup(val_field.name, [value]) : null
	let text
	if (!ln.ready) {
		text = S('loading', 'loading...')
	} else if (value == null) {
		text = null
	} else if (ln_ri != null) {
		let display_v = ln.cell_input_val(ln_ri, display_field.fi)
		text = display_v == null ? null : display_field.to_text(display_v)
	} else {
		text = field.to_text(value)
	}

	if (text != null && ui.focused(id) && ui.keydown('ctrl c'))
		copy_to_clipboard(text)

		let disabled = readonly || !can_pick_lookup_val(field, ln)
		let focused = ui.focused(id)
		let state = disabled
			? (focused ? 'readonly focused' : 'readonly')
			: (focused ? 'focused' : null)
		ui.bb('input', state, 1, 'intense', state)
		ui.color('text', state)
		ui.draw_value_row(text, null, null,
			ui.sp(), ui.em(1), null, null, 'l')

	ui.dropdown_picker(id, 'b')

		if (open) {
			ui.grid(picker_id, {nav: ln, value: ln_ri,
				max_w: ui.popup_max_w(), max_h: ui.em(12), resizable: true},
				0, 's', 's')
		}

	ui.end_dropdown(id)

	ui.end_stack()

	return value
}

}())
