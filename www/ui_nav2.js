/*

	UI nav objects v2.
	Written by Cosmin Apreutesei. Public Domain.

A nav is an in-memory table with typed columns and rows, populated from a
rowset*. Once set up, rows can be sorted, filtered, grouped, form a tree,
added, removed, moved at different positions, cells can be focused, selected,
modified, etc. A nav is the data model for the grid widget.

*A rowset is a POD containing field definitions and cell values. It can come
from a http server as JSON, or constructed in JS. Spec in rowset.lua, examples
in ui-demo.html.

DATA STRUCTURES --------------------------------------------------------------

The nav gives every row a slot number ri (row index) at load or insert and
keeps it until the row is deleted. The nav stores every per-row fact in a typed
array indexed by ri, and every ordered list of rows as a Uint32Array of ri's.
No op writes back into row objects: an op writes entries at known ri's, or
makes sequential passes over typed arrays.

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

The nav grows all ri-indexed arrays together by doubling, and takes new
slots from free_ris (the free list of removed rows) first.

Per-row arrays, indexed by ri:

	name             type        holds
	---------------  ----------  ------------------------------------------
ROW STATE & OPTIONS:
	row_flags        Uint16      one bit per flag below; 0 by default
ROW VISIBILITY:
	visible_i        Uint32      index into visible_ris; NONE if hidden
CELL SELECTION:
	sel_mask         Uint32 x W  one bit per selected cell
CELL EDITING:
	changed_mask     Uint32 x W  one bit per edited cell; nonzero: changed
	unset_mask       Uint32 x W  one bit per new row's cell left to the
	                             server default (see unset cell)
TREE:
	parent_ri        Uint32      tree parent, group row or NONE
	first_child_ri   Uint32      first child, in current order
	next_sibling_ri  Uint32      next sibling, in current order
	depth            Uint16      indent level
	desc_count       Uint32      number of descendants
	tree_i           Uint32      index into tree_ris

A row's subtree is tree_ris[tree_i .. tree_i + desc_count].

Flags in row_flags. One word (uint32) per row, so stage 5 reads its three
flags with one load; ops that set a flag on all rows loop over row_flags.

	flag           bit             set when
	-------------  --------------  --------------------------------------------
ROW DISPLAY STATE:
	is_collapsed   ROW_COLLAPSED   row is collapsed
	is_pass        ROW_PASS        row passes current filters
	has_pass_desc  ROW_PASS_DESC   some descendant passes current filters
	is_group       ROW_GROUP       row is a synthetic group row
ROW EDITING STATE:
	is_new         ROW_NEW         inserted, not saved yet
	is_removed     ROW_REMOVED     marked for deletion
	is_invalid     ROW_INVALID     row or one of its cells failed validation
ROW OPTIONS:
	no_focus       ROW_NO_FOCUS    row can't be focused
	no_change      ROW_NO_CHANGE   row's cells can't be edited
	no_remove      ROW_NO_REMOVE   row can't be deleted
	no_save        ROW_NO_SAVE     row is never saved

Row orders, each a Uint32Array of ri's:

	base_ris     stored order; pos order on pos_col navs
	sorted_ris   data rows in sort order
	tree_ris     all rows, each parent before its descendants
	visible_ris  rows shown, in display order; two buffers, swapped on each
	             stage 5 run

Other state:

	name           type         holds
	-------------  -----------  ---------------------------------------------
FIELDS:
	all_fields     Array[fi]    field objects made with ui.create_field()
	all_fields_map object       {name->field}
	fields         Array[vfi]   visible columns in display order;
	                            field.index: position in fields
ROW BIT MASKS:
	mask_word_n    number       W: words per row in sel_mask, changed_mask
	has_sel_bits   boolean      false: sel_mask is all zero, so clearing it
	                            and stage 5's walk can be skipped
GROUPS:
	group_ris      Uint32Array  group row in key order; empty if ungrouped
ROW ALLOCATION:
	cap            number       capacity of every ri-indexed array
	slot_n         number       row slots ever used, free ones included
	free_ris       Array        free row slots, used as a stack
EDITING STATE:
	changed_n      number       number of changed rows
	input_vals     Array[fi][ri]  edited values (on-demand, sparse)
	cell_errors    Array[fi][ri]  cell validation errors (on-demand, sparse)
	row_errors     Array[ri]    row validation errors (on-demand, sparse)
INDEXING:
	indexes        Map{cols->index}  ris sorted by cols, in a Uint32Array
SAVING:
	rowset_name    string       the server rowset loaded from and saved to
	reserves_ids   boolean      new rows get ids from the server before
	                            their first save
CELL FOCUS & SELECTION STATE:
	focused_ri     number       focused row; null when no row is focused
	focused_fi     number       focused column
	sel_anchor_ri  number       selection rectangle from the anchor cell to
	sel_anchor_fi  number       the end cell, not yet written into sel_mask;
	sel_end_ri     number       it spans the visible rows and the visible
	sel_end_fi     number       columns between the two cells
	quicksearch_text string     typed prefix of the focused cell's text;
	                            '': no quicksearch

Policy. ev.input marks a call that the user made. The nav checks policy
options only on those calls; app code calls without ev.input, and the nav
refuses it only what would leave the nav's own state inconsistent. Policy
options: the nav options can_add_rows, can_remove_rows, can_change_rows and
can_move_rows (default true) and the rowset attributes of the same names
(kept as rowset_can_add_rows etc.); can_change_parent; readonly fields; the
row flags no_change and no_remove.

A row is changed when is_new or is_removed is set or its changed_mask is
nonzero. The ops below add 1 to changed_n when a row becomes changed and
subtract 1 when it becomes clean. Save and revert all find the changed rows
with one scan.

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
returns the first row with the key: every caller uses only one row.

Stages -----------------------------------------------------------------------

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

Stage 1. No pass of its own: each op that adds, removes or moves rows edits
base_ris in place. load: 0..n-1, sorted by pos on pos_col navs. insert:
unsorted: spliced in before the row at i; sorted: appended. move: taken out,
then spliced in before the row at i. drop rows: one compaction pass. merge
rowset: the added rows appended. pos_col navs: after a revert, a save ack or
a merge writes pos or parent_id cells, the nav sorts base_ris by pos again,
edited pos included. unsorted: sorted_ris is the same array.

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

Ops --------------------------------------------------------------------------

load: from rows or from one array per column (a rowset made in code): copy
each column into its column storage, null -> NaN (number) or 2 (bool); a
string column takes the array itself. base_ris = 0..n-1, sorted by pos on
pos_col navs; tree navs: build the id index, radix-sort the rows by parent_id
and walk both lists together to fill parent_ri (a parent_id not found: root);
stages 3-5. rows that stage 3 doesn't reach are in a cycle: warn and show the
rows flat

sort: stages 2, 3, 5

unsort: sorted_ris = base_ris; stages 3, 5

filter: is_pass = fn(ri) per data row; new and changed rows: is_pass stays 1
until saved; stages 4, 5

insert k rows at i: refused under a new row; grouped: refused at a group row
or at the end. ev.input: also refused under a row marked for deletion, and
while can_add_rows is off. take k slots from free_ris, then from the end, and
reset their entries; is_new = 1, is_pass = 1; copy parent_ri and the parent_id
cell from the row at i (grouped: the tree parent is found through the id
index); grouped: copy the key cells too. unsorted: one copyWithin splices all
k into base_ris before the row at i; pos_col: pos values spaced between the
neighbors'. sorted: one copyWithin splices them into sorted_ris before the row
at i, and the nav appends them to base_ris; pos_col: pos values after all
siblings. merge them into the indexes; changed_n += k; stages 3-5

delete k rows: is_removed = 1 on the rows; tree view or grouped: on their
subtrees too (desc_count + 1 entries of tree_ris). a group row is never
marked: removing it marks the rows under it. ev.input: refused while
can_remove_rows is off; a row with no_remove stays, and so do its ancestors.
marked rows stay visible. changed_n +1 per row that was clean. new rows: drop
rows

undelete k rows: clear is_removed on marked rows and on their marked
ancestors; changed_n -1 per row that becomes clean

update cell: refused on group rows, on pos_col cells, on a tree nav's id and
parent_id cells, and on key cells while grouped. ev.input: also refused on
readonly cells (the server marks pk cells readonly), on rows with no_change or
marked for deletion, and on saved rows while can_change_rows is off. write
input_vals[fi][ri]; set its changed_mask bit; back to the server value: clear
the bit instead. validate cell; row clean before the edit: changed_n += 1;
is_pass = 1. O(1), no stage runs

revert cell: clear its changed_mask bit; clear its input_vals and cell_errors
entries; row clean now: changed_n -= 1

revert row: new row: drop rows. else: revert each edited cell

revert all: scan base_ris for changed rows: new: drop rows, all in one pass;
others: undelete and revert row. then drop all input_vals and cell_errors
arrays. O(n)

validate cell: on update cell: run the column's validator on the value; error:
write cell_errors[fi][ri], else clear it; is_invalid = any cell or row error

validate row: when the focus leaves an edited or new row, and in save:
new rows: validate every cell; is_invalid from cell_errors and row_errors
as above

lookup cols vals: binary search in the index on cols, built on the first
lookup -> ri, or none. O(log n)

merge rowset: on reload; other columns or keys: load instead. radix-sort the
incoming rows by pk and walk them along the pk index. matched saved rows: one
pass per column (col_storage.copy_changed) copies the cells that differ, and
only those get save ack's per-cell work. matched new row (by its reserved
id): left new; the next save sends it again and the server skips the insert.
incoming row not matched: append it to base_ris as a saved row. row not
matched and not new: drop rows. invalidate the indexes of the columns written
and merge the added rows into the others. filtered: is_pass again for the
rows that aren't changed. grouped: rebuild the groups. only if their
inputs changed: tree parents (rows added or dropped, id or parent_id
changed), pos order (rows added, pos changed), stage 2 (rows added, any
column changed). stages 3-5. O(n)

collapse/expand: set or clear is_collapsed on the row, and with recursive on
its subtree too; stage 5

collapse/expand all: set or clear is_collapsed on the roots, or with recursive
on every row; stage 5

tree/flat view: stages 3-5

group by levels: refused in tree view, and while a row has an edited cell in a
key column (the scan below reads the columns, not input_vals); unknown and
non-groupable columns are ignored. a level's key is its column's cell, or for
a ranged column ('col[/offset] [/unit]/freq') the cell's bucket: a number
step, or the month or year of a date. sort data rows by the level keys into a
temporary array; one scan opens a group at each level where a key differs from
the previous row's. the nav gives each group a slot: is_group = 1, key cells
written (the bucket's first value for ranged columns), null in the other
cells, is_pass = 0, parent_ri = enclosing group. each data row: parent_ri =
innermost group. group_ris = group slots in key order; stages 3-5. a group
row's label comes from its key cells and its level's range

ungroup: group slots to free_ris; group_ris emptied; tree navs: parent_ri
rebuilt from the parent_id cells through the id index; other navs: parent_ri =
NONE; stages 3-5

move k rows to i: refused while sorted or grouped; a parent change needs a
tree nav, and a new parent that isn't new and isn't in the moved subtrees.
ev.input: also refused while filtered, in flat view of a tree nav, while
can_move_rows is off, and for rows that aren't siblings; a same-parent move
needs pos_col; a parent change needs can_change_parent, a writable parent_id
and a new parent not marked for deletion. stage 3 puts the rows' descendants
under them. one compaction pass takes them out of base_ris; one copyWithin
puts them before the row at i. each row with another parent: write its
parent_ri and its parent_id cell. pos_col: new pos values spaced between the
neighbors'; no gap left: renumber that sibling list 1..m. pos and parent_id go
in as edits (input_vals) on saved rows, into the columns on new rows; stages
3-5

select all: rectangle from the first to the last visible cell; focus the first
cell

select none: sel_mask.fill(0); no rectangle

extend selection: move the rectangle's end cell. O(1)

new selection: write the rectangle into sel_mask: turn its visible columns
into fi bits and OR them into each of its rows, O(rows in it); start a new
rectangle

iterate selection: one pass over sel_mask, plus the rectangle. O(n). set null
on selected cells, delete selected rows and move selected rows use it

set null on selection: iterate selection; set_cell_val(ri, fi, null, ev) on
each selected cell, which refuses the same cells as update cell. O(visible
rows * W + selected cells * columns)

render cell: selected: bit fi set in sel_mask, or inside the rectangle by
visible_i and visible column position

hide column: clear bit fi in every row's sel_mask

focus up/down: visible_ris[visible_i[focused_ri] -+ 1], skipping rows with
no_focus

quicksearch s fi: walk visible_ris from the focused row, wrapping around, for
the first row without no_focus whose cell text in column fi starts with s,
case ignored; focus it and set quicksearch_text = s. offset 1 or -1: start at
the next or the previous row and walk forward or backward. cell text: the
field's null_text for null, empty_text for '', to_text(v) otherwise.
focus_cell() on another cell, and set_input_val() or write_cell() on the
focused cell, set quicksearch_text = ''. O(visible rows)

drop rows: one compaction pass over base_ris and sorted_ris; changed_n -1 per
changed row dropped; remove the rows from the indexes and clear their
input_vals, cell_errors and row_errors entries; slots to free_ris; groups left
without rows: freed and dropped from group_ris; stages 3-5

save: to rowset_name, one request at a time: a save asked meanwhile goes out
after the ack. reserves_ids: new rows without an id first get ids from the
server (exec 'reserve_ids'), so that a resent insert carries the same id and
the server skips it. then scan tree_ris backwards for changed rows, skipping
group rows, rows with no_save, rows in flight and rows that fail validate row
(except rows marked for deletion): new rows with their cells except the unset
ones; changed rows with pk:old and the cells in changed_mask; removed rows
with pk:old. the backward scan sends children before their parents. the sent
rows stay in flight until the ack; a failed request leaves them changed for
the next save. O(n)

save ack: per sent row, by position: removed: drop rows. error: row_errors
and cell_errors; the row stays changed. else: write the server's values (or
the sent ones) into the columns; edits that now equal the column value stop
counting as edited; is_new and the unset bits are cleared. a row dropped while
in flight is skipped. invalidate the indexes of the columns written. changed_n
0: drop all input_vals and cell_errors arrays

reload: load the rowset from rowset_name: the first time load, then merge
rowset. held while a save request is in flight. a push from the server
reloads, unless all its update_ids are from our saves

unset cell: a new row's cell given no value and no client_default at insert;
cell_val is undefined, save leaves it out, validate row checks it unless the
field has a server default; an edit, null included, gives it a value; revert
cell makes it unset again
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

// row config flags by the names set_row_flag() takes.
let row_config_bits = {
	no_focus : ROW_NO_FOCUS,
	no_change: ROW_NO_CHANGE,
	no_remove: ROW_NO_REMOVE,
	no_save  : ROW_NO_SAVE,
}

//// GROUPING ---------------------------------------------------------------

let group_level_sep_re = /\s*>\s*/ // between group-by levels
let last_segment_re = /\/[^\/]+$/ // '/...' at the end of a ranged column
let range_unit_re = /\/(month|year)$/

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

//// COMMON HELPERS ----------------------------------------------------------

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

// index of ri in list[0..len).
function list_index(list, len, ri) {
	let i = list.subarray(0, len).indexOf(ri)
	assert(i >= 0, 'row not in the nav: ', ri)
	return i
}

// x is between a and b, inclusive, in either order.
function between(x, a, b) {
	return a <= b ? x >= a && x <= b : x >= b && x <= a
}

//// ROWSET SUPPORT ----------------------------------------------------------

let invalid_col_name_re = /^[0-9]|[^a-z0-9_]/

function is_col_name(col) {
	return isstr(col) && col.length > 0 && !invalid_col_name_re.test(col)
}

let rowset_listeners = {} // {rowset_name -> Set(fn(update_ids))}

// one connection for all navs: the server pushes 'NAME[:FILTER] UPDATE_ID...'
// when a rowset's rows change on the server.
let listen_rowset_events = memoize(function() {
	let es = new EventSource('/xrowset.events')
	es.onmessage = function(ev) {
		let update_ids = words(ev.data)
		let [rowset_name, filter] = update_ids.shift().split(':')
		// 'NAME:FILTER': for a filtered load; these navs load whole rowsets.
		if (filter != null)
			return
		for (let fn of rowset_listeners[rowset_name] ?? [])
			fn(update_ids)
	}
})

ui.nav2 = function(id, opt) {

	assert(id, 'nav id required')
	let e = assign({}, opt)
	e.id = id

	/// radix sort ------------------------------------------------------------

	// LSD radix sort of ris[0..n) with 16-bit digits, by sort_fields (each
	// {field:, desc:, [col:]}), last field first. stable: equal keys keep
	// their order in ris. ris is used as scratch. -> sorted ri's, ris or a new
	// array.
	function radix_sort(ris, n, sort_fields) {
		if (n < 2)
			return ris
		let ris1 = new Uint32Array(n) // scatter target for ris
		let keys  = [new Uint32Array(n), new Uint32Array(n)] // key words by ris
		let keys1 = [new Uint32Array(n), new Uint32Array(n)] // scatter targets
		let counts = new Uint32Array(65536) // rows per digit value
		for (let sfi = sort_fields.length - 1; sfi >= 0; sfi--) {

			// this field's keys. col: a column to sort by instead of the
			// field's, e.g. buckets.
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

			// one pass per 16-bit digit, least significant word and digit
			// first.
			for (let w = 0; w < word_n; w++) {
				for (let shift = 0; shift <= 16; shift += 16) {
					let k = keys[w]

					// count the rows per digit value.
					counts.fill(0)
					for (let i = 0; i < n; i++)
						counts[(k[i] >>> shift) & 0xFFFF]++
					// all rows have the same digit: the pass would move nothing.
					if (counts[(k[0] >>> shift) & 0xFFFF] == n)
						continue

					// counts -> each digit value's first index in the output.
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

					// the scatter targets become the inputs of the next pass.
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

		// changed rows, in base_ris order.
		for (let i = 0; i < n; i++)
			if (is_row_changed(e.base_ris[i]))
				ris[j++] = e.base_ris[i]

		// the other rows, in sort order.
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

	/// cell values, edits and validation -------------------------------------

	// value last seen on the server.
	function col_val(ri, fi) {
		return e.all_fields[fi].col_storage.get(e.col_vals[fi], ri)
	}

	// mask bit of cell (ri, fi).
	function cell_bit(mask, ri, fi) {
		return mask[ri * e.mask_word_n + (fi >>> 5)]
			& (1 << (fi & 31))
	}

	function set_cell_bit(mask, ri, fi, on) {
		set_bits(mask, ri * e.mask_word_n + (fi >>> 5),
			1 << (fi & 31), on)
	}

	function clear_row_mask(mask, ri) {
		let word_n = e.mask_word_n
		mask.fill(0, ri * word_n, (ri + 1) * word_n)
	}

	// the cell's value without its edit: undefined for an unset cell.
	function unedited_val(ri, fi) {
		return cell_bit(e.unset_mask, ri, fi) ? undefined : col_val(ri, fi)
	}

	// new, removed or edited.
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
	// value last seen on the server, or undefined for a new row's cell left
	// to the server default.
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

	// -> [result1, ...] with .failed, as the field's validator reports them,
	// or null when valid.
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

	// is_invalid: a cell of the row or the row itself failed validation.
	function update_invalid(ri) {
		let invalid = !!e.row_errors[ri]
		for (let fi = 0; !invalid && fi < e.all_fields.length; fi++)
			invalid = !!e.cell_errors[fi]?.[ri]
		set_bits(e.row_flags, ri, ROW_INVALID, invalid)
	}

	// -> true if the row and its cells are valid.
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

	// write v as the cell's edited value. v == server value: clear the edit.
	function set_input_val(ri, fi, v) {
		let field = e.all_fields[fi]
		let was_changed = is_row_changed(ri)
		// unset: only undefined is the unedited value; null is a value.
		if (cell_bit(e.unset_mask, ri, fi) ? v === undefined
			: same_val(field, v, col_val(ri, fi))
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

	// false: no caller may edit the cell, app code included.
	function is_cell_writable(ri, fi) {
		// group row: not a record.
		if (e.row_flags[ri] & ROW_GROUP)
			return false
		// pos: only moves write it. tree nav: parent_ri is built from the id
		// and parent_id cells.
		if (fi == e.pos_field?.fi
			|| e.can_be_tree && (fi == e.id_field.fi || fi == e.parent_field.fi)
		) {
			return false
		}
		// a row's key cells decide its group.
		return !(e.is_grouped && e.group_fis.has(fi))
	}

	// a parsed v is stored parsed; text that doesn't parse is stored as typed.
	// a cell set back to its server value stops counting as edited.
	// ev.input: a user edit, refused where can_change_val() is false.
	e.set_cell_val = function(ri, fi, v, ev) {
		if (!(ev?.input ? e.can_change_val(ri, fi) : is_cell_writable(ri, fi)))
			return

		// validate and parse; unchanged: nothing to do.
		let field = e.all_fields[fi]
		let errors = validate_cell(field, v)
		if (!field.validator.parse_failed)
			v = field.validator.value
		if (same_val(field, v, e.cell_val(ri, fi)))
			return

		// the edit and its errors; the row's own errors are stale now.
		set_input_val(ri, fi, v)
		set_cell_errors(ri, fi, errors)
		e.row_errors[ri] = undefined
		update_invalid(ri)

		// an edited row stays visible until the next filter.
		set_bits(e.row_flags, ri, ROW_PASS, true)
	}

	// -> true if the cell was a pos or parent_id cell, so the row's place
	// in base_ris or its parent_ri no longer matches its cells.
	function revert_cell_val(ri, fi) {
		set_input_val(ri, fi, unedited_val(ri, fi))
		set_cell_errors(ri, fi, null)
		return fi == e.pos_field?.fi || fi == e.parent_field?.fi
	}

	// -> true if the row's place changed, see revert_cell_val().
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

	// a new row is dropped; any other row gets its server values back.
	e.revert_row = function(ri) {
		if (e.row_flags[ri] & ROW_NEW) {
			drop_rows([ri])
			update_tree_and_visible_ris()
		} else if (revert_row_vals(ri)) {
			update_row_places([ri])
			update_tree_and_visible_ris()
		}
	}

	// new rows are dropped, removed rows unmarked, edited cells reverted.
	e.revert_changes = function() {
		let new_ris = [] // new rows, dropped in one pass at the end
		let moved_ris = [] // rows whose pos or parent_id was reverted

		// unmark and revert the saved rows; collect the new ones.
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

		// reverted moves back in place; new rows out.
		if (moved_ris.length)
			update_row_places(moved_ris)
		if (new_ris.length)
			drop_rows(new_ris)
		if (new_ris.length || moved_ris.length)
			update_tree_and_visible_ris()

		e.input_vals = [] // per fi: sparse Array of edited values by ri
		e.cell_errors = [] // per fi: sparse Array of failed results by ri
	}

	/// policy ----------------------------------------------------------------

	// policy options, checked only on UI-driven calls with ev.input.
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
		// can_change_rows: saved rows only.
		if (!(flags & ROW_NEW)
			&& !(e.can_change_rows && e.rowset_can_change_rows)
		) {
			return false
		}
		return is_cell_writable(ri, fi)
	}

	// the user may insert rows.
	e.can_actually_add_rows = function() {
		return e.can_add_rows && e.rowset_can_add_rows
	}

	// the user may remove rows.
	e.can_actually_remove_rows = function() {
		return e.can_remove_rows && e.rowset_can_remove_rows
	}

	// moving: unsorted, unfiltered, ungrouped, and in a tree nav only in tree
	// view. ris: siblings, each moving with its subtree. a same-parent move
	// needs pos_col; a parent change needs the can_change_parent option and a
	// writable parent_id. the new parent can't be a new row, a row marked for
	// deletion or a row of the moved subtrees.
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

		// same parent: move_rows() writes only pos, so a pos column is needed.
		// new parent: it writes parent_id, which must be writable, and the new
		// parent can't be marked for deletion.
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

	/// slots and inserting ---------------------------------------------------

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
		e.unset_mask       = grow_typed(e.unset_mask      , cap * word_n)
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
			e.parent_ri[ri] = NONE
		}
		return ri
	}

	function free_slot(ri) {
		// row in flight: apply_result() must skip it, as alloc_slot() can give
		// the slot to a new row.
		let batch_i = saving_ris.get(ri) // index in save_batch.ris
		if (batch_i != null) {
			save_batch.ris[batch_i] = NONE
			saving_ris.delete(ri)
		}

		// take the row out of changed_n, and reset its entries for the next
		// row given this slot.
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
		e.free_ris.push(ri)
	}

	// rows: [[v1, ...] | null, ...] in fi order; undefined or a null row: the
	// field's client_default.
	// at_ri: insert before this row; null: at the end. -> the new rows' ri's.
	// unsorted: the rows go into base_ris at that place. sorted: they go into
	// sorted_ris at that place and at the end of base_ris. tree navs: the rows
	// become siblings of at_ri. grouped: the rows join at_ri's group and get
	// its key cells; at_ri must be a data row. refused under a new row (it has
	// no id yet); ev.input: also under a row marked for deletion, and while
	// can_actually_add_rows() is false: -> no ri's.
	e.insert_rows = function(rows, at_ri, ev) {
		let none = new Uint32Array(0) // refused: no rows
		if (ev?.input && !e.can_actually_add_rows())
			return none

		// the new rows' parent is at_ri's parent, or none at the end. grouped:
		// that parent is a group, so look up the tree parent by the id in
		// at_ri's parent_id cell.
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

		// a parent with any of these takes no new rows.
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
				// no value and no default: the server fills the cell in.
				if (v === undefined)
					set_cell_bit(e.unset_mask, ri, field.fi, true)
				field.col_storage.set(e.col_vals[field.fi], ri, v ?? null)
			}
			e.row_flags[ri] = ROW_NEW | ROW_PASS
			e.parent_ri[ri] = parent_ri

			// tree nav: the server and set_tree_parents() read the row's
			// parent from its parent_id cell.
			if (e.can_be_tree) {
				let parent_field = e.parent_field
				parent_field.col_storage.set(e.col_vals[parent_field.fi], ri,
					parent_id)
				set_cell_bit(e.unset_mask, ri, parent_field.fi, false)
			}

			// a raw key value copied from a row of the group stays in the
			// group's bucket.
			if (e.is_grouped)
				for (let fi of e.group_fis) {
					let field = e.all_fields[fi]
					field.col_storage.set(e.col_vals[fi], ri, col_val(at_ri, fi))
					set_cell_bit(e.unset_mask, ri, fi, false)
				}
		}

		// unsorted: insert the rows before at_ri in the stored order. sorted:
		// insert them before at_ri in the sort order, and append them to the
		// stored order.
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

	/// positions -------------------------------------------------------------

	// write v into cell (ri, fi) without set_cell_val()'s refusals and
	// validation, for the pos and parent_id cells that moves write. a new
	// row's cells are its columns; a saved row's are edits.
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

		// spread k values evenly between them; with one neighbor, step by 1
		// away from it; with none, use 1..k.
		let vals = [] // the new pos values, in order
		for (let j = 1; j <= k; j++)
			vals.push(pos1 != null && pos2 != null
				? pos1 + (pos2 - pos1) * j / (k + 1)
				: pos1 != null ? pos1 + j
				: pos2 != null ? pos2 - (k + 1 - j)
				: j)

		// check the order: two neighbors very close together may have no
		// distinct doubles left between them.
		let fits = (pos1 == null || vals[0] > pos1)
			&& (pos2 == null || vals[k - 1] < pos2)
		for (let j = 1; fits && j < k; j++)
			fits = vals[j] > vals[j - 1]

		// write the values, or renumber the whole list 1..m when they don't
		// fit.
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

	// put rows back in place after their pos or parent_id cell changed:
	// parent_ri from the parent_id value through the id index, and base_ris
	// sorted by pos again, which puts every pos list in pos order. the sort
	// reads edited pos values too: only moves write them, always numbers.
	function update_row_places(ris) {
		// set each row's parent by the id in its parent_id cell, edit included.
		if (e.can_be_tree) {
			let parent_fi = e.parent_field.fi
			for (let ri of ris) {
				let parent_id = e.cell_val(ri, parent_fi)
				e.parent_ri[ri] = parent_id != null
					? e.lookup(e.id_field.name, [parent_id]) ?? NONE : NONE
			}
		}

		// pos order: sort the stored order by pos. radix_sort() reads columns
		// only, so pass it a copy of the pos column with the edits written in.
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
		e.base_ris = radix_sort(e.base_ris, e.row_n,
			[{field: field, desc: false, col: col}])
		if (was_unsorted)
			e.sorted_ris = e.base_ris
	}

	/// moving ----------------------------------------------------------------

	// false: no caller may move ris under parent_ri. not while sorted:
	// move_rows() sets sorted_ris to base_ris. a parent change needs a tree
	// nav, and the new parent can't be a new row (no id yet) or a row of the
	// moved subtrees.
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

	// put ris before at_ri under parent_ri (NONE: the roots); at_ri null: at
	// the end of parent_ri's children. moved rows get pos values between
	// their new neighbors. -> false if refused, see is_move_valid(), and
	// with ev.input can_actually_move_rows().
	e.move_rows = function(ris, at_ri, parent_ri, ev) {
		let can_move = ev?.input
			? e.can_actually_move_rows(ris, parent_ri)
			: is_move_valid(ris, parent_ri)
		if (!can_move)
			return false

		// take the rows out of the stored order.
		let k = ris.length
		let is_moved = new Uint8Array(e.cap) // 1: row being moved
		for (let ri of ris)
			is_moved[ri] = 1
		let n = compact_list(e.base_ris, e.row_n, is_moved)

		// put them back before at_ri.
		// descendants stay where they are: stage 3 puts them under the rows.
		let i = at_ri == null ? n : list_index(e.base_ris, n, at_ri)
		e.base_ris = insert_into_list(e.base_ris, n, i,
			Uint32Array.from(ris), k)
		e.sorted_ris = e.base_ris

		// rows moved to another parent: record the new parent in parent_ri
		// and in the parent_id cell.
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

	/// deleting rows ---------------------------------------------------------

	// rows out of every list and index for good; their slots go to free_ris.
	function drop_rows(ris) {
		commit_rect()

		// take the rows out of the row orders and the indexes.
		let is_dropped = new Uint8Array(e.cap) // 1: row being dropped
		for (let ri of ris)
			is_dropped[ri] = 1
		let row_n = compact_list(e.base_ris, e.row_n, is_dropped)
		if (e.sorted_ris != e.base_ris)
			compact_list(e.sorted_ris, e.row_n, is_dropped)
		e.row_n = row_n
		for (let index of e.indexes.values())
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

	// mark the row for deletion; a new row goes to new_ris, to be dropped.
	// a group row is not a real row: it is never marked. -> false if is_input
	// and the row has no_remove.
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

	// mark ri's subtree. is_input: a row with no_remove stays, and so do its
	// ancestors: walking the subtree backwards visits a row's descendants
	// before the row. is_kept: 1 for a row with a kept descendant.
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

	// unmark ri, its marked ancestors and its marked descendants, but not the
	// descendants under a row that isn't marked. group rows are not real rows:
	// the walk passes through them.
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

	// op: 'delete' (default): mark the rows for deletion, and in tree view or
	// grouped their subtrees; new rows are dropped. 'undelete': clear the
	// marks. ev.input: 'delete' is refused while can_actually_remove_rows()
	// is false, and rows with no_remove are left alone.
	e.remove_rows = function(ris, op, ev) {
		let has_parents = e.is_tree || e.is_grouped
		if (op == 'undelete') {
			for (let ri of ris)
				if (has_parents)
					unmark_subtree_removed(ri)
				else
					unmark_removed(ri)
		} else if (!ev?.input || e.can_actually_remove_rows()) {
			let new_ris = [] // new rows to drop
			if (has_parents) {
				let is_kept = new Uint8Array(e.cap) // see mark_subtree_removed()
				for (let ri of ris)
					mark_subtree_removed(ri, new_ris, is_kept, ev?.input)
			} else {
				for (let ri of ris)
					mark_removed(ri, new_ris, ev?.input)
			}

			// new rows have nothing to delete on the server: drop them now.
			if (new_ris.length) {
				drop_rows(new_ris)
				update_tree_and_visible_ris()
			}
		}
	}

	/// saving ----------------------------------------------------------------

	let save_req = null // request in flight, for ids or a save; null: none
	let save_batch = null // the batch in flight: {rows: [...], ris: [...]}
	let saving_ris = map() // {ri -> index in save_batch.ris} of its rows
	let want_save = false // save() called while a request was in flight
	let want_reload = false // reload() held while a request was in flight
	let own_update_ids = new Set() // update_id of each save, to skip its push

	function rowset_url() {
		return href('/rowset.json/' + e.rowset_name)
	}

	// the pk as last seen on the server, which finds the row there.
	function add_old_pk(values, ri) {
		for (let field of e.pk_fields)
			values[field.name + ':old'] = col_val(ri, field.fi)
	}

	// a changed row in rowset.lua's save format; null: nothing to send.
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
				// unset: left out, so the server default applies.
				if (!field.nosave && v !== undefined)
					values[field.name] = v
			}
			return {type: 'new', values: values}
		}

		// saved row: send its edited cells, and the old pk to find it.
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

	// -> {rows: [...], ris: [...]}: the changed rows in rowset.lua's save
	// format, or null if no row is ready. walking tree_ris backwards sends
	// children before their parents. the rows stay in flight until
	// apply_result() or end_save(); no_save rows, invalid rows and rows in
	// flight are skipped. one batch at a time.
	e.pack_changes = function() {
		assert(!save_batch)
		let batch = {rows: [], ris: []}
		for (let i = e.tree_n - 1; i >= 0; i--) {
			let ri = e.tree_ris[i]
			let flags = e.row_flags[ri]
			if (flags & (ROW_GROUP | ROW_NO_SAVE) || !is_row_changed(ri))
				continue
			// a row marked for deletion goes out as it is.
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

	// the batch in flight is over: its rows that apply_result() didn't take
	// stay changed, for the next save.
	function end_save() {
		save_batch = null
		saving_ris.clear()
	}

	// the values that packed row t sent, by fi; undefined: not sent.
	function sent_vals(t) {
		let vals = []
		for (let col in t.values) {
			// 'col:old' names no field.
			let field = e.all_fields_map[col]
			if (field)
				vals[field.fi] = t.values[col]
		}
		return vals
	}

	// write the server's values into a row's columns: vals[fi]; undefined:
	// unchanged. the row becomes a saved row; an edit stays only where it
	// still differs from the new value. sets is_changed_col[fi] for each
	// column written. -> true if the row's pos or parent_id changed.
	function set_server_vals(ri, vals, is_changed_col) {
		// the row is saved now: not new, and no cell left unset.
		let was_changed = is_row_changed(ri)
		set_bits(e.row_flags, ri, ROW_NEW, false)
		clear_row_mask(e.unset_mask, ri)
		update_changed_n(ri, was_changed)

		// write the sent values into the columns, and clear each edit that
		// now equals its server value.
		let is_moved = false
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			let v = vals[fi]
			if (v === undefined)
				continue
			let field = e.all_fields[fi]
			if (!same_val(field, v, col_val(ri, fi))) {
				field.col_storage.set(e.col_vals[fi], ri, v)
				is_changed_col[fi] = 1
				update_server_cell(ri, fi)
				if (fi == e.pos_field?.fi || fi == e.parent_field?.fi)
					is_moved = true
			} else {
				// a new row's edit of an unset cell can equal the column.
				clear_edit_if_same(ri, fi)
			}
		}
		return is_moved
	}

	// an edit equal to the cell's server value stops counting.
	function clear_edit_if_same(ri, fi) {
		if (cell_bit(e.changed_mask, ri, fi)
			&& same_val(e.all_fields[fi], e.input_vals[fi][ri], col_val(ri, fi))
		) {
			let was_changed = is_row_changed(ri)
			set_cell_bit(e.changed_mask, ri, fi, false)
			e.input_vals[fi][ri] = undefined
			update_changed_n(ri, was_changed)
		}
	}

	// the server's value just replaced cell (ri, fi)'s column value.
	function update_server_cell(ri, fi) {
		// an edited cell shows its edit, not the column.
		if (!cell_bit(e.changed_mask, ri, fi))
			end_quicksearch_at(ri, fi)
		clear_edit_if_same(ri, fi)
	}

	function invalidate_changed_cols(is_changed_col) {
		for (let fi = 0; fi < is_changed_col.length; fi++)
			if (is_changed_col[fi])
				invalidate_indexes(e.all_fields[fi])
	}

	// rowset.lua's errors for a row: rt.error (a message, or true when only
	// fields failed) and rt.field_errors {col -> message}. the row stays
	// changed, for the user to fix.
	function set_server_errors(ri, rt) {
		let errors // failed results, as validate_cell() reports them
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

	// result: rowset.lua's answer to the batch, one entry per sent row.
	e.apply_result = function(batch, result) {
		let drop_ris = [] // rows the server removed
		let moved_ris = [] // rows whose pos or parent_id changed
		let is_changed_col = new Uint8Array(e.all_fields.length) // by fi

		// each sent row, by the server's answer: removed, rejected with
		// errors, or saved.
		for (let k = 0; k < batch.ris.length; k++) {
			let ri = batch.ris[k]
			// dropped while in flight.
			if (ri == NONE)
				continue
			let rt = result.rows[k]
			if (rt.remove) {
				drop_ris.push(ri)
			} else if (rt.error || rt.field_errors) {
				set_server_errors(ri, rt)
			} else {
				// no rt.values: the server can't load rows back.
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

		// no changed rows left: drop the edit and error arrays.
		if (!e.changed_n) {
			e.input_vals = [] // per fi: sparse Array of edited values by ri
			e.cell_errors = [] // per fi: sparse Array of failed results by ri
		}
	}

	// new rows to send without an id get ids from the server first, so that
	// a resent insert carries the same id. -> true if a request went out;
	// when it ends, the save starts over.
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
				// rowset.lua's limit per request: the rest go in the next one.
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
					// dropped meanwhile: its slot may hold another new row.
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

	// a request ended, with success or not. a failed batch's rows stay
	// changed; then the reload and the save held meanwhile go out.
	function end_request() {
		// voided by load() or free().
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

	// send the changed rows to the rowset they were loaded from. one request
	// at a time: a save() during one runs after it.
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

		// tag the save, so that rowset_changed() can skip the server's push
		// about it.
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

	// the rowset has the same columns and keys as the loaded one.
	function is_same_rowset(rs) {
		if (!isobj(rs) || !isarray(rs.fields))
			return false
		if (rs.fields.length != e.all_fields.length)
			return false
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let rs_field = rs.fields[fi]
			if (!isobj(rs_field))
				return false
			// a field made without a type gets all_field_types' type.
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
				if (!is_col_name(col))
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

	// order of row ri's pk vs incoming row in_i's: -1|0|1
	function compare_pk(ri, in_col_vals, in_i) {
		for (let field of e.pk_fields) {
			let storage = field.col_storage
			let r = storage.compare_cell(e.col_vals[field.fi], ri,
				storage.get(in_col_vals[field.fi], in_i), field)
			if (r)
				return r
		}
		return 0
	}

	// rs: the rowset loaded again. other columns or keys: load(rs). else a
	// row matched by pk gets the server's values, with its edits kept where
	// they still differ; a new row matched by its reserved id stays new.
	// rows the server has anew are added; rows it no longer has
	// are dropped, unless new. the incoming rows, sorted by pk, are walked
	// along the pk index.
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
		in_is = radix_sort(in_is, m, e.pk_fields.map(field =>
			({field: field, desc: false, col: in_col_vals[field.fi]})))

		// walk the nav's rows and the incoming rows side by side, both in pk
		// order. a row only in the nav is dropped, unless new; a row only on
		// the server is added; a row in both is matched.
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
				// a new row matched by its reserved id: a save inserted it, but
				// its response was lost. it stays new: the next save sends it
				// again, and the server skips the insert.
				if (!(e.row_flags[ri] & ROW_NEW)) {
					match_ris[match_n] = ri
					match_is[match_n++] = in_is[j]
				}
				pk_i++
				j++
			}
		}

		// the matched saved rows a column at a time: the storage copies the
		// cells that differ, and only those get more work.
		let changed_ks = new Uint32Array(match_n) // indexes in match_ris
		for (let field of fields) {
			let fi = field.fi
			let changed_cell_n = field.col_storage.copy_changed(e.col_vals[fi],
				match_ris, in_col_vals[fi], match_is, match_n, field, changed_ks)
			if (changed_cell_n)
				is_changed_col[fi] = 1
			for (let c = 0; c < changed_cell_n; c++)
				update_server_cell(match_ris[changed_ks[c]], fi)
		}

		// remove the groups (rebuilt below) and the rows that the server no
		// longer has. unfocus and deselect them before alloc_slot() reuses
		// their slots.
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

		// filter again the rows that aren't changed; changed rows stay shown.
		if (e.filter)
			for (let i = 0; i < e.row_n; i++) {
				let ri = e.base_ris[i]
				if (!is_row_changed(ri))
					set_bits(e.row_flags, ri, ROW_PASS, e.filter(ri))
			}

		// tree parents, pos order and the sort, each only if its input changed.
		let has_added_or_dropped = k > 0 || drop_ris.length > 0
		let edited_parent_ris = [] // rows whose pending move sets their parent
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
		// parent_ri of the rows with an edited parent_id, and pos order.
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

	let load_req = null // load request in flight, or null

	// load the rowset from the server: the first time with load(), then with
	// diff_merge(). held while a save is in flight, as the server's rows may
	// or may not hold that save yet.
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

	// a push for this rowset: our own saves bring nothing new.
	function rowset_changed(update_ids) {
		let is_own = true
		for (let update_id of update_ids)
			if (!own_update_ids.delete(update_id))
				is_own = false
		if (!is_own)
			e.reload()
	}

	// stop the pushes and the requests: their answers are ignored.
	e.free = function() {
		rowset_listeners[e.rowset_name]?.delete(rowset_changed)
		load_req?.abort()
		load_req = null
		save_req = null
	}

	/// focus and selection ---------------------------------------------------

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

		// the fi bits of the rectangle's columns.
		let word_n = e.mask_word_n
		let col_mask = new Uint32Array(word_n) // fi bits of the columns
		for (let col_i = col_i1; col_i <= col_i2; col_i++) {
			let fi = e.fields[col_i].fi
			col_mask[fi >>> 5] |= 1 << (fi & 31)
		}

		// add those bits to each row of the rectangle.
		let sel_mask = e.sel_mask
		for (let i = row_i1; i <= row_i2; i++) {
			let word_i = e.visible_ris[i] * word_n // first word of the row
			for (let w = 0; w < word_n; w++)
				sel_mask[word_i + w] |= col_mask[w]
		}

		// sel_mask has the cells now: clear the rectangle.
		e.has_sel_bits = true
		set_rect(null, null, null, null)
	}

	// select: null: select only the focused cell. 'expand': select from the
	// rectangle's anchor (or the focused cell) to (ri, fi). 'invert': toggle
	// (ri, fi), keep the rest. 'all': focus the first cell, select all.
	e.focus_cell = function(ri, fi, select) {
		// a hidden row can't be focused.
		if (ri != null && e.visible_i[ri] == NONE)
			ri = null

		// change the selection according to select.
		if (select == 'deselect_hidden') {
			if (e.has_sel_bits) {
				// hidden rows can't stay selected. only rows that were visible
				// can have bits, so walking the previous list finds all of them.
				let prev_ris = e.visible_ris
				for (let i = 0; i < e.visible_n; i++) {
					let ri = prev_ris[i]
					if (e.visible_i[ri] == NONE)
						clear_row_mask(e.sel_mask, ri)
				}
			}
		} else if (select == 'all') {
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

		// another cell focused: end the quicksearch.
		if (ri != e.focused_ri || fi != e.focused_fi)
			e.quicksearch_text = ''
		e.focused_ri = ri
		e.focused_fi = fi
	}

	e.is_cell_selected = function(ri, fi) {
		if (cell_bit(e.sel_mask, ri, fi))
			return true

		// not in sel_mask: check the rectangle, by visible row and column
		// position.
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

	// null into each selected cell through set_cell_val(), which refuses the
	// cells that an edit can't change.
	e.set_null_selected_cells = function(ev) {
		let word_n = e.mask_word_n
		let sel_mask = e.sel_mask
		e.each_selected_row(ri => {
			for (let w = 0; w < word_n; w++) {
				let bits = sel_mask[ri * word_n + w] // selected cells of the word
				// lowest set bit first: its fi, then clear it.
				while (bits) {
					let fi = w * 32 + 31 - Math.clz32(bits & -bits)
					e.set_cell_val(ri, fi, null, ev)
					bits &= bits - 1
				}
			}
		})
	}

	/// quicksearch -----------------------------------------------------------

	// the focused cell written: its text may no longer start with the typed
	// text.
	function end_quicksearch_at(ri, fi) {
		if (ri == e.focused_ri && fi == e.focused_fi)
			e.quicksearch_text = ''
	}

	// s: the typed text; '': end the quicksearch. fi: the column to search.
	// offset: 0 (default): walk forward from the focused row; 1: from the
	// next row; -1: backward from the previous row. no focused row: as if
	// the first row were focused. the walk wraps around. match: a row
	// without no_focus whose cell text starts with s, case ignored.
	// -> ri of the row focused, or null if no row matched.
	e.quicksearch = function(s, fi, offset) {
		if (!s) {
			e.quicksearch_text = ''
			return null
		}
		let field = e.all_fields[fi]
		let s_lower = s.toLowerCase()
		let n = e.visible_n
		let dir = offset < 0 ? -1 : 1 // walk direction
		// i is n higher so that it stays >= 0 walking backward; rows: i % n.
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

	/// indexes ---------------------------------------------------------------

	// 'col1 col2 ...' -> [field1, ...]
	function col_fields(cols) {
		return words(cols).map(col =>
			assert(e.all_fields_map[col], 'unknown column: ', col))
	}

	function invalidate_indexes(field) {
		for (let cols of e.indexes.keys())
			if (e.indexes.get(cols).fields.includes(field))
				e.indexes.delete(cols)
	}

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
		if (!ris.length)
			return
		for (let index of e.indexes.values()) {
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

				// strip the range segments from the end: freq, then unit, then
				// offset.
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

	// sort the data rows by the level keys, then open a group at each level
	// where a key differs from the previous row's. a group gets a slot with
	// its levels' key cells (a bucket's first value for a ranged column) and
	// null in the other cells.
	function add_groups(levels) {
		let n = e.row_n
		let base_ris = e.base_ris

		// the sort keys of every level. for a ranged column, the key is its
		// bucket, written into a separate column.
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

		// sort the data rows by the keys and walk them. at the first level
		// where a row's keys differ from the previous row's, open a new group
		// at that level and at each level below it.
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

				// the group row's cells: null, except the keys of its level
				// and the levels above it, from the group's first row.
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
		e.group_fis = new Set(key_fields.map(kf => kf.field.fi))
		e.is_grouped = true
	}

	// group slots to free_ris.
	function remove_groups() {
		commit_rect()
		for (let ri of e.group_ris)
			free_slot(ri)
		e.group_ris = new Uint32Array(0)
		e.group_fis = new Set()
		e.is_grouped = false
	}

	// free the groups left without rows. group_ris lists a group before its
	// subgroups, so walking it backwards counts a group's subgroups first.
	function drop_empty_groups() {
		// count the data rows directly under each group.
		let child_n = new Uint32Array(e.cap) // kept children by group
		for (let i = 0; i < e.row_n; i++)
			child_n[e.parent_ri[e.base_ris[i]]]++

		// free the empty groups, and count each kept group as a child of its
		// parent group.
		let is_dropped = new Uint8Array(e.cap) // 1: group being dropped
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

	// some row has an edited cell in one of the levels' columns. a column
	// without input_vals has had no edit since the last full save.
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

	// group_by: see parse_group_by(); null: ungroup. refused in tree view, and
	// while a row has an edited cell in a key column: grouping reads the
	// columns, so it would put such a row under its old value's group.
	// -> true if applied.
	e.set_group_by = function(group_by) {
		let levels = group_by ? parse_group_by(group_by) : []
		if (levels.length && (e.is_tree || e.can_be_tree && e.changed_n
			|| has_edited_keys(levels)))
			return false

		// remove the current groups. regrouping: unfocus and deselect the old
		// group rows before add_groups() reuses their slots. ungrouping: put
		// the rows back under their tree parents, or under no parent.
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

		// build each row's child list, in sort order.
		let parent_ri = e.parent_ri
		let first_child_ri = e.first_child_ri
		let next_sibling_ri = e.next_sibling_ri
		let first_root_ri = NONE
		let ris_lists = [e.sorted_ris.subarray(0, n), e.group_ris]
		// a group's children are all data rows or all groups, so pushing the
		// two lists one after the other never mixes them in one child list.
		for (let ris of ris_lists)
			for (let i = 0; i < ris.length; i++)
				first_child_ri[ris[i]] = NONE
		for (let ris of ris_lists) {
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

		// list the rows depth-first, each parent before its children, and
		// record each row's position and depth.
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

		// add up desc_count: walking backwards visits each row's descendants
		// before the row.
		for (let i = tree_n - 1; i >= 0; i--) {
			let ri = tree_ris[i]
			let p = parent_ri[ri]
			if (p != NONE)
				desc_count[p] += desc_count[ri] + 1
		}
		e.tree_ris = tree_ris
		e.tree_n = tree_n

		// rows that the depth-first walk didn't reach are in a cycle.
		if (e.is_tree && tree_n < n) {
			warn(e.id, 'circular parent refs: showing the rows flat')
			e.can_be_tree = false
			e.parent_ri.fill(NONE)
			update_is_tree()
			update_tree_ris()
		}
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

		// list the rows shown, into the other buffer. a row with no passing
		// row in its subtree is skipped with its descendants; a collapsed row
		// is listed without its descendants.
		let ris = e.prev_visible_ris
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

		// unfocus a hidden row; deselect the hidden rows, or with reset_sel
		// select only the focused cell.
		e.focus_cell(e.focused_ri, e.focused_fi,
			reset_sel ? null : 'deselect_hidden')

		// show the new list; keep the old buffer for the next run.
		e.prev_visible_ris = e.visible_ris
		e.prev_visible_n = e.visible_n
		e.visible_ris = ris
		e.visible_n = n
	}

	/// loading ---------------------------------------------------------------

	function load_col_field(col, all_fields_map) {
		let field = is_col_name(col) && all_fields_map[col]
		if (warn_if(!field, e.id, 'unknown column:', col))
			return null
		return field
	}

	// rows: [[v1, ...], ...] -> [[col1_v1, ...], ...], col_n columns.
	function rows_to_cols(rows, col_n) {
		if (warn_if(!isarray(rows), e.id, 'rows must be an array'))
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

	// the server can send values in row-major or col-major arrays.
	function rowset_col_vals(rs, col_n) {
		if (rs.col_vals == null)
			return rows_to_cols(rs.rows, col_n)
		if (warn_if(!isarray(rs.col_vals) || rs.col_vals.length != col_n,
			e.id, 'invalid col_vals'))
			return null
		for (let fi = 0; fi < col_n; fi++) {
			let col = cols[fi]
			if (warn_if(!isarray(col), e.id, 'invalid col_vals:', fi))
				return null
		}
		return cols
	}

	// rs: {fields: [field1, ...], col_vals: [col1_vals, ...] | rows: [row1,
	// ...]}. once load() accepts rs, requests in flight are voided: their
	// rows are gone.
	e.load = function(rs) {
		if (warn_if(!isarray(rs.fields), e.id, 'fields array required'))
			return
		if (warn_if(!rs.fields.length, e.id, 'no fields'))
			return

		// make one field per column. stop if there are none, on an invalid or
		// duplicate name, or on a field that ui.create_field() refuses.
		let all_fields = [] // [field1, ...] by fi
		let all_fields_map = obj() // {col->field}
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let field_opt = rs.fields[fi]
			let name = field_opt?.name
			if (warn_if(!(is_col_name(name) && !all_fields_map[name]),
				e.id, 'invalid or duplicate field name:', name))
				return
			let field = ui.create_field(field_opt, e.id)
			if (!field)
				return
			field.fi = fi // column index
			all_fields.push(field)
			all_fields_map[field.name] = field
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
			if (warn_if(!is_col_name(col), e.id,
				'invalid pk column:', col))
				return
			let field = all_fields_map[col]
			if (warn_if(!field, e.id, 'unknown column:', col))
				return
			pk_fields.push(field)
		}
		let pos_field = rs.pos_col == null
			? null : load_col_field(rs.pos_col, all_fields_map)
		let id_field = rs.id_col == null
			? pk_fields.length == 1 ? pk_fields[0] : null
			: load_col_field(rs.id_col, all_fields_map)
		let parent_field = rs.parent_col == null
			? null : load_col_field(rs.parent_col, all_fields_map)
		if (rs.pos_col != null && !pos_field
			|| rs.id_col != null && !id_field
			|| rs.parent_col != null && !parent_field)
			return

		let col_vals = rowset_col_vals(rs, all_fields.length)
		if (!col_vals)
			return
		let n = col_vals[0].length // row count
		let e_col_vals = all_fields.map(field =>
			field.col_storage.load_col(col_vals[field.fi], n))

		// rs is accepted: void the save in flight and any held save or reload.
		save_req = null
		end_save()
		want_save = false
		want_reload = false
		e.all_fields = all_fields
		e.all_fields_map = all_fields_map

		e.row_n = n // data row count
		e.col_vals = e_col_vals // column values by fi, then ri

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
		e.pos_field = pos_field
		// stored order on pos_col navs is pos order.
		if (e.pos_field)
			e.base_ris = radix_sort(e.base_ris, n,
				[{field: e.pos_field, desc: false}])

		// unsorted: one array holds both orders.
		e.order_by = null // sort columns, sort function, or null
		e.sorted_ris = e.base_ris // data rows' ri's in sort order

		e.indexes = map() // {cols -> {fields:, ris:}}, built on first lookup
		e.pk = pk // 'col1 ...'
		e.pk_fields = pk_fields // [field1, ...]

		// the rowset's policy, checked only on the user's calls (ev.input).
		e.rowset_can_add_rows    = rs.can_add_rows    != false // user inserts
		e.rowset_can_remove_rows = rs.can_remove_rows != false // user removals
		e.rowset_can_change_rows = rs.can_change_rows != false // user edits
		e.rowset_can_move_rows   = rs.can_move_rows   != false // user moves
		e.reserves_ids = !!rs.reserves_ids // new rows get ids before saving

		e.fields = e.all_fields.slice() // visible columns, in display order
		for (let i = 0; i < e.fields.length; i++)
			e.fields[i].index = i // position in fields
		e.mask_word_n = (e.all_fields.length + 31) >>> 5 // W: words per row
		e.sel_mask = new Uint32Array(n * e.mask_word_n) // selected cells' bits
		e.has_sel_bits = false // false: sel_mask is all zero
		e.focused_ri = null // focused row, or null
		e.focused_fi = null // focused column
		e.quicksearch_text = '' // typed prefix of the focused cell's text
		set_rect(null, null, null, null) // no selection rectangle

		e.changed_mask = new Uint32Array(n * e.mask_word_n) // edited cells
		e.unset_mask = new Uint32Array(n * e.mask_word_n) // server default
		e.changed_n = 0 // number of changed rows
		e.input_vals = [] // per fi: sparse Array of edited values by ri
		e.cell_errors = [] // per fi: sparse Array of failed results by ri
		e.row_errors = [] // sparse: failed row results by ri

		e.cap = n // capacity of every ri-indexed array
		e.slot_n = n // slots ever used, free ones included
		e.free_ris = [] // freed slots, used as a stack

		e.id_field = id_field
		e.parent_field = parent_field
		e.can_be_tree = !!(e.id_field && e.parent_field)
		e.flat ??= false // flat view of a tree nav
		e.group_by = null // group-by spec, or null
		e.is_grouped = false
		e.group_ris = new Uint32Array(0) // group synthetic rows in key order
		e.group_fis = new Set() // the group-by key columns' fi's
		update_is_tree()
		if (e.can_be_tree)
			set_tree_parents()
		update_tree_and_visible_ris()
	}

	// with a rowset_name: load from the server, and reload on its pushes.
	if (e.rowset_name) {
		listen_rowset_events()
		rowset_listeners[e.rowset_name] ??= new Set()
		rowset_listeners[e.rowset_name].add(rowset_changed)
		e.reload()
	}

	return e
}

}())
