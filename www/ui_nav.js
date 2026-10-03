/*

	UI nav objects.
	Written by Cosmin Apreutesei. Public Domain.

A nav is an in-memory table with typed columns and rows populated from a rowset.
Once set up, rows can be sorted, filtered, grouped or form a tree, cells can
be selected, values can be looked up, etc. A nav is the data model for the grid
widget.

A rowset is a POD used to populate a nav. It contains field definitions and
rows of values. It can come from a http server as JSON, or constructed in JS.

Rowset structure:

{
	fields : [{name:, FIELD_ATTR: VAL}, ...],  // array of field definitions.
	rows   : [[v1, v2, ...], ...],             // array of rows, values in field order.
	ROWSET_ATTR: VAL,                          // rowset attributes, see below.
}

Creating a nav:

	ui.nav(id, {rowset_name: NAME}) -> e

		Loads ui.rowsets[NAME], or the rowset from the server at
		/rowset.json/NAME.

Updating after changing nav props or field attrs:

	e.update_parts(parts)

Rowset attributes:

	fields     : [field1,...]
	rows       : [row1,...]
	pk         : 'col1 ...'    : primary key for making changesets.
	id_col     : 'col'         : id column for tree-forming along with parent_col.
	parent_col : 'col'         : parent colum for tree-forming.
	pos_col    : 'col'         : position column for manual reordering of rows.
	can_add_rows
	can_remove_rows
	can_change_rows

Sources of field attributes, in precedence order:

	SCOPE         METHOD
	------------- -------------------------------------------------------------
	nav           e.col_attrs = {COL: {ATTR: VAL}}
	rowset        ui.rowset_col_attrs['ROWSET.COL'] = {ATTR: VAL}
	rowset        ui.rowsets[NAME].fields = [{ATTR: VAL},...]
	field type    ui.field_types[TYPE] = {ATTR: VAL}
	global        ui.all_field_types[ATTR] = VAL

Nav field attributes:

	identification:

		name           : field name (defaults to field's numeric index)

	rendering:

		label          : field name for display purposes (auto-generated default).
		internal       : field cannot be made visible in a grid (false).
		hidden         : field is hidden by default but can be made visible (false).
		w              : field's width.
		min_w          : field's minimum width, in em.
		max_w          : field's maximum width, in em.

	navigation:

		focusable      : field can be focused (true).

	editing:

		client_default : default value/generator that new rows are initialized with.
		has_server_default: the server fills this in, so it can be left empty.
		build_editor   : f(id, v, pad_l, pad_r, h, align) -> v   build the
		                 widgets that edit v and give back what the user made
		                 of it. pad_l, pad_r, h: the box the cell drew v in.
		                 the cell has no vertical padding: it centers v in
		                 its height instead. an editor with a picker ends the
		                 edit by closing it.
		edits_in_popup : build_editor builds a popup: no editor in the cell.

	formatting:

		build          : f(v, mode, [fg], [row]) -> true   build the value.

		build_text    : f(s, [mode], [fg], [row]) -> true|s    build or return text.
		build_null    : f([mode], [fg], [row]) -> true|s       build or return text.

		button_options : button type: options to pass to button()

	vlookup:

		lookup_rowset_name: rowset to look up values of this field into.
		lookup_cols    : field(s) in lookup_nav to look up values of local_cols into.
		local_cols     : field(s) in this nav to get values from to lookup in lookup_nav.
		display_col    : field in lookup_nav to use as display value of this field.
		null_lookup_col: field in nav to use as default value for nulls in this field.

	sorting:

		sortable       : allow sorting (true).
		compare_types  : f(v1, v2) -> -1|0|1  (for sorting)
		compare_vals   : f(v1, v2) -> -1|0|1  (for sorting and setting values)

	moving:

		movable        : field position can be changed (true)

	grouping:

		groupable      : field can be used in group-by (true)

NAV API ----------------------------------------------------------------------

Cell state:
	row[i]             : cell value as last seen on the server (always valid).
	row[input_val_i]   : modified cell value, valid or not.
	row[errors_i]      : [err1,...]; validation results.
	row[#all_fields]   : row index.

Row config:
	row.focusable      : row can be focused (true).
	row.can_change     : allow changing (true).
	row.can_remove     : allow removing (true).
	row.nosave         : row is not to be saved.

Row state:
	row.is_new         : new row, not added on server yet.
	row.modified       : one or more row cells were modified (valid or not).
	row.removed        : row is marked for removal, not removed on server yet.
	row.errors         : [err1,...] row-level validation results. undefined if not validated yet.
	row.invalid        : row has cell and/or row errors.

Fields:
	publishes:
		e.all_fields_map[col] -> field
		e.all_fields[fi] -> field

Visible fields:
	publishes:
		e.fields[fi] -> field
		e.field_index(field) -> fi
		e.showhide_field(field, on, at_fi)
		e.move_field(fi, over_fi)

Rows:
	publishes:
		e.all_rows[ri] -> row
		e.rows[ri] -> row
		e.row_index(row) -> ri

Indexing:
	publishes:
		e.tree_index(cols, [range_defs], [rows]) -> ix
		ix.tree() -> index_tree
		ix.lookup(vals) -> [row1,...]
		e.lookup(cols, vals, [range_defs]) -> [row1, ...]
		e.group_rows(group_by, [range_defs], rows, [group_label_sep]) -> {root:,...}

Master-detail:
	needs:
		e.set_param_vals([{COL1: VAL1, ...}, ...] | false | null)

Tree:
	state:
		e.child_rows -> [row1,...]
		row.child_rows -> [row1,...] | null
		row.depth -> parent_row_count
		row.parent_row -> row
	needs:
		e.tree_col
		e.name_col
	publishes:
		e.each_child_row(row, f)
		e.row_and_each_child_row(row, f)
		e.expanded_child_row_count(ri) -> n

focusing and selection:
	config:
		can_focus_cells
		auto_advance_row
		can_select_multiple
		can_select_non_siblings
		auto_focus_first_cell
	publishes:
		e.focused_row, e.focused_field
		e.selected_row, e.selected_field
		e.last_focused_col
		e.selected_rows: map(row -> true|Set(field))
		e.focus_cell(ri|true|false|0, fi|col|true|false|0, rows, cols, ev)
			ev.input
			ev.cancel
			ev.unfocus_if_not_found
			ev.was_editing
			ev.focus_editor
			ev.enter_edit
			ev.editable
			ev.focus_non_editable_if_not_found
			ev.select: 'expand' | 'invert' | 'deselect_hidden' | 'all'
			ev.select_all_fi
			ev.quicksearch_text
			ev.preserve_quicksearch
		e.focus_next_cell()
		e.select_all_cells()
	calls:
		e.can_change_val()
		e.can_focus_cell()
		e.is_cell_disabled()
		e.can_select_cell()
		e.is_row_selected(row)
		e.is_last_row_focused()
		e.first_focusable_cell(ri|true|0, fi|col|true|0, rows, cols, opt)
			opt.editable
			opt.must_move
			opt.must_not_move_row
			opt.must_not_move_col
		e.do_focus_row(row, row0)
		e.do_focus_cell(row, field, row0, field0)
	announces:
		^^focused_row_changed(row, row0, ev)
		^^focused_cell_changed(row, field, row0, field0, ev)
		^^selected_rows_changed()

Scrolling:
	publishes:
		e.scroll_to_focused_cell([fallback_to_first_cell])
	calls:
		e.scroll_to_cell(ri, [fi])

Sorting:
	config:
		can_sort_rows
	publishes:
		e.order_by <- 'col1[:desc] ...'
		e.sort_rows([row1,...], order_by)
	calls:
		e.compare_rows(row1, row2)
		e.compare_types(v1, v2)
		e.compare_vals(v1, v2)

Filtering:
	publishes:
		e.expr_filter(expr) -> f
		e.filter_rows(rows, expr) -> [row1,...]
		e.set_col_filter(col, s)

Quicksearch:
	config:
		e.quicksearch_col
	publishes:
		e.quicksearch()

Tree node collapsing state:
	e.set_collapsed()
	e.toggle_collapsed()

Row adding, removing, moving:
	publishes:
		e.remove_rows([row1, ...], ev)
		e.remove_row(row, ev)
		e.remove_selected_rows(ev)
		e.insert_rows([{col->val}, ...], ev)
		e.insert_row({col->val}, ev)
		e.start_move_selected_rows(ev) -> state; state.finish()
	calls:
		e.can_remove_row(row, ev)
		e.init_row(row, ri, ev)
		e.free_row(row, ev)
		e.rows_moved(from_ri, n, insert_ri, ev)
	announces:
		^^rows_removed(rows)
		^^rows_added(rows)
		^^rows_changed()

Cell values & state:
	publishes:
		e.cell_state(row, col, key, [default_val])
		e.cell_val(row, col)
		e.cell_input_val(row, col)
		e.cell_errors(row, col)
		e.cell_has_errors(row, col)
		e.cell_modified(row, col)
		e.cell_vals(row, col)

Updating cells:
	publishes:
		e.set_cell_state(field, val, default_val)
		e.set_cell_val()
		e.reset_cell_val()
		e.revert_cell()
	calls:
		e.validate_cell(field, val)
		e.do_update_cell_state(ri, fi, key, val, ev)
	announces:
		^^cell_state_changed(row, field, changes, ev)
		^^row_state_changed(row, changes, ev)
		^^focused_row_cell_state_changed(row, field, changes, ev)
		^^focused_row_state_changed(row, changes, ev)

Row state:
	publishes:
		row.STATE
		e.row_can_have_children()

Updating row state:
	publishes:
		e.begin_set_state(row)
		e.end_set_state()
		e.set_row_state(key, val, default_val)
		e.revert_row()
	calls:
		e.do_update_row_state(ri, changes, ev)
		e.validate_row(row)

Rowset state:
	publishes:
		e.ready                   true after reset
	announces:
		^^reset()                 fired when a new rowset was loaded.
		^^ready()

Updating the rowset:
	publishes:
		e.commit_changes()
		e.revert_changes()
		e.set_null_selected_cells()

Editing cells:
	config:
		can_add_rows
		can_remove_rows
		can_change_rows
		auto_edit_first_cell
		stay_in_edit_mode
		exit_edit_on_lost_focus
	publishes:
		e.editing                 the focused cell is being edited.
		e.editor_id               ui id the editor widget is drawn under.
		e.enter_edit([{sel_i:, sel_len:, focus:, advance_on_exit:}]) -> t|f
		e.advance_on_exit         exiting this edit moves to the next cell.
		e.exit_edit([{cancel: true}])
		e.exit_row([{cancel: true}])
	calls:
		e.cell_clickable(row, field) -> t|f
		e.do_cell_click(row, field, ev)

Loading from server:
	config:
		e.validate_on_load        true
	needs:
		e.rowset_name
	publishes:
		e.reload()
		e.abort_loading()
	calls:
		e.do_update_loading()
		e.do_update_load_progress()
		e.do_update_load_slow()
		e.do_update_load_fail()
	announces:
		^^load_progress(p, loaded, total)
		^^load_slow(on)
		^^load_fail(err, type, status, message, body, req)

Saving changes:
	config:
		e.save_on_add_row         false
		e.save_on_remove_row      true
		e.save_on_input           false
		e.save_on_exit_edit       false
		e.save_on_exit_row        true
		e.save_on_move_row        true
	state:
		e.changed_rows            set of rows to be saved (if validated).
	publishes:
		e.can_save_changes()
		e.save([ev])

Loading & saving from/to memory:
	config
		e.save_row_states
	needs:
		e.static_rowset
		e.row_vals
		e.row_states
	cals
		e.do_save_row(vals) -> true | 'skip'

Cell display val, text val and building:
	publishes:
		e.build_val([row], field, v, [mode], [fg]) -> true|s
		e.build_cell(row, field, [mode], [fg]) -> true|s
	announces:
		^^col_vals_changed(field)

Picker:
	publishes:
		e.display_col
		e.build_row(row, [mode]) -> true|s

State of the work -- what is done, what is not, and what was decided --
is in js/TODO-AI.txt.

--------------------------------------------------------------------------- */

(function () {
"use strict"
const _G = window
const ui = _G.ui

const {
	num, dec, isarray, isstr, isnum, isbool, isobject,
	assert,
	strict_sign, round, abs, clamp,
	set, map, words, keys, array_move, array_set, captures, count_keys,
	do_before, do_after, property, override,
	assign, assign_opt, attr, empty, empty_array,
	remove, insert, remove_values,
	noop, return_true, return_arg, return_false,
	memoize,
	S,
	display_name,
	parse_date, format_date, parse_timeofday,
	format_base,
	format_kbytes, format_kcount, format_timeofday, format_timeago, format_duration,
	clock, day, days, floor, isfunc, json, max, min, month, month_year,
	pr, random, remove_value, snap, str, time, url_format, url_parse, week,
	wrap, year, year_of,
	announce, href, ajax, copy_to_clipboard,
} = glue

function map_keys_different(m1, m2) {
	if (m1.size != m2.size)
		return true
	for (let k1 of m1.keys())
		if (!m2.has(k1))
			return true
	return false
}

//// ROWSETS -----------------------------------------------------------------

// rowsets defined in JS, looked up by the same name a server rowset would
// have, so that `rowset_name` resolves to either without the nav caring.
ui.rowsets = {} // {NAME->rowset}

// field attributes to set client-side (unserializables, presentation, etc.).
ui.rowset_col_attrs = {} // {ROWSET.COL->{K:V}}

function nav_ajax(opt) {
	let rowset = ui.rowsets[opt.rowset_name]
	if (rowset) // js rowset
		opt.xhr = {
			wait: opt.wait ?? rowset.wait,
			response: rowset,
		}
	return ajax(opt)
}

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
			row_count += nav.all_rows.length
			val_count += nav.all_rows.length * nav.all_fields.length
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
			row_count -= nav.all_rows.length
			val_count -= nav.all_rows.length * nav.all_fields.length

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
	return (field.display_col != null && ln.optfld(field.display_col))
		|| ln.display_field
}

function lookup_nav(rowset_name) {
	return ui.shared_nav({
		rowset_name     : rowset_name,
		is_picker       : true,
		can_focus_cells : false,
		can_add_rows    : false,
		can_remove_rows : false,
		can_change_rows : false,
		can_move_rows   : false,
	})
}

// TODO: see what this is for...
let errors_no_messages = []
errors_no_messages.failed = true
errors_no_messages.client_side = true

ui.nav = function(id, opt) {

	assert(id, 'nav id required')
	let e = {id}

	/// instance utils --------------------------------------------------------

	e.announce = function(ev, ...args) {
		announce(ev, e, ...args)
	}

	e.disable = noop

	e.override = function(method, func) {
		this[method] = wrap(this[method], func)
	}

	e.do_before = function(method, func) {
		this[method] = do_before(this[method], func)
	}

	e.do_after = function(method, func) {
		this[method] = do_after(this[method], func)
	}

	e.property = function(name, get, set) {
		return property(this, name, get, set)
	}

	function warn (...args) { _G.warn (e.id, ':', ...args) }
	function debug(...args) { _G.debug(e.id, ':', ...args) }
	e.warn  = warn
	e.debug = debug

	/// behavior options ------------------------------------------------------

	e.can_add_rows               = true
	e.can_remove_rows            = true
	e.can_change_rows            = true
	e.can_move_rows              = true
	e.can_sort_rows              = true
	e.can_focus_cells            = true
	e.can_select_multiple        = true
	e.can_select_non_siblings    = true

	e.auto_advance_row           = false
	e.auto_focus_first_cell      = true
	e.auto_edit_first_cell       = false
	e.stay_in_edit_mode          = true

	e.enter_edit_on_click         = false
	e.enter_edit_on_click_focused = false
	e.exit_edit_on_enter          = false
	e.exit_edit_on_escape         = true
	e.advance_on_enter            = 'next_row' // next_row | next_cell | null
	e.auto_jump_cells             = true

	e.save_on_add_row            = false
	e.save_on_remove_row         = true
	e.save_on_input              = false
	e.save_on_exit_edit          = false
	e.save_on_exit_row           = true

	e.save_row_states            = false

	e.validate_on_load           = true

	/// init/update/free ------------------------------------------------------

	let rowset, rowset_name, rowset_url

	e.free = function() {
		let navs = rowset_navs[e.rowset_name]
		if (navs) {
			navs.delete(e)
			if (!navs.size)
				delete rowset_navs[e.rowset_name]
		}
		update_parts({free: true, reload: true})
	}

	// ev: reload, reset, free,
	//   fields, cols, group_by, rows, filters, row_order, order_by,
	//   row_visibility, input, clear_selection
	e.update_parts = update_parts
	function update_parts(ev) {

		ev ??= empty

		if (ev.reload) {

			rowset_name = !ev.free && e.rowset_name || null
			rowset_url  = rowset_name && '/rowset.json/' + rowset_name
			if (!rowset_name)
				rowset = null

			// if (!e.param_vals)
			// 	rowset_url = null

			// reload rowset if url is present
			abort_all_requests()
			if (rowset_url) {
				reload(ev && {event: ev})
				return
			}

		}

		// decide which parts to update

		let reset            = ev.reset || ev.reload
		let update_fields    = ev.fields
		let update_rows      = ev.rows
		let update_filters   = ev.filters
		let update_row_order = ev.row_order
		let update_row_visibility = ev.row_visibility

		let refocus_pk_vals // focused row's pk, to find it again after a reset.
		let refocus_col

		if (reset || update_rows || update_filters || update_row_order)
			e.exit_edit()

		if (reset) {

			if (!rowset && e.ready) {
				e.ready = false
				e.announce('ready', false)
			}

			// clean up any row refs so we can free the rows

			abort_all_requests()

			if (e.focused_row && e.pk_fields)
				refocus_pk_vals = e.cell_vals(e.focused_row, e.pk_fields)
			refocus_col = e.focused_field?.name

			e.unfocus_focused_cell({cancel: true, input: ev && ev.input})
			clear_row_index()
			e.rows = null

			e.changed_rows = null // set(row)

			// free all fields

			if (e.all_fields)
				for (let field of e.all_fields)
					free_field(field)

			// init all fields

			e.all_fields = []
			e.all_fields_map = {} // {col->field}
			e.group_field = null

			next_key_index = 0
			key_index = {}

			if (rowset?.fields) {
				for (let fi = 0; fi < rowset.fields.length; fi++)
					init_field(rowset.fields[fi], fi)
				e.group_field = init_field({
					hidden: true, name: '$group', label: 'Group', w: 12,
					is_group_field: true, movable: false, groupable: false,
					readonly: true,
					build: build_group_label,
				}, rowset.fields.length)
			}

			// init pk field

			e.pk = rowset && (isarray(rowset.pk) ? rowset.pk.join(' ') : rowset.pk)
			e.pk_fields = optflds(e.pk)

			// init other functional fields

			e.name_field = check_field('name_col', e.name_col ?? rowset?.name_col)
			if (!e.name_field && e.pk_fields && e.pk_fields.length == 1)
				e.name_field = e.pk_fields[0]

			e.pos_field = rowset?.pos_col != null ? optfld(rowset.pos_col) : null
			e.display_field =
				(e.display_col != null && optfld(e.display_col)) || e.name_field

			// init tree fields

			e.id_field = check_field('id_col', rowset?.id_col)
			if (!e.id_field && e.pk_fields && e.pk_fields.length == 1)
				e.id_field = e.pk_fields[0]
			e.parent_field = check_field('parent_col', rowset?.parent_col)

			// create validators after the nav and fields are configured because
			// what rules get added is conditional on it based on rule.applies().

			for (let field of e.all_fields) {
				if (field.readonly)
					continue

				// field.validator_NAME = rule adds a rule named NAME.
				let own_rules = []
				for (let k in field) {
					if (k.startsWith('validator_')) {
						let rule = field[k]
						rule.name = k.replace(/^validator_/, '')
						own_rules.push(rule)
					}
				}
				field.validator = ui.create_validator(field, own_rules)

				// parsing these here after we have a parser as they depend on type.
				if (field.min != null) field.min = field.validator.parse(field.min)
				if (field.max != null) field.max = field.validator.parse(field.max)
			}

			e.row_validator = ui.create_validator(e)

			// free all rows

			if (e.free_row && e.all_rows)
				for (let row of e.all_rows)
					e.free_row(row)

			// init all rows

			e.load_error = null
			e.do_update_load_fail(false)
			update_indices('invalidate')
			e.all_rows = rowset && (
						e.deserialize_all_row_states(e.row_states)
					|| e.deserialize_all_row_vals(e.row_vals ?? rowset.row_vals)
					|| rowset.rows
				) || []

			// validate all rows

			if (e.validate_on_load)
				for (let row of e.all_rows) {
					let cells_failed
					for (let field of e.all_fields) {
						if (field.readonly)
							continue
						if (field.validator) {
							let iv = e.cell_input_val(row, field)
							let failed = !field.validator.validate(iv, false)
							if (!field.validator.parse_failed)
								row[field.val_index] = field.validator.value
							if (failed) {
								e.set_cell_state_for(row, field, 'errors', errors_no_messages)
								cells_failed = true
							}
						}
					}
					let row_failed = !e.row_validator.validate(row, false)
					if (cells_failed || row_failed)
						e.set_row_state_for(row, 'invalid', true)
					if (row_failed)
						e.set_row_state_for(row, 'errors', errors_no_messages)
				}

			update_fields = true
			update_rows = true
		}

		// init visible fields

		if (update_fields) {

			if (ev.cols)
				ui.save_state(e.id, 'cols', e.cols)
			if (ev.group_by)
				ui.save_state(e.id, 'group_by', e.group_by)

			e.fields = []
			e.tree_field = null

			// init group-by view mode
			let was_grouped = e.is_grouped
			e.groups = parse_group_defs(e.vertical_layout ? null : e.group_by)
			e.is_grouped = e.groups.fields.length > 0
			if (e.is_grouped) {
				e.tree_field = fld('$group')
				e.fields.push(e.tree_field)
			}
			if (was_grouped != e.is_grouped)
				update_rows = true

			// add visible fields.
			// hidden vs internal: hidden can be made seen but internal can't.
			let cols = e.cols ?? rowset?.cols
			let default_cols = cols == null

			for (let field of words(rowset && (cols ?? e.all_fields)) ?? empty_array) {

				field = check_field('col', field)
				if (!field) continue

				// never show internal fields
				if (field.internal) continue

				if (default_cols && field.hidden) continue

				// exclude grouped fields
				if (e.groups.fields.includes(field)) continue

				// exclude group field
				if (field.is_group_field) continue

				e.fields.push(field)
			}
			update_field_index()

			// init tree view mode
			let was_tree = e.is_tree
			e.can_be_tree = !!(e.id_field && e.parent_field)
			e.is_tree = false
			if (e.can_be_tree && !e.flat && !e.vertical_layout
				&& !e.is_grouped
			) {
				let col = e.tree_col ?? rowset?.tree_col
				let field = check_field('tree_col', col) ?? e.fields[0]
				e.is_tree = field?.index != null
				if (e.is_tree)
					e.tree_field = field
			}
			if (was_tree != e.is_tree)
				update_rows = true

		}

		// init visible rows

		if (update_rows) {

			reset_quicksearch()
			clear_row_index()
			e.rows = null

			update_filters = true
			update_row_order = true
		}

		if (update_filters) {
			init_filters()
			update_row_visibility = true
		}

		if (update_row_order) {

			if (ev.order_by)
				ui.save_state(e.id, 'order_by', e.order_by)

			update_field_sort_order()

			// if the rows are not going to be sorted, then recreate them
			// so they appear in original rowset order.
			if (!e.rows || !order_by_map.size) {
				if (e.is_grouped) {
					if (!e.rows)
						init_group_tree()
					else
						restore_group_row_order()
				} else if (e.is_tree) {
					init_tree()
				} else if (!e.rows) {
					reset_tree()
				} else if (e.child_rows != e.all_rows) {
					array_set(e.child_rows, e.all_rows)
				}
			}

			let cmp = row_comparator(order_by_map)
			if (cmp) {
				if (e.child_rows == e.all_rows)
					e.child_rows = e.all_rows.slice()
				sort_child_rows(e.child_rows, cmp)
			}

			update_row_visibility = true
		}

		// filter after sort so we can re-filter on the same sort order.
		if (update_row_visibility) {
			clear_row_index()
			e.rows = []
			add_visible_child_rows(e.child_rows)
			update_row_index()
		}

		if (update_row_visibility || update_fields) {
			if (reset && rowset) {
				// reset: focus the same record, found by pk in the new rows.
				let row = refocus_pk_vals
					&& e.lookup(e.pk_fields, refocus_pk_vals)[0]
				e.focus_cell(e.row_index(row), e.optfld(refocus_col)?.index,
					0, 0, {
						must_not_move_row: !e.auto_focus_first_cell,
						unfocus_if_not_found: true,
						enter_edit: e.auto_edit_first_cell,
					})
			} else {
				// focused row hidden: unfocus. focused col hidden: first col.
				e.focus_cell(true, e.focused_field_index, 0, 0, {
					must_not_move_row: true,
					unfocus_if_not_found: true,
					focus_non_editable_if_not_found: true,
					make_visible: false,
					select: ev.clear_selection ? null : 'deselect_hidden',
					preserve_quicksearch: !ev.clear_selection,
				})
			}
		}

		// set ready state

		if (rowset && !e.ready) {
			e.ready = true
			e.announce('ready', true)
		}
		if (reset)
			e.announce('reset', ev)

	}

	function add_visible_child_rows(rows) {
		let has_visible_rows = false
		for (let row of rows) {
			let i = e.rows.length
			e.rows.push(row)
			let is_shown = !row.is_group_row && is_row_visible(row)
			if (row.child_rows) {
				if (!row.collapsed) {
					if (add_visible_child_rows(row.child_rows))
						is_shown = true
				} else if (!is_shown) {
					is_shown = has_matching_rows(row.child_rows)
				}
			}
			if (is_shown)
				has_visible_rows = true
			else
				e.rows.length = i
		}
		return has_visible_rows
	}

	function has_matching_rows(rows) {
		for (let row of rows)
			if ((!row.is_group_row && is_row_visible(row))
					|| (row.child_rows && has_matching_rows(row.child_rows)))
				return true
		return false
	}

	/// fields utils ----------------------------------------------------------

	function optfld(col) {
		if (isstr(col))
			return e.all_fields_map[col]
		else if (isnum(col))
			return e.all_fields[col]
		else
			return col
	}
	function fld(col) {
		return assert(optfld(col), e.id, ' has no col: ', col)
	}
	let fldname = col => fld(col).name

	function flds(cols) {
		let fields = cols && words(cols).map(fld)
		assert(fields && fields.length, e.id, ' has no cols: ', cols || '')
		return fields
	}

	let is_not_null = v => v != null
	function optflds(cols) {
		let ca = cols && words(cols)
		let fields = ca && ca.map(optfld).filter(is_not_null)
		return fields && fields.length && fields.length == ca.length ? fields : null
	}

	e.fldnames = function(cols) {
		if (isstr(cols)) // 'col1 ...' (preferred)
			return cols
		if (isnum(cols)) // fi
			return e.all_fields[cols].name
		else if (isarray(cols)) // [col1|field1,...]
			return cols.map(fldname).join(' ')
		else if (isobject(cols)) // field
			return cols.name
	}

	let fldlabel = f => f.label
	e.fldlabels = function(cols) {
		return e.flds(cols).map(fldlabel)
	}

	function check_field(which, col) {
		if (!rowset) return
		if (col == null) return
		let field = e.optfld(col)
		if (!field)
			warn('"'+col+'"', 'not in rowset:', rowset_name)
		return field
	}

	e.fld = fld
	e.flds = flds
	e.optfld = optfld
	e.optflds = optflds

	// -> the row with the same pk as `row`, or undefined.
	e.find_row = function(row) {
		if (!e.pk_fields)
			return
		pk_vals.length = min(pk_vals.length, e.pk_fields.length)
		for (let i = 0; i < e.pk_fields.length; i++)
			pk_vals[i] = row[e.pk_fields[i].val_index]
		return e.lookup(e.pk, pk_vals)[0]
	}
	let pk_vals = []

	/// fields array matching 1:1 to row contents -----------------------------

	function init_field(f, fi) {

		let field = {}

		// disambiguate field name.
		let given_name = (f.name || 'f'+fi)
		let name = given_name
		if (name in e.all_fields_map) {
			let suffix = 2
			while (name+suffix in e.all_fields_map)
				suffix++
			name += suffix
		}

		if (given_name != name)
			field.given_name = given_name
		field.name = name
		field.val_index = fi
		field.nav = e

		let ct = e.col_attrs && e.col_attrs[name]
		let rt = rowset_name && ui.rowset_col_attrs[rowset_name+'.'+name]
		let type = rt && rt.type || ct && ct.type || f.type || 'text'
		let tt = ui.field_types[type]
		let att = ui.all_field_types

		assign_opt(field, att, tt, f, rt, ct)

		let saved_w = ui.saved_state[e.id+'.col_ws']?.[name]
		if (saved_w != null)
			field.w = saved_w

		let saved_filter = ui.saved_state[e.id+'.col_filters']?.[name]
		if (saved_filter !== undefined)
			field.filter = saved_filter

		field.label ??= display_name(field.given_name || name)
		if (field.enum_values != null) {
			field.enum_values = words(field.enum_values)
			field.known_values = set(field.enum_values)
		}

		e.all_fields[fi] = field
		e.all_fields_map[name] = field

		init_field_lookup_nav(field)

		if (field.lookup_nav)
			assign(field, lookup_editor)

		if (e.init_field)
			e.init_field(field)

		field.filter_field = create_filter_field(field)

		// re-creating the field after all properties are set creates a single
		// hidden class for all fields (shaves off 0.1ms on a full screen grid).
		field = {...field}
		e.all_fields[fi] = field
		e.all_fields_map[name] = field

		return field
	}

	e.on_init_field = function(f) {
		e.do_after('init_field', f)
	}

	function free_field(field) {
		if (e.free_field)
			e.free_field(field)
		free_field_lookup_nav(field)
	}

	e.on_free_field = function(f) {
		e.do_after('free_field', f)
	}

	/// all_fields subset in custom order -------------------------------------

	e.field_index = function(field) {
		return field && field.index
	}

	function update_field_index() {
		for (let field of e.all_fields)
			field.index = null
		for (let i = 0; i < e.fields.length; i++)
			e.fields[i].index = i
	}

	/// visible cols list ops -------------------------------------------------

	function cols_from_fields(fields) {
		let cols = fields
			.filter(f =>
				f != e.group_field
			).map(f => f.name).join(' ')
		let all_cols = e.all_fields
			.filter(f =>
				!f.internal
				&& !f.hidden
				&& !e.groups.fields.includes(f)
				&& f != e.group_field
			).map(f => f.name).join(' ')
		return cols == all_cols ? null : cols
	}

	function showhide_field(field, show, at_fi) {
		field = fld(field)
		if (e.fields.includes(field) == !!show)
			return
		let fields = [...e.fields]
		if (show)
			insert(fields, clamp(at_fi ?? 1/0, 0, fields.length), field)
		else
			remove(fields, field.index)
		return fields
	}

	function move_field(fi, over_fi) {
		if (fi == over_fi)
			return
		let fields = [...e.fields]
		array_move(fields, fi, 1, clamp(over_fi ?? 1/0, 0, fields.length), true)
		return fields
	}

	e.save_col_w = function(field) {
		ui.save_state(e.id+'.col_ws', field.name, field.w)
	}

	e.showhide_field = function(field, on, at_fi) {
		let fields = showhide_field(field, on, at_fi)
		if (fields) {
			e.cols = cols_from_fields(fields)
			update_parts({fields: true, cols: true})
		}
	}

	e.move_field = function(fi, over_fi) {
		let fields = move_field(fi, over_fi)
		if (fields) {
			e.cols = cols_from_fields(fields)
			update_parts({fields: true, cols: true})
		}
	}

	e.ungroup_col = function(col, over_fi) {
		assert(e.groups.cols.includes(col))
		let fields = showhide_field(col, true, over_fi)
		let col_groups = e.groups.col_groups
			.map(cg => cg.filter(c => c != col))
			.filter(cg => cg.length)
		e.group_by = format_group_defs(col_groups, e.groups.range_defs)
		e.cols = cols_from_fields(fields)
		update_parts({fields: true, rows: true, cols: true, group_by: true})
	}

	/// params ----------------------------------------------------------------

	/*
	- supports server-side filtering for server-based navs.
	- supports client-side filtering for client-side navs.
	- new rows get assigned current param values on matching fields.
	*/

	// A client_nav doesn't have a rowset binding. Instead, changes are saved
	// to either row_vals or row_states.
	function is_client_nav() {
		return !!ui.rowsets[rowset_name]
	}

	e.set_param_vals = function(param_vals) {
		// check if new param vals are the same as the old ones to avoid
		// reloading the rowset if the params didn't really change.
		if (param_vals === e.param_vals
			|| json(param_vals) == json(e.param_vals))
			return
		e.param_vals = param_vals
		if (is_client_nav()) { // re-filter and re-focus.
			e.unfocus_focused_cell({cancel: true})
			update_parts({filters: true})
			e.focus_cell()
		} else {
			e.reload()
		}
	}

	/// filtered and custom-sorted subset of all_rows -------------------------

	e.row_index = function(row) {
		return row && row[e.all_fields.length]
	}

	function update_row_index() {
		let index_fi = e.all_fields.length
		for (let i = 0; i < e.rows.length; i++)
			e.rows[i][index_fi] = i
	}

	function clear_row_index() {
		if (!e.rows)
			return
		let index_fi = e.all_fields.length
		for (let row of e.rows)
			row[index_fi] = undefined
	}

	/// editing utils ---------------------------------------------------------

	e.can_actually_add_rows = function() {
		return e.can_add_rows
			&& (!rowset || rowset.can_add_rows != false)
			&& !e.is_grouped
	}

	e.can_actually_remove_rows = function() {
		return e.can_remove_rows
			&& (!rowset || rowset.can_remove_rows != false)
	}

	e.can_change_val = function(row, field) {
		if (e.is_picker)
			return false
		if (row) {
			if (row.is_group_row)
				return false
			if (row.removed)
				return false
			if (!row.is_new) {
				if (!e.can_change_rows)
					return false
				if (row.can_change == false)
					return false
				if (rowset && rowset.can_change_rows == false)
					return false
			}
		} else {
			if (!e.can_change_rows && !e.can_add_rows)
				return false
		}
		if (field)
			if (field.readonly)
				return false
		return true
	}

	e.can_actually_move_rows = function(in_general) {
		if (!(e.can_move_rows && (!rowset || rowset.can_move_rows != false)))
			return false
		if (in_general)
			return true
		if (e.order_by || e.is_filtered || !e.selected_rows.size)
			return false
		if (e.can_be_tree && !e.is_tree)
			return false
		return true
	}

	e.can_actually_move_rows_error = function() {
		if (e.order_by)
			return S('cannot_move_records_sorted', 'Cannot move records while they are sorted')
		if (e.is_filtered)
			return S('cannot_move_records_filtered', 'Cannot move records while they are filtered')
		if (e.can_be_tree && !e.is_tree)
			return S('cannot_move_records_tree_is_flat',
				'Cannot move records in a tree while the grid is not shown as a tree')
		if (!e.selected_rows.size)
			return S('no_records_selected', 'No records selected')
	}

	/// navigation and selection ----------------------------------------------

	e.selected_rows = map() // map(row -> true|Set(field))

	e.property('focused_row_index'   , () => e.row_index(e.focused_row))
	e.property('focused_field_index' , () => e.field_index(e.focused_field))
	e.property('selected_row_index'  , () => e.row_index(e.selected_row))
	e.property('selected_field_index', () => e.field_index(e.selected_field))

	e.can_focus_cell = function(row, field, for_editing) {
		return (!row || row.focusable != false)
			&& (field == null || !e.can_focus_cells || field.focusable != false)
			&& (!for_editing || e.can_change_val(row, field))
	}

	e.is_cell_disabled = function(row, field) {
		return !e.can_focus_cell(row, field)
	}

	e.can_select_cell = function(row, field, for_editing) {
		return e.can_focus_cell(row, field, for_editing)
			&& (e.can_select_non_siblings
				|| e.selected_rows.size == 0
				|| row.parent_row == e.selected_rows.keys().next().value.parent_row)
	}

	e.first_focusable_cell = function(ri, fi, rows, cols, opt) {

		opt = opt || empty
		let editable = opt.editable // skip non-editable cells.
		let must_move = opt.must_move // return only if moved.
		let must_not_move_row = opt.must_not_move_row // return only if row not moved.
		let must_not_move_col = opt.must_not_move_col // return only if col not moved.

		rows = rows ?? 0 // by default find the first focusable row.
		cols = cols ?? 0 // by default find the first focusable col.
		let ri_inc = strict_sign(rows)
		let fi_inc = strict_sign(cols)
		rows = abs(rows)
		cols = abs(cols)

		if (ri === true) ri = e.focused_row_index
		// remembered col may be gone or hidden: then the first col.
		if (fi === true)
			fi = e.field_index(e.all_fields_map[e.last_focused_col])
		if (isstr(fi)) fi = e.field_index(fld(fi))

		// if starting from nowhere, include the first/last row/col into the count.
		if (ri == null && rows)
			rows--
		if (fi == null && cols)
			cols--

		let move_row = rows >= 1
		let move_col = cols >= 1
		let start_ri = ri
		let start_fi = fi

		// the default cell is the first or the last depending on direction.
		ri ??= ri_inc * -1/0 // jshint ignore:line
		fi ??= fi_inc * -1/0 // jshint ignore:line

		// clamp out-of-bound row/col indices.
		ri = clamp(ri, 0, e.rows.length-1)
		fi = clamp(fi, 0, e.fields.length-1)

		let last_valid_ri = null
		let last_valid_fi = null
		let last_valid_row

		// find the last valid row, stopping after the specified row count.
		if (e.can_focus_cell(null, null, editable))
			while (ri >= 0 && ri < e.rows.length) {
				let row = e.rows[ri]
				if (e.can_focus_cell(row, null, editable)) {
					last_valid_ri = ri
					last_valid_row = row
					if (rows <= 0)
						break
				}
				rows--
				ri += ri_inc
			}

		if (last_valid_ri == null)
			return [null, null]

		// if wanted to move the row but couldn't, don't move the col either.
		let row_moved = last_valid_ri != start_ri
		if (move_row && !row_moved)
			cols = 0

		while (fi >= 0 && fi < e.fields.length) {
			let field = e.fields[fi]
			if (e.can_focus_cell(last_valid_row, field, editable)) {
				last_valid_fi = fi
				if (cols <= 0)
					break
			}
			cols--
			fi += fi_inc
		}

		let col_moved = last_valid_fi != start_fi

		if (must_move && !(row_moved || col_moved))
			return [null, null]

		if ((must_not_move_row && row_moved) || (must_not_move_col && col_moved))
			return [null, null]

		return [last_valid_ri, last_valid_fi]
	}

	e.do_focus_row = noop // stub
	e.do_focus_cell = noop // stub

	e.focus_cell = function(ri, fi, rows, cols, ev) {

		if (!e.rows)
			return false

		ev = ev || empty

		if (ri === false || fi === false) { // false means unfocus.
			return e.focus_cell(
				ri === false ? null : ri,
				fi === false ? null : fi, 0, 0,
				assign({
					must_not_move_row: ri === false,
					must_not_move_col: fi === false,
					unfocus_if_not_found: true,
				}, ev)
			)
		}

		let was_editing = ev.was_editing || e.editing
		let focus_editor = ev.focus_editor || is_editor_focused()
		let enter_edit = ev.enter_edit || (was_editing && e.stay_in_edit_mode)
		let editable = (ev.editable || enter_edit) && !ev.focus_non_editable_if_not_found
		let select = ev.select
		if ((select == 'expand' || select == 'invert') && !e.can_select_multiple)
			select = null

		let opt = assign({editable: editable}, ev)

		;[ri, fi] = e.first_focusable_cell(ri, fi, rows, cols, opt)

		// failure to find cell means cancel.
		if (ri == null && !ev.unfocus_if_not_found)
			return false

		let row_changed   = e.focused_row   != e.rows[ri]
		let field_changed = e.focused_field != e.fields[fi]

		if (row_changed)
			e.exit_row({cancel: ev.cancel})
		else if (field_changed)
			e.exit_edit({cancel: ev.cancel})

		let last_ri = e.focused_row_index
		let last_fi = e.focused_field_index
		let ri0 = e.selected_row_index   ?? last_ri
		let fi0 = e.selected_field_index ?? last_fi
		let row0 = e.focused_row
		let field0 = e.focused_field
		let row = e.rows[ri]

		e.focused_row = row
		e.focused_field = e.fields[fi]
		if (e.focused_field != null)
			e.last_focused_col = e.focused_field.name

		let old_selected_rows = map(e.selected_rows)
		let ri1, ri2, fi1, fi2
		if (select == 'deselect_hidden') {
			// hidden rows and hidden cols leave the selection.
			for (let [row, sel_fields] of e.selected_rows) {
				if (e.row_index(row) == null) {
					e.selected_rows.delete(row)
				} else if (isobject(sel_fields)) {
					for (let field of sel_fields)
						if (field.index == null)
							sel_fields.delete(field)
					if (!sel_fields.size)
						e.selected_rows.delete(row)
				}
			}
			if (e.selected_row && e.row_index(e.selected_row) == null) {
				e.selected_row = null
				e.selected_field = null
			}
		} else if (select == 'all') {
			ri1 = 0
			ri2 = e.rows.length-1
			fi1 = ev.select_all_fi ?? 0
			fi2 = ev.select_all_fi ?? e.fields.length-1
		} else if (select == 'expand') {
			ri1 = min(ri0, ri)
			ri2 = max(ri0, ri)
			fi1 = min(fi0, fi)
			fi2 = max(fi0, fi)
			e.selected_row   = e.rows  [ri0]
			e.selected_field = e.fields[fi0]
		} else if (select == 'invert') {
			if (row) {
				if (e.can_focus_cells) {
					let sel_fields = e.selected_rows.get(row) || set()
					let field = e.focused_field
					if (field)
						if (sel_fields.has(field))
							sel_fields.delete(field)
						else
							sel_fields.add(field)
					if (sel_fields.size)
						e.selected_rows.set(row, sel_fields)
					else
						e.selected_rows.delete(row)
				} else if (e.selected_rows.has(row)) {
					e.selected_rows.delete(row)
				} else {
					e.selected_rows.set(row, true)
				}
			}
			e.selected_row = null
			e.selected_field = null
		} else {
			e.selected_rows.clear()
			if (row && !e.can_focus_cells)
				e.selected_rows.set(row, true)
			else if (row && e.focused_field)
				e.selected_rows.set(row, set([e.focused_field]))
			e.selected_row = null
			e.selected_field = null
		}

		if (ri1 != null) {
			e.selected_rows.clear()
			for (let ri = ri1; ri <= ri2; ri++) {
				let row = e.rows[ri]
				if (!e.can_select_cell(row))
					continue
				if (!e.can_focus_cells) {
					e.selected_rows.set(row, true)
					continue
				}
				let sel_fields = set()
				for (let fi = fi1; fi <= fi2; fi++) {
					let field = e.fields[fi]
					if (e.can_select_cell(row, field))
						sel_fields.add(field)
				}
				if (sel_fields.size)
					e.selected_rows.set(row, sel_fields)
			}
		}

		if (row_changed) {
			e.do_focus_row(row, row0)
			e.announce('focused_row_changed', row, row0, ev)
		}

		if (row_changed || field_changed) {
			e.do_focus_cell(row, e.focused_field, row0, field0)
			e.announce('focused_cell_changed',
				row, e.focused_field, row0, field0, ev)
			if (e.is_picker)
				ui.rebuild('focused_cell_changed')
		}

		if (map_keys_different(old_selected_rows, e.selected_rows))
			selected_rows_changed()

		if (ev.quicksearch_text) {
			e.quicksearch_text = ev.quicksearch_text
			e.quicksearch_field = ev.quicksearch_field
		} else if (e.quicksearch_text && (!ev.preserve_quicksearch
				|| e.quicksearch_field?.index == null)) {
			reset_quicksearch()
		}

		// a carried edit must not pop a list open on every arrow key.
		if (enter_edit && ri != null && fi != null)
			e.enter_edit({
				sel_i           : ev.sel_i,
				sel_len         : ev.sel_len,
				focus           : focus_editor || false,
				advance_on_exit : ev.advance_on_exit,
				open_popup      : ev.open_popup ?? false,
			})

		if (ev.make_visible != false)
			if (e.focused_row)
				e.scroll_to_focused_cell()

		return true
	}

	e.scroll_to_cell = function(ri, fi) {
		e.scroll_to_ri = ri
		e.scroll_to_fi = fi
	}

	e.scroll_to_focused_cell = function(fallback_to_first_cell) {
		if (e.focused_row_index != null)
			e.scroll_to_cell(e.focused_row_index, e.focused_field_index ?? 0)
		else if (fallback_to_first_cell)
			e.scroll_to_cell(0, 0)
	}

	e.focus_next_cell = function(cols, ev) {
		let dir = strict_sign(cols)
		let auto_advance_row = ev && ev.auto_advance_row || e.auto_advance_row
		return e.focus_cell(true, true, dir * 0, cols, assign({must_move: true}, ev))
			|| (auto_advance_row && e.focus_cell(true, true, dir, dir * -1/0, ev))
	}

	e.unfocus_focused_cell = function(ev) {
		return e.focus_cell(false, false, 0, 0, ev)
	}

	e.is_last_row_focused = function() {
		let [ri] = e.first_focusable_cell(true, true, 1, 0, {must_move: true})
		return ri == null
	}

	e.select_all_cells = function(fi) {
		e.focus_cell(null, null, 0, 0, {
			select: 'all',
			select_all_fi: fi,
			make_visible: false,
			preserve_quicksearch: true,
		})
	}

	function selected_rows_changed() {
		e.announce('selected_rows_changed')
	}

	e.is_row_selected = function(row) {
		return e.selected_rows.has(row)
	}

	/// vlookup ---------------------------------------------------------------

	// cols        : 'col1 ...' | fi | field | [col1|field1,...]
	// range_defs  : {col->{freq:, unit:, offset:}}
	function create_index(cols, range_defs, rows) {

		let idx = {}

		let tree // map(f1_val->map(f2_val->[row1,...]))
		let cols_arr = words(cols) // [col1,...]
		let fis // [val_index1, ...]

		let range_val, range_label

		if (range_defs) {

			let range_val_funcs = {} // {col->f}
			let range_label_funcs = {} // {col->text}

			for (let col in range_defs) {
				let range = range_defs[col]
				let freq = range.freq
				let unit = range.unit
				let range_val
				let range_label
				if (unit && freq == null)
					freq = 1
				if (freq) {
					let offset = range.offset || 0
					if (!unit) {
						range_val   = v => (floor((v - offset) / freq) + offset) * freq
						range_label = v => freq != 1 ? v + ' .. ' + (v + freq - 1) : v
					} else if (unit == 'month') {
						freq = floor(freq)
						if (freq > 1) {
							range_val   = v => month(v, offset) // TODO
							range_label = v => month_year(v) + ' .. ' + (month_year(month(v, freq - 1)))
						} else {
							range_val   = v => month(v, offset)
							range_label = v => month_year(v)
						}
					} else if (unit == 'year') {
						freq = floor(freq)
						if (freq > 1) {
							range_val   = v => year(v, offset) // TODO
							range_label = v => v + ' .. ' + year(v, freq - 1)
						} else {
							range_val   = v => year(v, offset)
							range_label = v => year_of(v)
						}
					}
				}
				range_val_funcs[col] = range_val
				range_label_funcs[col] = range_label
			}

			range_val = function(v, i) {
				if (v != null) {
					let f = range_val_funcs[cols_arr[i]]
					v = f ? f(v) : v
				}
				return v
			}

			range_label = function(v, i, row) {
				let f = range_label_funcs[cols_arr[i]]
				return f ? f(v) : e.to_text ? e.to_text(row, fld(cols_arr[i])) : ''
			}

		} else {

			range_val = return_arg

			range_label = function(v, i, row) {
				return e.build_cell(row, fld(cols_arr[i]))
			}

		}

		function add_row(row) {
			let last_fi = fis.at(-1)
			let t0 = tree
			let i = 0
			for (let fi of fis) {
				let v = range_val(row[fi], i)
				let t1 = t0.get(v)
				if (!t1) {
					t1 = fi == last_fi ? [] : map()
					t0.set(v, t1)
					t1.label = range_label(v, i, row)
				}
				t0 = t1
				i++
			}
			t0.push(row)
		}

		idx.rebuild = function() {
			fis = cols_arr.map(fld).map(f => f.val_index)
			tree = map()
			for (let row of (rows || e.all_rows))
				add_row(row)
		}

		idx.invalidate = function() {
			tree = null
			fis = null
		}

		idx.row_added = function(row) {
			if (!tree)
				idx.rebuild()
			else
				add_row(row)
		}

		idx.row_removed = function(row) {
			// TODO:
			idx.invalidate()
		}

		idx.val_changed = function(row, field, val) {
			// TODO:
			idx.invalidate()
		}

		idx.lookup = function(vals) {
			assert(isarray(vals), 'lookup() array expected, got ', typeof vals)
			if (!tree)
				idx.rebuild()
			let t = tree
			let i = 0
			for (let fi of fis) {
				let v = range_val(vals[i], i); i++
				t = t.get(v)
				if (!t)
					return empty_array
			}
			return t
		}

		idx.tree = function() {
			if (!tree)
				idx.rebuild()
			return tree
		}

		return idx
	}

	let indices = {} // {cache_key->index}

	e.tree_index = function(cols, range_defs, rows) {
		cols = e.fldnames(cols)
		if (rows) {
			return create_index(cols, range_defs, rows)
		} else {
			let cache_key = cols + (range_defs ? cols+' '+json(range_defs) : '')
			let index = cache_key && indices[cache_key]
			if (!index) {
				index = create_index(cols, range_defs)
				if (cache_key)
					indices[cache_key] = index
			}
			return index
		}
	}

	e.lookup = function(cols, v, range_defs) {
		return e.tree_index(cols, range_defs).lookup(v)
	}

	function update_indices(method, ...args) {
		for (let cols in indices)
			indices[cols][method](...args)
	}

	/// groups ----------------------------------------------------------------

	function flatten(t, path, label_path, depth, add_group, arg1, arg2) {
		let path_pos = path.length
		for (let [k, t1] of t) {
			path[path_pos] = k
			label_path[path_pos] = t1.label
			if (depth)
				flatten(t1, path, label_path, depth-1, add_group, arg1, arg2)
			else
				add_group(t1, path, label_path, arg1, arg2)
		}
		remove(path, path_pos)
	}

	// col_groups_expr : 'col1[/offset][/unit][/freq] col2 > col3 col4 > ...'
	// range_defs1 : {col->{freq:, unit:, offset:}}
	function parse_group_defs(col_groups_expr, range_defs1) {
		let level = 0
		let cols = []
		let col_groups = []
		let range_defs = {}
		let index = 0
		for (let col_group_expr of (col_groups_expr ?? '').split(/\s*>\s*/)) {
			let col_group = []
			for (let col of words(col_group_expr)) {
				let t = {group_level: level, index: index++}
				col = col.replace(/\/[^\/]+$/, k => {t.freq = num(k.substring(1)); return '' })
				col = col.replace(/\/[^\/]+$/, k => {t.unit = k.substring(1); return '' })
				col = col.replace(/\/[^\/]+$/, k => {t.offset = num(k.substring(1)); return '' })
				range_defs[col] = assign({}, range_defs1?.[col], t)
				col_group.push(col)
				cols.push(col)
			}
			col_groups.push(col_group)
			level++
		}
		let fields = optflds(cols) ?? []
		return {cols, fields, col_groups, range_defs}
	}

	function format_group_defs(col_groups, range_defs) {
		let t = []
		for (let i = 0; i < col_groups.length; i++) {
			let col_group = col_groups[i]
			for (let j = 0; j < col_group.length; j++) {
				let col = col_group[j]
				t.push(col)
				let def = range_defs[col]
				if (def.offset != null) t.push('/', def.offset)
				if (def.unit   != null) t.push('/', def.unit)
				if (def.freq   != null) t.push('/', def.freq)
				if (j < col_group.length-1)
					t.push(' ')
			}
			if (i < col_groups.length-1)
				t.push(' > ')
		}
		return t.join('')
	}

	// opt:
	//   group_by        : 'col1[/...] col2 > col3 col4 > ...'
	//   range_defs      : {col->{freq:, unit:, offset:}}
	//   rows            : [row1,...]
	//   group_label_sep : separator for multi-col group labels
	function group_rows(group_defs, rows, group_label_sep) {

		let {cols, fields, col_groups, range_defs} = group_defs
		if (!fields)
			return

		group_label_sep ??= ' / '
		let tree = e.tree_index(cols, range_defs, rows).tree()
		let root = []
		let depth = col_groups[0].length-1
		function add_group(t, path, label_path, parent_group, parent_group_level) {
			let group = []
			group.key_cols = col_groups[parent_group_level].join(' ')
			group.key_vals = path.slice()
			group.label = label_path.join(group_label_sep)
			parent_group.push(group)
			let level = parent_group_level + 1
			let col_group = col_groups[level]
			if (col_group) { // more group levels down...
				let depth = col_group.length-1
				flatten(t, [], [], depth, add_group, group, level)
			} else { // last group level, t is the array of rows.
				group.push(...t)
			}
		}
		flatten(tree, [], [], depth, add_group, root, 0)
		return root
	}

	e.group_rows = function(group_by, range_defs, rows, group_label_sep) {
		let group_defs = parse_group_defs(group_by, range_defs)
		return {...group_defs, root: group_rows(group_defs, rows, group_label_sep)}
	}

	function build_group_label(key_vals, mode, fg, row, full_width, align) {
		let s
		let cols = e.groups.col_groups[row.depth]
		for (let i = 0; i < cols.length; i++) {
			let t = e.build_val(row, fld(cols[i]), key_vals[i]) ?? ''
			s = i ? s + ' / ' + t : t
		}
		return this.build_text(s, mode, fg, row, full_width, align)
	}

	function init_group_tree() {

		e.groups.root = group_rows(e.groups, e.all_rows)

		// convert index tree to row tree
		let group_fi = e.tree_field.val_index
		function push_group_or_row(group, parent_row, depth) {
			let row
			if (group.key_vals) { // it's a group

				row = []
				let i = 0
				row[group_fi] = group.key_vals
				for (let col of words(group.key_cols)) {
					let field = fld(col)
					let val = group.key_vals[i++]
					row[field.val_index] = val // for sorting of group rows
				}

				row.parent_row = parent_row
				row.depth = depth
				row.child_rows = []
				row.collapsed = false
				row.is_group_row = true
				for (let sub_group of group) {
					let child_row = push_group_or_row(sub_group, row, depth+1)
					row.child_rows.push(child_row)
				}
			} else { // it's a row
				row = group
				row.child_rows = null
				row.parent_row = parent_row
				row.depth = depth
			}
			assert(row)
			return row
		}

		e.child_rows = []
		for (let group of e.groups.root) {
			let row = push_group_or_row(group, null, 0)
			e.child_rows.push(row)
		}

	}

	function restore_group_row_order() {
		e.groups.root = group_rows(e.groups, e.all_rows)
		function restore_child_rows(group) {
			let parent_row
			let child_rows
			for (let sub_group of group) {
				let row = sub_group.key_vals
					? restore_child_rows(sub_group) : sub_group
				if (!child_rows) {
					parent_row = row.parent_row
					child_rows = (parent_row || e).child_rows
					child_rows.length = 0
				}
				child_rows.push(row)
			}
			return parent_row
		}
		restore_child_rows(e.groups.root)
	}

	/// tree ------------------------------------------------------------------

	function reset_tree() {
		for (let row of e.all_rows) {
			row.child_rows = null
			row.parent_row = null
			row.depth = null
		}
		e.child_rows = e.all_rows
	}

	e.flat = false

	e.each_child_row = function(row, f) {
		if (row.child_rows)
			for (let child_row of row.child_rows) {
				e.each_child_row(child_row, f) // depth-first
				f(child_row)
			}
	}

	e.row_and_each_child_row = function(row, f) {
		f(row)
		e.each_child_row(row, f)
	}

	function init_depth_for_row(row, depth) {
		row.depth = depth
		return 1 + init_depth_for_rows(row.child_rows, depth + 1)
	}

	function init_depth_for_rows(rows, depth) {
		let n = 0
		for (let row of (rows || empty_array))
			n += init_depth_for_row(row, depth)
		return n
	}

	function detach_row_from_tree(row) {
		let parent_row = row.parent_row
		let child_rows = (parent_row || e).child_rows
		if (!child_rows)
			return
		remove_value(child_rows, row)
		row.parent_row = null
		row.depth = null
		if (parent_row && !parent_row.child_rows?.length) {
			if (parent_row.is_group_row) // empty group: remove
				detach_row_from_tree(parent_row)
			else
				parent_row.collapsed = null
		}
	}

	function remove_row_from_tree(row) {
		detach_row_from_tree(row)
		row.child_rows = null
	}

	function add_row_to_tree(row, parent_row, at_ri) {
		row.parent_row = parent_row
		let parent = parent_row || e
		parent.child_rows ??= []
		insert(parent.child_rows, at_ri, row)
	}

	function init_tree() {

		e.child_rows = []
		for (let row of e.all_rows) {
			row.child_rows = null
			row.parent_row = null
			row.depth = null
		}

		let p_fi = e.parent_field.val_index
		for (let row of e.all_rows) {
			let parent_id = row[p_fi]
			let parent_row
			if (parent_id != null)
				parent_row = e.lookup(e.id_field.name, [parent_id])[0]
			if (parent_row && !parent_row?.child_rows)
				parent_row.child_rows = []
			add_row_to_tree(row, parent_row)
		}

		if (init_depth_for_rows(e.child_rows, 0) < e.all_rows.length) {
			warn('Circular refs detected. Cannot present data as a tree.')
			e.can_be_tree = false
			e.is_tree = false
			e.tree_field = null
			reset_tree()
			return
		}

	}

	/// row moving ------------------------------------------------------------

	function is_parent_of(row, check_row) {
		if (!row.parent_row)
			return false
		if (row.parent_row == check_row)
			return true
		return is_parent_of(row.parent_row, check_row)
	}

	function change_row_parent(row, parent_row) {
		if (!e.is_tree)
			return
		if (parent_row == row.parent_row)
			return
		assert(parent_row != row)
		assert(!parent_row || !is_parent_of(parent_row, row))

		let parent_id = parent_row ? e.cell_val(parent_row, e.id_field) : null
		e.set_cell_val(row, e.parent_field, parent_id)

		detach_row_from_tree(row)
		add_row_to_tree(row, parent_row)

		init_depth_for_row(row, parent_row ? parent_row.depth + 1 : 0)
	}

	/// row collapsing --------------------------------------------------------

	function set_collapsed_all(row, collapsed) {
		if (!row.child_rows)
			return
		row.collapsed = collapsed
		for (let child_row of row.child_rows)
			set_collapsed_all(child_row, collapsed)
	}

	function set_collapsed(row, collapsed, recursive) {
		if (!row.child_rows)
			return
		if (recursive)
			set_collapsed_all(row, collapsed)
		else
			row.collapsed = collapsed
	}

	e.set_collapsed = function(row, collapsed, recursive) {
		if (!(e.is_tree || e.is_grouped))
			return
		if (row)
			set_collapsed(row, collapsed, recursive)
		else
			for (let row of e.child_rows)
				set_collapsed(row, collapsed, recursive)
		update_parts({row_visibility: true, clear_selection: collapsed})
	}

	e.toggle_collapsed = function(row, recursive) {
		e.set_collapsed(row, !row.collapsed, recursive)
	}

	/// sorting ---------------------------------------------------------------

	e.compare_types = function(v1, v2) {
		// nulls come first.
		if ((v1 === null) != (v2 === null))
			return v1 === null ? -1 : 1
		// NaNs come second.
		if ((v1 !== v1) != (v2 !== v2))
			return v1 !== v1 ? -1 : 1
		return 0
	}

	e.compare_vals = function(v1, v2) {
		return v1 !== v2 ? (v1 < v2 ? -1 : 1) : 0
	}

	function cell_comparator(field) {

		let compare_types = field.compare_types || e.compare_types
		let compare_vals  = field.compare_vals  || e.compare_vals
		let input_val_index = cell_state_val_index('input_val', field)
		let val_index = field.val_index

		return function(row1, row2) {
			let v1 = row1[input_val_index]; if (v1 === undefined) v1 = row1[val_index]
			let v2 = row2[input_val_index]; if (v2 === undefined) v2 = row2[val_index]
			let r = compare_types(v1, v2, field)
			if (r) return r
			return compare_vals(v1, v2, field)
		}
	}

	function row_comparator(order_by_map) {

		let order_by = map(order_by_map)

		// use index-based ordering by default, unless otherwise specified.
		if (e.pos_field && order_by.size == 0)
			order_by.set(e.pos_field, 'asc')

		if (!order_by.size)
			return

		let s = []
		let cmps = []
		for (let [field, dir] of order_by) {
			cmps.push(cell_comparator(field))
			let r = dir == 'desc' ? -1 : 1
			// compare vals using the value comparator
			s.push('{')
			s.push('let cmp = cmps['+(cmps.length-1)+']')
			s.push('let r = cmp(r1, r2)')
			s.push('if (r) return r * '+r)
			s.push('}')
		}
		s.push('return 0')
		let cmp = 'let cmp = function(r1, r2) {\n\t' + s.join('\n\t') + '\n}\n; cmp;\n'
		cmp = eval(cmp)
		return cmp
	}

	function sort_child_rows(rows, cmp) {
		rows.sort(cmp)
		for (let row of rows)
			if (row.child_rows)
				sort_child_rows(row.child_rows, cmp)
	}

	e.sort_rows = function(rows, order_by) {
		let order_by_map = map()
		set_order_by_map(order_by, order_by_map)
		let cmp = row_comparator(order_by_map)
		return rows.sort(cmp)
	}

	/// changing the sort order -----------------------------------------------

	function set_order_by_map(order_by, order_by_map) {
		order_by_map.clear()
		for (let s1 of words(order_by || '')) {
			let m = s1.split(':')
			let col = m[0]
			let field = e.all_fields_map[col]
			if (field && field.sortable) {
				let dir = m[1] || 'asc'
				if (dir == 'asc' || dir == 'desc')
					order_by_map.set(field, dir)
			}
		}
	}

	let order_by_map = map()

	// how the grid draws its sort indicators. priority is the field's place
	// in order_by, which is the map's insertion order.
	e.sort_dir = function(field) {
		return order_by_map.get(field)
	}

	e.sort_priority = function(field) {
		if (order_by_map.size < 2)
			return
		let pri = 0
		for (let f of order_by_map.keys()) {
			if (f == field)
				return pri
			pri++
		}
	}

	function update_field_sort_order() {
		set_order_by_map(e.order_by, order_by_map)
	}

	function order_by_from_map() {
		let a = []
		for (let [field, dir] of order_by_map)
			a.push(field.name + (dir == 'asc' ? '' : ':desc'))
		return a.length ? a.join(' ') : null
	}

	e.set_order_by_dir = function(field, dir, keep_others) {
		if (!e.can_sort_rows)
			return
		field = fld(field)
		if (!field.sortable)
			return
		if (dir == 'toggle') {
			dir = order_by_map.get(field)
			dir = dir == 'asc' ? 'desc' : (dir == 'desc' ? false : 'asc')
		}
		if (!keep_others)
			order_by_map.clear()
		if (dir)
			order_by_map.set(field, dir)
		else
			order_by_map.delete(field)
		e.order_by = order_by_from_map()
		update_parts({row_order: true, order_by: true})
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
				s.push('row['+e.all_fields_map[expr[1]].val_index+'] '+expr[0]+' '+json(expr[2]))
			}
		}
		push_expr(expr)
		if (!s.length)
			return return_true
		s = 'let f = function(row) {\n\treturn ' + s.join('') + '\n}; f'
		return eval(s)
	}

	function val_filter_simple(field, expr) {

		let vi = field.val_index

		let f = field.parse_filter?.(expr)
		if (f)
			return row => f(row[vi])

		if (has_number_filter(field)) {

			let parse = ui.create_validator(field).parse

			// range: n1..n2
			{
				let [v1, v2] = captures(expr, /^(.*?)\.\.(.*?)$/)
				if (v1 != null) {
					v1 = parse(v1)
					v2 = parse(v2)
					if (v1 == null || v2 == null)
						return
					return row => row[vi] >= v1 && row[vi] <= v2
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
						return row => row[vi] >= n
					else if (op == '<=')
						return row => row[vi] <= n
					else if (op == '>')
						return row => row[vi] > n
					else if (op == '<')
						return row => row[vi] < n
					else
						return
				}
			}

			// exact match: n
			{
				let n = parse(expr)
				if (n == null)
					return
				return row => row[vi] === n
			}

		}

		let shown_text = row =>
			(e.build_val(row, field, row[vi]) ?? '').toLowerCase()
		expr = expr.toLowerCase()

		// exact match: =s
		if (expr.startsWith('=')) {
			let s = expr.slice(1)
			return row => shown_text(row) == s
		}

		// starts with: ^s
		if (expr.startsWith('^')) {
			let s = expr.slice(1)
			return row => shown_text(row).startsWith(s)
		}

		// ends with: s$
		if (expr.endsWith('$')) {
			let s = expr.slice(0, -1)
			return row => shown_text(row).endsWith(s)
		}

		// includes: [~]s
		if (expr.startsWith('~')) // prefix to avoid having to escape ^, $ etc.
			expr = expr.slice(1)
		return row => shown_text(row).includes(expr)

	}

	function has_number_filter(field) {
		return !field.lookup_nav
			&& !!(field.is_number || field.is_time || field.is_timeofday)
	}

	function create_filter_field(field) {
		let filter_field = ui.create_field({align: field.align, label: field.label,
			is_number_filter: has_number_filter(field)})
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

	function val_filter(field, expr) {

		// negation: !expr
		if (expr.startsWith('!')) {
			expr = expr.slice(1)
			let filter = val_filter_simple(field, expr)
			return filter && (row => !filter(row))
		}

		return val_filter_simple(field, expr)

	}

	let is_row_visible
	function add_filter(is) {
		let is0 = is_row_visible
		if (is0 == return_true) {
			is_row_visible = is
		} else {
			is_row_visible = function(row) {
				if (!is0(row))
					return false
				return is(row)
			}
		}
		e.is_filtered = true
	}
	function init_filters() {
		is_row_visible = return_true
		e.is_filtered = false
		if (e.param_vals === false) {
			is_row_visible = return_false
			return
		}
		if (e.param_vals && is_client_nav() && e.all_fields.length) {
			let expr = ['&&']
			// this is a detail nav that must filter itself based on param_vals.
			// TODO: switch to dynamic lookup if reaching JS expression size limits.
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
			if (expr.length > 1)
				add_filter(e.expr_filter(expr))
		}
		for (let field of e.all_fields) {
			if (field.filter)
				add_filter(val_filter(field, field.filter) ?? return_false)
			if (field.exclude_vals) {
				add_filter(function(row) {
					let v = row[field.val_index]
					return !field.exclude_vals.has(v)
				})
			}
		}
	}

	e.is_row_visible = function(row) {
		let parent_row = row.parent_row
		while (parent_row) {
			if (parent_row.collapsed)
				return false
			parent_row = parent_row.parent_row
		}
		return is_row_visible(row)
	}

	e.filter_rows = function(rows, expr) {
		return rows.filter(e.expr_filter(expr))
	}

	e.set_col_filter = function(col, s) {
		let field = fld(col)
		field.filter = s
		ui.save_state(e.id+'.col_filters', field.name, s)
		update_parts({filters: true, clear_selection: true})
	}

	/// get/set cell & row state (storage api) --------------------------------

	let next_key_index = 0
	let key_index = {} // {key->i}

	function cell_state_key_index(key, allocate) {
		let i = key_index[key]
		if (i == null && allocate) {
			i = next_key_index++
			key_index[key] = i
		}
		return i
	}

	// row layout: [f1_val, f2_val, ..., row_index, f1_k1, f2_k1, ..., f1_k2, f2_k2, ...].
	// a row grows dynamically for every new key that needs to be allocated:
	//	value slots for that key are added at the end of the row for all fields.
	// the slot at `e.all_fields.length` is reserved for storing the row index.
	function cell_state_val_index(key, field, allocate) {
		if (key == 'val')
			return field.val_index
		let fn = e.all_fields.length
		return fn + 1 + cell_state_key_index(key, allocate) * fn + field.val_index
	}

	e.cell_state = function(row, field, key, default_val) {
		let v = row[cell_state_val_index(key, field)]
		return v !== undefined ? v : default_val
	}

	e.set_cell_state_for = function(row, field, key, val) {
		let vi = cell_state_val_index(key, field, true)
		row[vi] = val
	}

	e.set_row_state_for = function(row, key, val) {
		row[key] = val
	}

	{
	e.do_update_cell_state = noop
	e.do_update_row_state = noop

	let csc, rsc, row, ev, depth

	e.begin_set_state = function(row1, ev1) {
		if (depth) {
			assert(row1 == row)
			depth++
			return
		}
		csc = map() // {field->{key->[val, old_val]}}
		rsc = {} // {key->old_val}
		row = row1
		ev = ev1
		depth = 1
		return true
	}

	e.end_set_state = function() {
		if (depth > 1) {
			depth--
			return
		}
		let ri = e.row_index(row, ev && ev.row_index)
		let vals_changed, errors_changed
		for (let [field, changes] of csc) {
			let fi = e.field_index(field)
			e.do_update_cell_state(ri, fi, changes, ev)
			e.announce('cell_state_changed', row, field, changes, ev)
			if (row == e.focused_row)
				e.announce('focused_row_cell_state_changed', row, field, changes, ev)
			if (changes.input_val)
				vals_changed = true
			if (changes.errors)
				errors_changed = true
		}
		let row_state_changed = count_keys(rsc, 1)
		if (row_state_changed) {
			e.do_update_row_state(ri, rsc, ev)
			e.announce('row_state_changed', row, rsc, ev)
			if (row == e.focused_row)
				e.announce('focused_row_state_changed', row, rsc, ev)
			if (rsc.errors)
				errors_changed = true
		}
		let changed = !!(row_state_changed || csc.size)
		csc = null
		rsc = null
		row = null
		ev = null
		depth = null
		return changed
	}

	e.set_cell_state = function(field, key, val, default_val) {
		assert(row)
		let vi = cell_state_val_index(key, field, true)
		let old_val = row[vi]
		if (old_val === undefined)
			old_val = default_val
		if (old_val === val)
			return false
		row[vi] = val
		attr(csc, field)[key] = [val, old_val]
		return true
	}

	e.set_row_state = function(key, val, default_val) {
		assert(row)
		let old_val = row[key]
		if (old_val === undefined)
			old_val = default_val
		if (old_val === val)
			return false
		row[key] = val
		rsc[key] = [val, old_val]
		return true
	}
	}

	/// get/set cell vals and cell & row state --------------------------------

	e.cell_val        = (row, col) => row[fld(col).val_index]
	e.cell_input_val  = (row, col) => e.cell_state(row, fld(col), 'input_val', e.cell_val(row, col))

	e.cell_errors     = (row, col, with_messages) => {
		let field = fld(col)
		let errors = e.cell_state(row, field, 'errors')
		if ((!errors || errors == errors_no_messages) && with_messages != false) {
			let val = e.cell_input_val(row, field)
			errors = e.validate_cell(field, val)
			e.set_cell_state_for(row, field, 'errors', errors)
		}
		return errors
	}

	e.cell_has_errors = (row, col) => {
		let err = e.cell_errors(row, col, false)
		return err && err.failed
	}

	e.cell_modified = (row, col) => {
		let field = e.fld(col)
		let compare_vals = field.compare_vals || e.compare_vals
		return compare_vals(e.cell_input_val(row, field), e.cell_val(row, field), field) != 0
	}

	e.cell_vals = function(row, cols) {
		let fields = flds(cols)
		return fields ? fields.map(field => row[field.val_index]) : null
	}

	e.cell_input_vals = function(row, cols) {
		let fields = flds(cols)
		return fields ? fields.map(field => e.cell_input_val(row, field)) : null
	}

	e.focused_row_cell_val = function(col) {
		return e.focused_row && e.cell_val(e.focused_row, col)
	}

	function add_validation_errors(validator, errors) {
		for (let result of validator.results)
			errors.push(assign({}, result))
	}

	e.validate_cell = function(field, val) {
		let errors = []
		errors.failed = false
		errors.client_side = true
		if (field.validator) {
			errors.failed = !field.validator.validate(val)
			add_validation_errors(field.validator, errors)
		}
		return errors
	}

	e.validate_row_only = function(row) {
		let errors = []
		errors.failed = false
		errors.client_side = true
		errors.failed = !e.row_validator.validate(row)
		add_validation_errors(e.row_validator, errors)
		return errors
	}

	e.row_can_have_children = function(row) {
		return row.can_have_children != false
	}

	e.row_errors = function(row) {
		if (row.errors == errors_no_messages) {
			let row_errors = e.validate_row_only(row)
			e.set_row_state_for(row, 'errors', row_errors)
		}
		return row.errors
	}

	function notify_errors(ev) {
		if (!(ev && ev.notify_errors))
			return
		if (!e.changed_rows)
			return
		let errs = []
		for (let row of e.changed_rows) {
			for (let err of (e.row_errors(row) || empty_array))
				if (err.checked && err.failed)
					errs.push(err.error)
			for (let field of e.all_fields)
				for (let err of (e.cell_errors(row, field) || empty_array))
					if (err.checked && err.failed)
						errs.push(field.label + ': ' + err.error)
		}
		if (!errs.length)
			return
		e.notify('error', errs.join('\n'))
	}

	e.validate_row = function(row) {

		if (row.errors && row.errors.client_side)
			return !row.invalid

		e.begin_set_state(row)

		let invalid
		for (let field of e.all_fields) {
			if (field.readonly)
				continue
			if (!(row.is_new || e.cell_modified(row, field)))
				continue
			let errors = e.cell_errors(row, field, false)
			if (errors && !errors.client_side)
				errors = null // server-side errors must be cleared.
			if (!errors || row.is_new || e.cell_modified(row, field)) {
				let val = e.cell_input_val(row, field)
				errors = e.validate_cell(field, val)
				e.set_cell_state(field, 'errors', errors)
			}
			if (errors.failed)
				invalid = true
		}

		let row_errors = e.validate_row_only(row)
		invalid = invalid || row_errors.failed
		e.set_row_state('errors', row_errors)
		e.set_row_state('invalid', invalid)

		e.end_set_state()

		return !invalid
	}

	function cells_modified(row, exclude_field) {
		for (let field of e.all_fields)
			if (field != exclude_field && e.cell_modified(row, field))
				return true
		return false
	}

	e.is_row_user_modified = function(row, including_invalid_values) {
		if (!row.modified)
			return false
		for (let field of e.all_fields)
			if (field !== e.pos_field && field !== e.parent_field) {
				if (e.cell_modified(row, field))
					return true
				if (including_invalid_values && e.cell_has_errors(row, field))
					return true
			}
		return false
	}

	e.set_cell_val = function(row, col, val, ev) {

		let field = fld(col)

		if (field.readonly)
			return

		if (field.nosave) {
			e.reset_cell_val(row, field, val, ev)
			return
		}

		let errors = e.validate_cell(field, val)
		// text that doesn't parse stays in the cell, same as when loading.
		if (!field.validator.parse_failed)
			val = field.validator.value
		let compare_vals = field.compare_vals || e.compare_vals
		let old_val = e.cell_input_val(row, field)
		if (!compare_vals(val, old_val))
			return
		let invalid = errors.failed
		let cur_val = e.cell_val(row, field)
		let cell_modified = compare_vals(val, cur_val, field) != 0
		let row_modified = cell_modified || cells_modified(row, field)

		// update state fully without firing change events.
		e.begin_set_state(row, ev)

		e.set_cell_state(field, 'input_val', val, cur_val)
		e.set_cell_state(field, 'errors'   , errors)
		e.set_row_state('errors'   , undefined)
		e.set_row_state('modified' , row_modified, false)

		// fire change events now that the state is fully updated.
		e.end_set_state()

		if (row_modified)
			row_changed(row)
		else if (!row.is_new)
			row_unchanged(row)

		// save rowset if necessary & possible.
		if (!invalid)
			if (ev && ev.input) // from UI
				if (e.save_on_input)
					e.save(ev)

	}

	e.reset_cell_val = function(row, col, val, ev) {

		let field = fld(col)

		// set_cell_val() routes nosave fields here, so val can be editor text.
		// readonly fields have no validator and nothing to parse.
		let errors = e.validate_cell(field, val)
		if (field.validator && !field.validator.parse_failed)
			val = field.validator.value

		let old_val = e.cell_val(row, field)

		e.begin_set_state(row, ev)

		if (ev && ev.diff_merge) {
			// server merge-updates should not reset input vals.
			e.set_cell_state(field, 'val', val)
		} else {
			e.set_cell_state(field, 'val', val)
			e.set_cell_state(field, 'input_val', val, old_val)
			e.set_cell_state(field, 'errors', errors)
			e.set_row_state('errors', undefined)
		}
		e.set_row_state('modified', cells_modified(row), false)

		if (!row.modified)
			row_unchanged(row)

		if (val !== old_val)
			update_indices('val_changed', row, field, val)

		return e.end_set_state()
	}

	/// editing ---------------------------------------------------------------

	// the edited cell is the focused cell; the text and caret belong to the
	// editor widget drawn under e.editor_id.
	e.editing = false
	e.advance_on_exit = false
	e.editor_id = null
	e.edit_sel_i = 0
	e.edit_sel_len = 1/0
	e.want_dropdown_open = false

	// cells that act on a click instead of opening an editor.
	e.cell_clickable = function(row, field) {
		if (!e.can_change_val(row, field))
			return false
		if (field.is_bool)
			return true
		return false
	}

	e.do_cell_click = function(row, field, ev) {
		if (field.is_bool)
			e.set_cell_val(row, field, !e.cell_input_val(row, field), ev)
	}

	function is_editor_focused() {
		return ui.focused(e.editor_id)
			|| ui.focus_inside(e.editor_id)
	}

	// sel_i, sel_len: in ui.select_text() terms, all of it by default.
	e.enter_edit = function(opt) {
		if (e.editing) {
			if (e.focused_field.has_editor && (opt?.open_popup != false
					|| e.focused_field.edits_in_popup))
				e.focused_field.open_dropdown?.(e.editor_id)
			return true
		}
		let row = e.focused_row
		let field = e.focused_field
		if (!row || !field)
			return false
		if (!e.can_change_val(row, field))
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
		let editor_type = field.lookup_rowset_name || field.type
		e.editor_id = editor_type + '.editor'
		if (field.has_editor) {
			e.want_dropdown_open = opt?.open_popup != false
				|| !!field.edits_in_popup
			// by key: that is what focuses the input element. a click can't, the
			// input only appears a frame later.
			if (opt?.focus !== false)
				field.focus_editor(e.editor_id, sel_i, sel_len)
		}
		return true
	}

	e.exit_edit = function(ev) {
		if (!e.editing)
			return
		let row = e.focused_row
		let field = e.focused_field
		// leaving because focus went elsewhere must not pull it back.
		let take_focus = is_editor_focused()
		let editor_id = e.editor_id
		e.editing = false
		e.advance_on_exit = false
		e.editor_id = null
		e.want_dropdown_open = false
		if (ev && ev.cancel) {
			if (row && field)
				e.revert_cell(row, field, ev)
		} else if (e.save_on_exit_edit) {
			e.save(ev)
		}
		if (take_focus)
			ui.focus(e.id)
		if (field?.has_editor)
			field.close_dropdown?.(editor_id)
	}

	e.revert_cell = function(row, field, ev) {
		return e.reset_cell_val(row, field, e.cell_val(row, field), ev)
	}

	e.revert_row = function(row) {
		for (let field of e.all_fields)
			e.revert_cell(row, field)
	}

	e.exit_row = function(ev) {
		let cancel = ev && ev.cancel
		let row = e.focused_row
		if (!row)
			return
		e.exit_edit(ev)
		if (cancel)
			return
		if (row.modified || row.is_new)
			e.validate_row(row)
		if (e.save_on_exit_row)
			e.save(ev)
	}

	e.set_null_selected_cells = function(ev) {
		for (let [row, sel_fields] of e.selected_rows)
			for (let field of (isobject(sel_fields) ? sel_fields : e.fields))
				if (e.can_change_val(row, field))
					e.set_cell_val(row, field, null, ev)
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

	function col_vals_changed(field) {
		e.announce('col_vals_changed', field)
		reset_quicksearch()
	}

	/*
	// parse & validate cells & rows silently and without making too much
	// garbage and without getting the error messages, just the failed state.
	function validate_all_rows_of(field) {
		if (field.readonly)
			return
		if (!field.validator)
			return
		for (let row of e.all_rows) {
			let iv = e.cell_input_val(row, field)
			let failed = !field.validator.validate(iv, false)
			if (!field.validator.parse_failed)
				row[field.val_index] = field.validator.value
			if (failed) {
				e.set_cell_state_for(row, field, 'errors', errors_no_messages)
				e.set_row_state_for(row, 'invalid', true)
			}
		}
	}

	// TODO: revalidate a col when its lookup nav's rows change: values that
	// were unknown can become known and the other way around.
	*/

	/// cell value multi-target rendering -------------------------------------

	function build_null_lookup_val(row, field, mode, fg, full_width, align) {
		if (!row || !field.null_lookup_col) return
		let nf = e.all_fields_map[field.null_lookup_col]  ; if (!nf || !nf.lookup_cols) return
		let ln = nf.lookup_nav                            ; if (!ln) return
		let nv = e.cell_val(row, nf)
		let ln_row = e.lookup_val(row, nf, nv)            ; if (!ln_row) return
		let dcol = field.null_display_col ?? field.name
		let df = ln.all_fields_map[dcol]                  ; if (!df) return
		return ln.build_cell(ln_row, df, mode, fg, full_width, align)
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
	e.lookup_val = function(row, field, v) {

		let ln = field.lookup_nav                     ; if (!ln || !ln.ready) return
		let lookup_cols = field.lookup_cols || ln.pk  ; if (!lookup_cols) return

		if (!lookup_cols.includes(' ')) {
			vals.length = min(vals.length, 1)
			vals[0] = v
			return ln.lookup(lookup_cols, vals)[0]
		}

		let fs = e.optflds(field.local_cols || lookup_cols) ; if (!fs) return
		vals.length = min(vals.length, fs.length)
		for (let i = 0; i < fs.length; i++)
			vals[i] = fs[i] == field ? v : e.cell_input_val(row, fs[i])
		return ln.lookup(lookup_cols, vals)[0]
	}
	}

	e.build_val = function(row, field, v, mode, fg, full_width, align) {

		if (v == null) {
			let s = build_null_lookup_val(row, field, mode, fg, full_width,
				align)
			if (s) return s

			if (field.build_null)
				return field.build_null(mode, fg, row, align)

			s = field.null_text
			if (s) return field.build_text(s, mode, fg, null, null, align)

			return
		}

		if (v === '') {
			if (field.empty_text)
				return field.build_text(field.empty_text, mode, fg,
					null, null, align)
			return
		}

		let ln_row = e.lookup_val(row, field, v)
		if (ln_row) {
			let df = lookup_display_field(field)
			if (df)
				return field.lookup_nav.build_cell(ln_row, df, mode, fg,
					full_width, align)
		}

		return field.build(v, mode, fg, row, full_width, align)
	}

	e.build_cell = function(row, field, mode, fg, full_width, align) {
		return e.build_val(row, field, e.cell_input_val(row, field),
			mode, fg, full_width, align)
	}

	e.cell_text_val = e.build_cell

	/// row adding & removing -------------------------------------------------

	e.insert_rows = function(arg1, ev) {
		ev = ev || empty
		let from_server = ev.from_server
		// adding policy applies to the user, not to code driving the nav,
		// same as removal policy in remove_rows().
		if (ev.input && !e.can_actually_add_rows())
			return 0
		let row_vals, row_num
		if (isarray(arg1)) { // arg#1 is row_vals
			row_vals = arg1
			row_num  = arg1.length
		} else { // arg#1 is row_num
			row_num = arg1
			row_vals = null
		}
		if (row_num <= 0)
			return 0
		let at_row = ev.row_index != null
			? e.rows[ev.row_index]
			: ev.at_focused_row && e.focused_row
		let parent_row = at_row ? at_row.parent_row : null
		if (parent_row?.removed)
			return 0
		let ri1 = at_row ? e.row_index(at_row) : e.rows.length
		let set_cell_val = from_server ? e.reset_cell_val : e.set_cell_val

		// request to focus the new row implies being able to exit the
		// focused row first. if that's not possible, the insert is aborted.
		if (ev.focus_it) {
			ev.was_editing  = e.editing
			ev.focus_editor = is_editor_focused()
			if (!e.focus_cell(false, false))
				return 0
		}

		let rows_added, rows_updated
		let added_rows = set()
		let is_sorted_insert = ev.input && order_by_map.size > 0
		let all_ri = at_row && !e.is_grouped && !is_sorted_insert
			? e.all_rows.indexOf(at_row) : e.all_rows.length
		let child_rows = !e.is_grouped && (parent_row || e).child_rows
		let child_ri
		if (child_rows && child_rows != e.all_rows)
			child_ri = at_row ? child_rows.indexOf(at_row) : child_rows.length

		let max_position = 0
		if (is_sorted_insert && e.pos_field)
			for (let child_row of child_rows) {
				let position = e.cell_input_val(child_row, e.pos_field)
				if (position > max_position)
					max_position = position
			}

		// TODO: move row to different parent.
		assert(!e.is_tree || !from_server, 'NYI')

		for (let i = 0, ri = ri1; i < row_num; i++) {

			let row = row_vals && row_vals[i]
			if (row && !isarray(row)) // {col->val} format
				row = e.deserialize_row_vals(row)

			// set current param values into the row.
			if (e.param_vals) {
				row = row || []
				for (let k in e.param_vals[0]) {
					let field = fld(k)
					let fi = field.val_index
					if (row[fi] === undefined)
						row[fi] = e.param_vals[0][k]
				}
			}

			// check pk to perform an "insert or update" op.
			let row0 = ev.op == 'upsert' && row && e.all_rows.length > 0
				&& e.find_row(row)

			if (row0) {

				// update row values that are not `undefined`.
				let fi = 0
				for (let field of e.all_fields) {
					let val = row[fi++]
					if (val !== undefined)
						set_cell_val(row0, field, val, ev)
				}

				assign(row0, ev.row_state)
				rows_updated = true

			} else {

				row = row || []

				// set default values into the row.
				if (!from_server) {
					let fi = 0
					for (let field of e.all_fields) {
						let val = row[fi]
						if (val === undefined) {
							val = field.client_default
							if (isfunc(val)) // name generator etc.
								val = val()
							row[fi] = val
						}
						fi++
					}
				}

				if (e.init_row)
					e.init_row(row, ri, ev)

				if (is_sorted_insert && e.pos_field)
					row[e.pos_field.val_index] = ++max_position

				if (!from_server)
					row.is_new = true
				insert(e.all_rows, all_ri++, row)
				assign(row, ev.row_state)
				added_rows.add(row)
				rows_added = true

				if (e.is_tree) {
					row.child_rows = []
					add_row_to_tree(row, parent_row || null, child_ri++)
					if (row.parent_row) {
						// set parent id to be the id of the parent row.
						let parent_id = e.cell_val(row.parent_row, e.id_field)
						row[e.parent_field.val_index] = parent_id
					}
					init_depth_for_row(row,
						row.parent_row ? row.parent_row.depth + 1 : 0)
				} else if (child_ri != null) {
					insert(child_rows, child_ri++, row)
				}

				update_indices('row_added', row)

				if (e.is_row_visible(row)) {
					insert(e.rows, ri, row)
					ri++
				}

				if (row.is_new)
					row_changed(row)

			}

		}

		if (rows_added) {
			update_row_index()
			if (ev.input)
				update_all_pos_fields()
			e.announce('rows_added', added_rows)
			e.announce('rows_changed')
		}

		if (ev.focus_it)
			e.focus_cell(ri1, true, 0, 0, ev)

		if (rows_added && !from_server)
			if (ev.input) // from UI
				if (e.save_on_add_row)
					e.save(ev)

		return added_rows.size
	}

	e.insert_row = function(row_vals, ev) {
		return e.insert_rows([row_vals], ev) > 0
	}

	e.can_remove_row = function(row, ev) {
		if (!e.can_actually_remove_rows())
			return false
		if (!row)
			return true
		if (row.can_remove == false) {
			if (ev && ev.input)
				e.notify('error', S('error_row_not_removable', 'Row not removable'))
			return false
		}
		if (row.is_new && row.save_request) {
			if (ev && ev.input)
				e.notify('error',
					S('error_remove_row_while_saving',
						'Cannot remove a row that is being added to the server'))
			return false
		}
		return true
	}

	e.remove_rows = function(rows_to_remove, ev) {

		ev = ev || empty

		if (!rows_to_remove.length)
			return false

		let is_undelete = ev.op == 'undelete'

		// drop the rows outright when there is no server to send a delete to,
		// otherwise mark them removed and let save() send it.
		let remove_now = ev.from_server || !e.can_save_changes()

		// removal policy applies to the user, not to code driving the nav.
		let from_ui = !!ev.input

		if (from_ui && !is_undelete && !e.can_actually_remove_rows())
			return false

		let removed_rows = set()
		let has_changed_marks = false
		let top_row_index
		let focused_row0 = e.focused_row

		// drop one record from the nav. the code detaches dropped records from
		// the tree after the walks, because the walks iterate child_rows.
		function drop_record(row) {
			if (e.focused_row == row)
				assert(e.focus_cell(false, false, 0, 0, {cancel: true, input: e}))
			row_unchanged(row)
			removed_rows.add(row)
			if (e.free_row)
				e.free_row(row, ev)
			update_indices('row_removed', row)
			row.removed = true
		}

		// set or clear the record's mark for deletion, and queue the record or
		// take it out of changed_rows to match.
		function set_mark(row) {
			if (row.removed == !is_undelete)
				return
			row.removed = !is_undelete
			if (row.removed)
				row_changed(row)
			else if (!row.modified)
				row_unchanged(row)
			has_changed_marks = true
		}

		// remove the records under the row children-first, then the row itself
		// if the walk removed every record under it. when can_remove_row()
		// refuses a record, the walk keeps that record's ancestors too. group
		// rows are not records: the walk only passes through them. new records,
		// and all records when there is no server, are dropped; the rest are
		// marked. -> true if nothing under the row, and not the row itself,
		// was kept.
		function remove_subtree(row) {
			if (removed_rows.has(row))
				return true
			let is_all_removed = true
			if (row.child_rows)
				for (let child_row of row.child_rows)
					if (!remove_subtree(child_row))
						is_all_removed = false
			if (row.is_group_row || !is_all_removed)
				return is_all_removed
			if (from_ui && !e.can_remove_row(row, ev))
				return false
			if (remove_now || row.is_new)
				drop_record(row)
			else
				set_mark(row)
			return true
		}

		// unmark a marked record with its subtree, and its marked parents so
		// that no kept record is left under a deleted parent. a record that
		// isn't marked is left alone with its subtree. group rows are not
		// records: the walk only passes through them.
		function undelete_subtree(row) {
			if (!row.is_group_row) {
				if (!row.removed)
					return
				set_mark(row)
				for (let parent_row = row.parent_row; parent_row?.removed;
						parent_row = parent_row.parent_row)
					set_mark(parent_row)
			}
			if (row.child_rows)
				for (let child_row of row.child_rows)
					undelete_subtree(child_row)
		}

		for (let row of rows_to_remove) {

			if (ev.refocus) {
				let row_index = e.row_index(row)
				if (top_row_index == null || row_index < top_row_index)
					top_row_index = row_index
			}

			if (is_undelete)
				undelete_subtree(row)
			else
				remove_subtree(row)

		}

		if (removed_rows.size) {

			// detach after the walks because they iterate child_rows. skip rows
			// whose parent was dropped too: their subtree is detached with the
			// parent.
			let all_rows = e.all_rows
			e.all_rows = all_rows.filter(row => !removed_rows.has(row))
			if (e.is_tree || e.is_grouped) {
				for (let row of removed_rows)
					if (!removed_rows.has(row.parent_row))
						remove_row_from_tree(row)
			} else if (e.child_rows == all_rows) {
				e.child_rows = e.all_rows
			} else {
				remove_values(e.child_rows, row => removed_rows.has(row))
			}

			update_parts({row_visibility: true})

			if (ev.input)
				update_all_pos_fields()

			e.announce('rows_removed', removed_rows)

			if (top_row_index != null && focused_row0
					&& e.row_index(focused_row0) == null) {
				if (!e.focus_cell(top_row_index, true, null, null, {input: e}))
					e.focus_cell(top_row_index, true, -0, 0, {input: e})
			}

		}

		if (removed_rows.size)
			e.announce('rows_changed')

		if (has_changed_marks && !is_undelete)
			if (e.save_on_remove_row)
				e.save(ev)

		return !!(has_changed_marks || removed_rows.size)
	}

	e.remove_row = function(row, ev) {
		return e.remove_rows([row], ev)
	}

	e.remove_selected_rows = function(ev) {
		if (!e.selected_rows.size)
			return false
		return e.remove_rows([...e.selected_rows.keys()], ev)
	}
	function same_fields(rs) {
		// all_fields carries the appended $group field, the rowset doesn't.
		let rs_fields = e.all_fields.filter(f => !f.is_group_field)
		if (rs.fields.length != rs_fields.length)
			return false
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let f1 = rs.fields[fi]
			let f0 = rs_fields[fi]
			// compare against the rowset's own name: init_field renames
			// duplicates by appending a suffix.
			if (f1.name !== (f0.given_name ?? f0.name))
				return false
		}
		let rs_pk = isarray(rs.pk) ? rs.pk.join(' ') : rs.pk
		if (rs_pk !== e.pk)
			return false
		return true
	}

	e.diff_merge = function(rs) {

		// abort the merge if the fields are not exactly the same as before.
		if (!same_fields(rs))
			return false

		// TODO: diff_merge trees.
		if (e.is_tree || e.is_grouped)
			return false

		let rows_added = e.insert_rows(rs.rows, {
				op: 'upsert',
				from_server: true,
				diff_merge: true,
				row_state: {merged: true},
			})
		let rows_updated = rs.rows.length - rows_added

		let rm_rows = []
		for (let row of e.all_rows) {
			if (row.merged)
				row.merged = null
			else if (!row.is_new)
				rm_rows.push(row)
		}

		e.remove_rows(rm_rows, {from_server: true})

		return true
	}

	/// row moving ------------------------------------------------------------

	e.expanded_child_row_count = function(ri) { // expanded means visible.
		let n = 0
		if (e.is_tree) {
			let row = e.rows[ri]
			let min_parent_count = row.depth + 1
			for (ri++; ri < e.rows.length; ri++) {
				let child_row = e.rows[ri]
				if (child_row.depth < min_parent_count)
					break
				n++
			}
		}
		return n
	}

	function update_pos_field_for_children_of(row, recursive) {
		if (!e.pos_field || order_by_map.size || e.is_grouped)
			return
		let index = 1
		for (let child_row of (row || e).child_rows) {
			e.set_cell_val(child_row, e.pos_field, index++)
			if (recursive && child_row.child_rows)
				update_pos_field_for_children_of(child_row, true)
		}
	}

	function update_all_pos_fields() {
		update_pos_field_for_children_of(null, true)
	}

	function move_rows_state(focused_ri, selected_ri, ev) {

		let move_ri1 = min(focused_ri, selected_ri)
		let move_ri2 = max(focused_ri, selected_ri)

		let top_row = e.rows[move_ri1]
		let parent_row = top_row.parent_row

		move_ri2++ // make range exclusive.

		if (e.is_tree) {

			let min_parent_count = top_row.depth

			// extend selection with all visible children which must be moved along.
			// another way to compute this would be to find the last selected sibling
			// of top_row and select up to all its extended_child_row_count().
			while (1) {
				let row = e.rows[move_ri2]
				if (!row)
					break
				if (row.depth <= min_parent_count) // sibling or unrelated
					break
				move_ri2++
			}

			// check to see that all selected rows are siblings or children of the first row.
			for (let ri = move_ri1; ri < move_ri2; ri++)
				if (e.rows[ri].depth < min_parent_count)
					return

		}

		let move_n = move_ri2 - move_ri1

		if (move_n == e.rows.length) // moving all rows: nowhere to move them to.
			return

		// compute allowed row range in which to move the rows.
		let ri1 = 0
		let ri2 = e.rows.length
		if (!e.can_change_parent && e.is_tree && parent_row) {
			let parent_ri = e.row_index(parent_row)
			ri1 = parent_ri + 1
			ri2 = parent_ri + 1 + e.expanded_child_row_count(parent_ri)
		}
		ri2 -= move_n // adjust to after removal.

		let rows = e.rows.splice(move_ri1, move_n)

		let state = {
			move_ri1: move_ri1,
			move_ri2: move_ri2,
			move_n: move_n,
			rows: rows,
			parent_row: parent_row,
			ri1: ri1,
			ri2: ri2,
		}

		state.finish = function(insert_ri, parent_row) {

			e.rows.splice(insert_ri, 0, ...rows)

			let old_parent_row = rows[0].parent_row

			// move top siblings to new parent.
			if (old_parent_row != parent_row) {
				for (let row of rows)
					if (row.parent_row == old_parent_row) // sibling of top row
						change_row_parent(row, parent_row)
			} else if (e.is_tree) {
				let child_rows = (parent_row || e).child_rows
				let child_ri = child_rows.indexOf(rows[0])
				let move_child_count = 0
				for (let row of rows)
					if (row.parent_row == parent_row)
						move_child_count++
				let next_row = e.rows[insert_ri + move_n]
				let insert_child_ri = next_row
					&& next_row.parent_row == parent_row
					? child_rows.indexOf(next_row) : child_rows.length
				if (insert_child_ri > child_ri)
					insert_child_ri -= move_child_count
				array_move(child_rows, child_ri, move_child_count, insert_child_ri)
			}

			update_row_index()

			if (is_client_nav() || !(e.is_tree || e.is_grouped)) {
				// client rowsets do not need a `pos` field to track row positions.
				// instead, row positions are implicit per e.all_rows array. so when
				// we move rows around, we need to move them in e.all_rows too.
				if (e.is_tree) {
					// rebuild e.all_rows from the updated tree.
					e.all_rows = []
					function add_child_rows(rows) {
						for (let row of rows) {
							e.all_rows.push(row)
							if (row.child_rows)
								add_child_rows(row.child_rows)
						}
					}
					add_child_rows(e.child_rows)
				} else {
					if (e.is_grouped && e.param_vals) {
						// move visible rows to the top of the unfiltered rows array
						// so that move_ri1, move_ri2 and insert_ri point to the same rows
						// in both unfiltered and filtered arrays.
						let r1 = []
						let r2 = []
						for (let ri = 0; ri < e.all_rows.length; ri++) {
							let visible = e.is_row_visible(e.all_rows[ri])
							;(visible ? r1 : r2).push(e.all_rows[ri])
						}
						e.all_rows = [].concat(r1, r2)
					}
					if (!e.is_grouped && e.child_rows != e.all_rows) {
						array_move(e.child_rows, move_ri1, move_n, insert_ri)
						array_set(e.all_rows, e.child_rows)
					} else {
						array_move(e.all_rows, move_ri1, move_n, insert_ri)
					}
					if (is_client_nav() && e.rows_moved)
						e.rows_moved(move_ri1, move_n, insert_ri, ev)
				}
			}

			update_row_index()

			update_pos_field_for_children_of(old_parent_row)
			if (parent_row != old_parent_row)
				update_pos_field_for_children_of(parent_row)

			if (e.save_on_move_row)
				e.save(ev)

		}

		state.finish_up = function() {
			state.finish(move_ri1 - 1, parent_row)
		}

		state.finish_down = function() {
			state.finish(move_ri1 + 1, parent_row)
		}

		return state
	}

	e.start_move_selected_rows = function(ev) {
		let focused_ri  = e.focused_row_index
		let selected_ri = e.selected_row_index ?? focused_ri
		return move_rows_state(focused_ri, selected_ri, ev)
	}

	e.move_selected_rows_up = function(ev) {
		e.start_move_selected_rows(ev).finish_up()
	}

	e.move_selected_rows_down = function(ev) {
		e.start_move_selected_rows(ev).finish_down()
	}

	/// ajax requests ---------------------------------------------------------

	let requests

	function add_request(req) {
		if (!requests)
			requests = set()
		requests.add(req)
	}

	function abort_all_requests() {
		if (requests)
			for (let req of requests)
				req.abort()
	}

	e.requests_pending = function() {
		return !!(requests && requests.size)
	}

	/// loading ---------------------------------------------------------------

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

	function format_rowset_url(format) {
		let u = rowset_url
		if (format)
			u = u.replace('.json', '.'+format)
		let s = href(u)
		let filter = param_vals_filter()
		if (filter) {
			let u = url_parse(s)
			u.args = u.args || {}
			u.args.filter = filter
			s = url_format(u)
		}
		return s
	}

	function reload(opt) {

		let saving = requests && requests.size && !e.load_request

		// ignore rowset-changed event if coming exclusively from our update operations.
		if (opt?.update_ids) {
			let ignore
			for (let update_id of opt.update_ids) {
				if (update_ids.has(update_id)) {
					update_ids.delete(update_id)
					if (ignore == null)
						ignore = true
				} else {
					ignore = false
				}
			}
			if (ignore)
				return
			if (saving)
				return
			if (opt?.if_filter && opt?.if_filter != param_vals_filter())
				return
			pr('reloading', rowset_name)
		}

		if (saving) {
			e.notify('error',
				S('error_load_while_saving', 'Cannot reload while saving is in progress.'))
			return
		}

		e.abort_loading()

		let rs = ui.rowsets[rowset_name]
		if (rs && (e.wait ?? rs.wait) == null) {
			set_rowset(rs)
			return
		}

		let req = nav_ajax(assign_opt({
			rowset_name: rowset_name,
			wait: e.wait,
			url: format_rowset_url(),
			progress: load_progress,
			done: load_done,
			slow: load_slow,
			slow_timeout: e.slow_timeout,
			dont_send: true,
		}, opt))
		req.addEventListener('success', load_success)
		req.addEventListener('fail', load_fail)
		add_request(req)
		e.load_request = req
		e.load_request_start_clock = clock()
		e.loading = true
		loading(true)
		req.send()
	}

	e.reload = function(opt) {

		if (!rowset_url) // in-memory rowset: nothing to reload from.
			return

		if (e.param_vals === false) { // no master selection: show nothing.
			update_parts({filters: true})
			return
		}

		reload(opt)
	}

	e.abort_loading = function() {
		if (!e.load_request)
			return
		e.load_request.abort()
		load_done.call(e.load_request)
	}

	function load_progress(p, loaded, total) {
		e.do_update_load_progress(p, loaded, total)
		e.announce('load_progress', p, loaded, total)
	}

	function load_slow(show) {
		e.do_update_load_slow(show)
		e.announce('load_slow', show)
	}

	function load_done() {
		requests.delete(this)
		e.load_request = null
		e.loading = false
		loading(false)
	}

	function load_fail(ev) {
		let [err, type, status, message, body] = ev.args
		// kept so that a widget can show a failed state: cleared on the
		// next reset, which is where do_update_load_fail(false) is called.
		e.load_error = {error: err, type: type, status: status,
			message: message, body: body}
		e.do_update_load_fail(true, err, type, status, message, body)
		return e.announce('nav_load_fail', err, type, status, message, body, this)
	}

	// e.prop('focus_state', {slot: 'user'})

	function set_rowset(rs) {
		rowset = rs
		e._rowset = rs // for inspection
		//update_subs('reset')
		update_parts({reset: true})
	}

	function load_success(ev) {
		let [rs] = ev.args
		if (this.allow_diff_merge && e.diff_merge(rs))
			return
		set_rowset(rs)
		ui.animate()
	}

	/// saving changes --------------------------------------------------------

	function row_changed(row) {
		if (row.nosave) return
		e.changed_rows ??= set()
		e.changed_rows.add(row)
	}

	function row_unchanged(row) {
		if (!e.changed_rows) return
		e.changed_rows.delete(row)
		if (!e.changed_rows.size)
			e.changed_rows = null
	}

	function pack_changes() {

		let packed_rows = []
		let source_rows = []
		let changes = {rows: packed_rows}

		// pack the row's removed descendants depth-first, so that the server
		// can remove children before parents (in case it refuses to recurse).
		function pack_removed_row(row) {
			if (row.child_rows)
				for (let child_row of row.child_rows)
					if (child_row.removed && !child_row.save_request)
						pack_removed_row(child_row)
			let t = {type: 'remove', values: {}}
			for (let f of e.pk_fields)
				t.values[f.name+':old'] = e.cell_val(row, f)
			packed_rows.push(t)
			source_rows.push(row)
		}

		for (let row of e.changed_rows) {
			if (row.save_request)
				continue // currently saving this row.
			if (!row.removed && !e.validate_row(row))
				continue
			if (row.is_new) {
				let t = {type: 'new', values: {}}
				for (let field of e.all_fields) {
					if (field.nosave)
						continue
					let val = e.cell_input_val(row, field)
					// an unset col takes the server default; a null is a null.
					if (val !== undefined)
						t.values[field.name] = val
				}
				packed_rows.push(t)
				source_rows.push(row)
			} else if (row.removed) {
				if (!row.parent_row?.removed)
					pack_removed_row(row)
			} else if (row.modified) {
				let t = {type: 'update', values: {}}
				let has_values
				for (let field of e.all_fields) {
					if (field.nosave)
						continue
					if (!e.cell_modified(row, field))
						continue
					t.values[field.name] = e.cell_input_val(row, field)
					has_values = true
				}
				if (has_values) {
					for (let f of e.pk_fields)
						t.values[f.name+':old'] = e.cell_val(row, f)
					packed_rows.push(t)
					source_rows.push(row)
				}
			}
		}

		return [changes, source_rows]
	}

	function apply_result(result, source_rows, ev) {
		let rows_to_remove = []
		for (let i = 0; i < result.rows.length; i++) {
			let rt = result.rows[i]
			let row = source_rows[i]

			if (rt.remove) {
				rows_to_remove.push(row)
			} else {
				let row_failed = rt.error || rt.field_errors
				let errors = isstr(rt.error) ? [{error: rt.error, failed: true}] : undefined

				e.begin_set_state(row, ev)

				e.set_row_state('errors', errors)
				if (!row_failed) {
					e.set_row_state('is_new'  , false, false)
					e.set_row_state('modified', false, false)
				}
				if (rt.field_errors) {
					for (let k in rt.field_errors) {
						let err = rt.field_errors[k]
						e.set_cell_state(fld(k), 'errors', [{error: err, failed: true}])
					}
				}
				if (rt.values) {
					for (let fi = 0; fi < rt.values.length; fi++)
						e.reset_cell_val(row, e.all_fields[fi], rt.values[fi])
				}

				e.end_set_state()

				if (!row_failed)
					row_unchanged(row)
			}
		}
		e.remove_rows(rows_to_remove, {from_server: true, refocus: true})

		if (result.sql_trace && result.sql_trace.length)
			debug(result.sql_trace.join('\n'))

		notify_errors(ev)
	}

	function set_save_state(rows, req) {
		for (let row of rows)
			row.save_request = req
	}

	let update_ids = set()

	function save_to_server(ev) {
		if (!e.changed_rows)
			return
		let [changes, source_rows] = pack_changes()
		if (!source_rows.length) {
			notify_errors(ev)
			return
		}
		let update_id = format_base(floor(random() * 2**52), 36)
		update_ids.add(update_id)
		let req = nav_ajax({
			rowset_name: e.rowset_name,
			wait: e.wait,
			url: format_rowset_url(),
			upload: {exec: 'save', changes: changes, update_id: update_id},
			source_rows: source_rows,
			success: save_success,
			fail: save_fail,
			done: save_done,
			slow: save_slow,
			slow_timeout: e.slow_timeout,
			ev: ev,
			dont_send: true,
		})
		add_request(req)
		set_save_state(source_rows, req)
		e.announce('saving', true)
		req.send()
	}

	e.can_save_changes = function() {
		return !is_client_nav() || !!e.static_rowset
	}

	e.save = function(ev) {
		if (e.static_rowset) {
			if (e.save_row_states)
				save_to_row_states()
			else
				save_to_row_vals()
			e.announce('saved')
		} else if (!is_client_nav()) {
			save_to_server(ev)
		} else {
			e.commit_changes()
		}
	}

	function save_slow(show) {
		e.announce('saving_slow', show)
	}

	function save_done() {
		requests.delete(this)
		set_save_state(this.source_rows, null)
		e.announce('saving', false)
	}

	function save_success(result) {
		apply_result(result, this.source_rows, this.ev)
		e.announce('saved')
	}

	function save_fail(type, status, message, body) {
		let err
		if (type == 'http')
			err = S('error_http', 'Server returned {0} {1}', status, message)
		else if (type == 'network')
			err = S('error_save_network', 'Saving failed: network error.')
		else if (type == 'timeout')
			err = S('error_save_timeout', 'Saving failed: timed out.')
		if (err)
			e.notify('error', err, body)
		e.announce('save_fail', err, type, status, message, body)
	}

	e.revert_changes = function() {
		if (!e.changed_rows)
			return

		abort_all_requests()

		let rows_to_remove = []
		for (let row of e.changed_rows) {
			if (row.is_new) {
				rows_to_remove.push(row)
			} else if (row.removed) {
				e.begin_set_state(row)
				e.set_row_state('removed', false, false)
				e.set_row_state('errors', undefined)
				e.end_set_state()
			} else if (row.modified) {
				e.revert_row(row)
			}
		}
		e.remove_rows(rows_to_remove, {from_server: true, refocus: true})

		e.changed_rows = null
	}

	e.commit_changes = function() {
		if (!e.changed_rows)
			return

		abort_all_requests()

		let rows_to_remove = []
		for (let row of e.changed_rows) {
			if (row.removed) {
				rows_to_remove.push(row)
			} else {
				e.begin_set_state(row)
				for (let field of e.all_fields)
					e.reset_cell_val(row, field, e.cell_input_val(row, field))
				e.set_row_state('is_new'  , false, false)
				e.set_row_state('modified', false, false)
				e.end_set_state()
			}
		}
		e.remove_rows(rows_to_remove, {from_server: true, refocus: true})

		e.changed_rows = null
	}

	/// row (de)serialization -------------------------------------------------

	e.do_save_row = return_true // stub

	e.serialize_row = function(row) {
		let drow = []
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			let field = e.all_fields[fi]
			let v = e.cell_input_val(row, field)
			if (v !== undefined && !field.nosave)
				drow[fi] = v
		}
		return drow
	}

	e.serialize_all_rows = function(row) {
		let rows = []
		for (let row of e.all_rows)
			if (!row.removed && !row.nosave && !row.invalid) {
				let drow = e.serialize_row(row)
				rows.push(drow)
			}
		return rows
	}

	e.row_state_map = function(row, key) {
		let t = {}
		for (let field of e.all_fields)
			t[field.name] = e.cell_state(row, field, key)
		return t
	}

	e.serialize_row_vals = function(row, cell_val) {
		cell_val = cell_val ?? e.cell_input_val
		let vals = {}
		for (let field of e.all_fields) {
			let v = cell_val(row, field)
			if (v !== undefined && !field.nosave)
				vals[field.name] = v
		}
		return vals
	}

	e.deserialize_row_vals = function(vals) {
		let row = []
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			let field = e.all_fields[fi]
			row[fi] = vals[field.name]
		}
		return row
	}

	e.serialize_all_row_vals = function() {
		let rows = []
		for (let row of e.all_rows)
			if (!row.removed && !row.nosave && (!row.errors || !row.invalid)) {
				let vals = e.serialize_row_vals(row)
				if (e.do_save_row(vals) !== 'skip')
					rows.push(vals)
			}
		return rows
	}

	e.deserialize_all_row_vals = function(row_vals) {
		if (!row_vals)
			return
		let rows = []
		for (let vals of row_vals) {
			let row = e.deserialize_row_vals(vals)
			rows.push(row)
		}
		return rows
	}

	e.serialize_all_row_states = function() {
		let rows = []
		for (let row of e.all_rows) {
			if (!row.nosave) {
				let state = {}
				if (row.is_new)
					state.is_new = true
				if (row.removed)
					state.removed = true
				state.vals = e.serialize_row_vals(row, e.cell_val)
				let cells
				for (let key in key_index)
					for (let field of e.all_fields) {
						let v = e.cell_state(row, field, key)
						if (v === undefined)
							continue
						cells ??= {}
						attr(cells, field.name)[key] = v
					}
				if (cells)
					state.cells = cells
				rows.push(state)
			}
		}
		return rows
	}

	e.deserialize_all_row_states = function(row_states) {
		if (!row_states)
			return
		let rows = []
		for (let state of row_states) {
			let row = state.vals ? e.deserialize_row_vals(state.vals) : []
			if (state.cells) {
				e.begin_set_state(row)
				for (let col in state.cells) {
					let field = e.all_fields_map[col]
					if (field) {
						let t = state.cells[col]
						for (let k in t)
							e.set_cell_state(field, k, t[k])
					}
				}
				e.end_set_state()
			}
			rows.push(row)
		}
		return rows
	}

	function save_to_row_vals() {
		e.row_vals = e.serialize_all_row_vals()
		e.commit_changes()
	}

	function save_to_row_states() {
		e.row_states = e.serialize_all_row_states()
	}

	/// responding to notifications from the server ---------------------------

	e.notify = function(type, message, ...args) {
		e.announce('notify', type, message, ...args)
	}

	e.do_update_loading       = noop // stub
	e.do_update_load_progress = noop // stub
	e.do_update_load_slow     = noop // stub
	e.do_update_load_fail     = noop // stub

	function loading(on) {
		e.do_update_loading(on)
		e.announce('loading', on)
		e.do_update_load_progress(0)
	}

	/// quick-search ----------------------------------------------------------

	function* qs_reach_row(start_row, ri_offset) {
		ri_offset ??= 0
		let n = e.rows.length
		let ri1 = (e.row_index(start_row) ?? 0) + ri_offset
		if (ri_offset >= 0) {
			for (let ri = ri1; ri < n; ri++)
				yield ri
			for (let ri = 0; ri < ri1; ri++)
				yield ri
		} else {
			for (let ri = ri1; ri >= 0; ri--)
				yield ri
			for (let ri = n-1; ri > ri1; ri--)
				yield ri
		}
	}

	function reset_quicksearch() {
		e.quicksearch_text = ''
		e.quicksearch_field = null
	}

	e.quicksearch = function(s, start_row, ri_offset) {

		if (!s) {
			reset_quicksearch()
			return
		}

		s = s.toLowerCase()

		let field = e.focused_field || (e.quicksearch_col && e.all_fields_map[e.quicksearch_col])
		if (!field)
			return

		for (let ri of qs_reach_row(start_row, ri_offset)) {
			let row = e.rows[ri]
			let cell_text = (e.cell_text_val(row, field) ?? '').toLowerCase()
			if (cell_text.startsWith(s)) {
				if (e.focus_cell(ri, field.index, 0, 0, {
						input: e,
						must_not_move_row: true,
						must_not_move_col: true,
						quicksearch_text: s,
						quicksearch_field: field,
				})) {
					break
				}
			}
		}

	}

	/// picker protocol -------------------------------------------------------

	// e.prop('row_display_val_template', {private: true})
	// e.prop('row_display_val_template_name', {attr: 'row_display_val_template'})

	e.build_row = function(row, mode) { // stub
		if (!row)
			return
		let field = e.display_field
		if (!field)
			return e.build_text('no display field', mode)
		return e.build_cell(row, field, mode)
	}

	/// init ------------------------------------------------------------------

	// TODO: remove this
	update_parts({reset: true})

	assign(e, opt)
	assert(e.rowset_name, 'rowset_name required')

	let saved = ui.saved_state[e.id]
	if (saved?.cols !== undefined)
		e.cols = saved.cols
	if (saved?.group_by !== undefined)
		e.group_by = saved.group_by
	if (saved?.order_by !== undefined)
		e.order_by = saved.order_by

	if (!ui.rowsets[e.rowset_name]) {
		init_rowset_events()
		attr(rowset_navs, e.rowset_name, set).add(e)
	}

	update_parts({reload: true})

	return e
}

/// validation rules ---------------------------------------------------------

function field_name(e) {
	return display_name(e.label || e.name || S('value', 'value'))
}

// NOTE: this must work with values that are unparsed and invalid!
function field_value(e, v) {
	if (v == null) return 'null'
	if (isstr(v)) return v
	if (e.to_text)
		v = e.to_text(v)
	return str(v)
}

ui.add_validation_rule({
	name: 'pk',
	applies  : (e) => e.pk,
	validate : (e, row) => {
		// skip expensive check for loaded rows which are unique from source.
		if (!(row.is_new || row.modified))
			return true
		let pk_vals = e.cell_input_vals(row, e.pk)
		// skip checking pks with nulls in them.
		for (let v of pk_vals)
			if (v == null)
				return true
		let rows = e.lookup(e.pk, pk_vals).filter(row1 => row1 != row)
		return rows.length < 1
	},
	error    : (e, v) => S('validation_pk_message', '{0} is not unique',
			e.pk_fields.map(field => field.label).join(' + ')),
	rule     : (e) => S('validation_pk_rule', '{0} must be unique',
			e.pk_fields.map(field => field.label).join(' + ')),
})

ui.add_validation_rule({
	name     : 'lookup',
	applies  : (field) => field.lookup_nav,
	// TODO: multi-col lookup
	validate : (field, v) => !!field.nav.lookup_val(null, field, v),
	error    : (field, v) => S('validation_lookup_error',
		'{0} unknown value {1}', field_name(field), field_value(field, v)),
	rule     : (field) => S('validation_lookup_rule',
		'{0} value unknown', field_name(field)),
})

//// GRID EDITORS ------------------------------------------------------------

/*

Displaying a grid value:

	build          : f(v, mode, [fg], [row], [full_width], [align]) -> true|s
	build_text     : f(s, [mode], [fg], [row], [full_width], [align]) -> true|s
	build_null     : f([mode], [fg], [row], [align]) -> true|s

	mode: falsy = return the value as plain text.
	mode: truty = build value widget.

	- grid calls build_null() for null.
	- grid calls build_text() for null_text and empty_text.
	- grid calls build() for normal values.

Editing a value:

	has_editor     : the cell enters edit mode. false for bool, which the
	                 user toggles by click and space instead.
	build_editor   : f(id, v, pad_l, pad_r, h, align) -> v
	edits_in_popup : build_editor builds a popup, so the cell keeps drawing
	                 the value under it.
	editor_value   : f(id, v) -> v   what the picker has made of v so far.
	                 only editors with a picker implement it: the grid calls
	                 it once per frame and writes the result to the cell when
	                 it differs from what the cell holds. typed text doesn't
	                 come through here: the grid reads it from the input box
	                 at the start of its update and writes it to the cell
	                 there.

	focus_editor         : f(id, sel_i, sel_len)
	editor_selection     : f(id, align) -> [i, len]
	editor_caret_at_edge : f(id, d, align) -> true|false   d is -1 or 1

Dropdown editors:

	open_dropdown  : f(id)
	close_dropdown : f(id)
	toggle_dropdown: f(id)
	dropdown_open  : f(id) -> t|f  is the picker up.
	dropdown_picked: f(id) -> t|f  did the picker close in this pass, and did
	                 that close come from picking.
	                 the grid ends the edit when the picker goes from open to
	                 closed, cancelling it unless it was picked.

*/

// icons drawn by field types, not by any one widget, so they live here
// rather than in the grid's own icon aliases.
ui.icon_def('calendar'     , 'tabler', '\uea53')
ui.icon_def('map_pin'      , 'tabler', '\ueae8')
ui.icon_def('box_unchecked', 'tabler', '\ueb2c')
ui.icon_def('box_checked'  , 'tabler_filled', '\uf76d')

ui.all_field_types.focus_editor = function(id, sel_i, sel_len) {
	ui.focus(id, true)
	ui.select_text(id, sel_i, sel_len)
}

ui.all_field_types.editor_selection = function(id, align) {
	return ui.text_selection(id, align == 'right', true)
}

ui.all_field_types.editor_caret_at_edge = function(id, d, align) {
	// select-all: both ends are the edge
	if (this.editor_selection(id, align)[1] == 1/0)
		return true
	let [i, len] = ui.text_selection(id, d > 0)
	return !len && i == (d < 0 ? 0 : -1)
}

// same call as build_text(), so the cell doesn't shift on entering edit.
ui.all_field_types.build_editor = function(id, v, pad_l, pad_r, h, align) {
	ui.p(pad_l, 0, pad_r, 0)
	ui.text_editable(id, v, 0, align, 'c', null, this)
}

ui.all_field_types.fixed_width = 0

ui.all_field_types.build_text = function(s, mode, fg, row, full_width,
	align) {
	if (!mode)
		return s
	ui.color(fg)
	ui.text('', s, 0, align, 'c', full_width ? null : 0)
	return true
}

ui.all_field_types.build = function(v, mode, fg, row, full_width, align) {
	let s = this.to_text(v)
	return this.build_text(s, mode, fg, row, full_width, align)
}

// an editor that is a dropdown has no caret to move within.

let dropdown_editor = {}

dropdown_editor.editor_selection = function(id) {
	return [0, 1/0]
}

dropdown_editor.editor_caret_at_edge = function(id, d) {
	return true
}

dropdown_editor.open_dropdown = function(id) {
	ui.set_dropdown_open(id, true)
}

dropdown_editor.close_dropdown = function(id) {
	ui.set_dropdown_open(id, false)
}

dropdown_editor.toggle_dropdown = function(id) {
	ui.set_dropdown_open(id, !ui.dropdown_open(id))
}

dropdown_editor.dropdown_open = function(id) {
	return ui.dropdown_open(id)
}

dropdown_editor.dropdown_closed = function(id) {
	return ui.dropdown_closed(id)
}

dropdown_editor.dropdown_picked = function(id) {
	return ui.dropdown_picked(id)
}

let filesize = ui.field_types.filesize

filesize.build = function(x, mode, fg, row, full_width, align) {
	let s = this.to_text(x)
	if (mode) {
		// TODO: requires a faint color
		// if (this.is_small(x))
			//	ui.color('label')
		return this.build_text(s, mode, fg, null, null, align)
	}
	return s
}

let date = ui.field_types.date

date.open_dropdown = function(id) {
	ui.set_dropdown_open(id+'.calendar', true)
}

date.close_dropdown = function(id) {
	ui.set_dropdown_open(id+'.calendar', false)
}

date.toggle_dropdown = function(id) {
	ui.set_dropdown_open(id+'.calendar', !ui.dropdown_open(id+'.calendar'))
}

date.dropdown_open = function(id) {
	return ui.dropdown_open(id+'.calendar')
}

date.dropdown_closed = function(id) {
	return ui.dropdown_closed(id+'.calendar')
}

date.dropdown_picked = function(id) {
	return ui.dropdown_picked(id+'.calendar')
}

date.build_editor = function(id, v, pad_l, pad_r, h, align) {
	let calendar_id = id+'.calendar'
	let picker_id = calendar_id+'.picker'
	let editor_target_i = ui.stack('', 1, 's', 's')
	ui.end_stack()

	ui.popup('', 'overlay', editor_target_i, 'irs', 's')

	let is_open = ui.dropdown(calendar_id, null, this.nav.want_dropdown_open)
	if (!is_open && ui.focus_inside(picker_id))
		ui.focus(id)
	let opened = ui.dropdown_opened(calendar_id)

		ui.stack(id, 1, 's', 's')
			ui.bb('input', 'focused', 'b', 'light')
			ui.h(0, ui.sp05())
				ui.p(pad_l, 0, 0, 0)
				ui.text_h(h)
				ui.icon(calendar_id, 'calendar', 0)
				ui.p(0, 0, pad_r, 0)
				ui.text_editable(id, v, 1, align, 'c', null, this)
			ui.end_h()
		ui.end_stack()

	let resize_id = calendar_id+'.resizer'
	ui.dropdown_picker(calendar_id, 'b',
		align == 'right' ? 'cs' : 'cs', null,
		null, ui.state_of(resize_id, 'h'))

		if (is_open) {
			if (opened) {
				let day0 = isnum(v) ? day(v) : day(time())
				ui.state(picker_id).scroll_y =
					days(week(day0) - week(time())) / 7
					* snap(ui.em(2.5), 2)
			}
			// the calendar only moves v when the user moves the calendar:
			// it can't show a value that isn't a date, so it gives back the
			// null it was given.
			let day0 = isnum(v) ? day(v) : null
			ui.calendar(picker_id, day0, null)

			ui.resizer(resize_id, 'b')
		}

	ui.end_dropdown(calendar_id)

	ui.end_popup()
}

date.editor_value = function(id, v) {
	let day = ui.input_value(id+'.calendar.picker')
	return day !== undefined ? day : v
}

let bool = ui.field_types.bool

bool.build_null = function(mode) {
	if (mode) {
		// let text_font = cx.text_font
		// cx.text_font = cx.icon_font
		// all_field_types.build.call(this, '\uf0c8', cx)
		// cx.text_font = text_font
		// return true
	}
}

// an editable cell shows the box so that it reads as something to click,
// a readonly one only marks the true ones.
bool.build = function(v, mode, fg, row, full_width, align) {
	if (!isbool(v))
		return bool.build_null.call(this, mode)
	if (!mode)
		return v ? S('true', 'true') : S('false', 'false')
	let icon =
		row && this.nav.can_change_val(row, this)
			? (v ? 'box_checked' : 'box_unchecked')
			: (v ? 'check' : null)
	if (icon) {
		ui.color(fg)
		ui.icon('', icon, 0, align, 'c')
	}
}

// enums ---------------------------------------------------------------------

let enm = ui.field_types.enum
assign(enm, dropdown_editor)

enm.edits_in_popup = true

// a dropdown over enum_values, up for as long as the edit is: the cell keeps
// building its own value under it and there is no closed state.
enm.build_editor = function(id, v, pad_l, pad_r, h, align) {

	assert(this.enum_values != null, this.name, ': enum col with no enum_values')

	let picker_id = id+'.picker'

	// the list is up for as long as the edit is. anchored on the side v is
	// aligned to, so v stays put when the list makes the popup wider than
	// the cell.
	ui.focusable(id)
	let open = ui.dropdown(id, null, this.nav.want_dropdown_open)

		if (open) {
			ui.p(pad_l, 0, pad_r, 0)
			ui.min_h(h)
			ui.stack('', 0)
				this.build(v, true, null, null, null, align)
			ui.end_stack()
		}

	ui.dropdown_picker(id, 'b', align == 'right' ? ']s' : '[s')

		if (open) {
			let vals = words(this.enum_values) // 'v1 ...' or ['v1', ...]
			ui.list(picker_id, vals, v, this,
				0, 's', 's', align, 'c', 0,
				null, pad_l, pad_r, 0, h)
		}

	ui.end_dropdown(id)
}

enm.editor_value = function(id, v) {
	let value = ui.value(id+'.picker')
	if (value == null)
		return v
	return value
}

// lookup dropdowns ----------------------------------------------------------

// editor for a field with a lookup nav, assigned by init_field: a lookup can
// be on a field of any type, so it can't be a field type of its own.
let lookup_editor = assign({}, dropdown_editor)

lookup_editor.edits_in_popup = true

// the lookup nav's field whose value this field stores. multi-col lookups
// have no single value to pick, so they have none.
function lookup_val_field(field, ln = field.lookup_nav) {
	let col = field.lookup_cols || ln.pk
	if (col == null || col.includes(' ')) return
	return ln.optfld(col)
}

function can_pick_lookup_val(field, ln = field.lookup_nav) {
	return ln.ready
		&& lookup_val_field(field, ln)
		&& lookup_display_field(field, ln)
}

function type_editor(field) {
	return ui.field_types[field.type] || empty
}

lookup_editor.build_editor = function(id, v, pad_l, pad_r, h, align) {

	if (!can_pick_lookup_val(this)) {
		let f = type_editor(this).build_editor || ui.all_field_types.build_editor
		f.call(this, id, v, pad_l, pad_r, h, align)
		return
	}

	let ln = this.lookup_nav
	let picker_id = id+'.picker'

	ui.focusable(id)
	let open = ui.dropdown(id, null, this.nav.want_dropdown_open)

	ui.dropdown_picker(id, 'b')

		if (open) {
			let ln_row = this.nav.lookup_val(this.nav.focused_row, this, v)
			ui.grid(picker_id, {nav: ln, value: ln_row ?? null,
				max_w: ui.popup_max_w(), max_h: ui.em(12), resizable: true},
				0, 's', 's')
		}

	ui.end_dropdown(id)
}

lookup_editor.editor_value = function(id, v) {
	if (!can_pick_lookup_val(this)) {
		let f = type_editor(this).editor_value
		return f ? f.call(this, id, v) : v
	}
	let ln_row = ui.input_value(id+'.picker')
	if (ln_row === undefined)
		return v
	let ln = this.lookup_nav
	return ln_row ? ln.cell_val(ln_row, lookup_val_field(this)) : null
}

lookup_editor.open_dropdown = function(id) {
	if (!can_pick_lookup_val(this))
		return
	ui.set_dropdown_open(id, true)
}

lookup_editor.close_dropdown = function(id) {
	if (!can_pick_lookup_val(this))
		return
	ui.set_dropdown_open(id, false)
}

lookup_editor.toggle_dropdown = function(id) {
	if (!can_pick_lookup_val(this))
		return
	ui.set_dropdown_open(id, !ui.dropdown_open(id))
}

lookup_editor.dropdown_open = function(id) {
	if (!can_pick_lookup_val(this))
		return
	return ui.dropdown_open(id)
}

lookup_editor.dropdown_closed = function(id) {
	if (!can_pick_lookup_val(this))
		return
	return ui.dropdown_closed(id)
}

lookup_editor.dropdown_picked = function(id) {
	if (!can_pick_lookup_val(this))
		return
	return ui.dropdown_picked(id)
}

// colors --------------------------------------------------------------------

let color = ui.field_types.color
assign(color, dropdown_editor)

color.build = function(v, mode) {
	if (!mode)
		return v
	ui.m(ui.sp1(), 0)
	ui.min_h(ui.em(1))
	ui.stack('', 0, 's', 'c')
		ui.bb(':' + v)
	ui.end_stack()
}

color.edits_in_popup = true

color.editor_value = function(id, v) {
	let hex = ui.input_value(id+'.picker')
	return hex !== undefined ? hex : v
}

// a color_picker over v's hex, with a Pick/Cancel row under it: v only
// changes when Pick is clicked, with whatever hex the picker last returned.
color.build_editor = function(id, v, pad_l, pad_r, h) {

	let picker_id = id+'.picker'

	ui.focusable(id)
	let open = ui.dropdown(id, null, this.nav.want_dropdown_open)

	let resize_id = id+'.resizer'
	ui.dropdown_picker(id, 'b', null, null,
		ui.state_of(resize_id, 'w') ?? ui.em(22))

		if (open) {
			ui.p(ui.sp2())
			ui.v(0, ui.sp1())
				ui.color_picker(picker_id, v, this)
				ui.h(0, ui.sp05(), 'r')
					ui.default_button(id+'.pick')
					ui.primary_button(id+'.pick', S('pick', 'Pick'), 0)
					ui.button(id+'.cancel', S('cancel', 'Cancel'), 0)
				ui.end_h()
			ui.end_v()
			ui.resizer(resize_id, 'r')
		}

	ui.end_dropdown(id)
}

let percent = ui.field_types.percent

percent.build = function(p, mode, fg, row, full_width, align) {
	let s = this.to_text(p)
	if (!mode)
		return s
	let f = clamp(p / this.scale / 100, 0, 1)
	ui.stack('', 0, 's', 'c')
		ui.h(0, 0, 's', 's')
			ui.stack('', f, 's', 's')
				ui.bb('bg3')
			ui.end_stack()
			ui.stack('', 1 - f, 's', 's')
				ui.bb('bg0')
			ui.end_stack()
		ui.end_h()
		this.build_text(s, mode, fg, row, full_width, align)
	ui.end_stack()
}

// icons ---------------------------------------------------------------------

let icon = ui.field_types.icon

icon.build = function(v, mode, fg, row, full_width, align) {
	if (!mode)
		return this.to_text(v)
	ui.color(fg)
	ui.icon('', v, 0, align, 'c')
}

let place = ui.field_types.place

// place vals are {place_id:, description:} or a plain description string.
place.build = function(v, mode, fg, row, full_width, align) {
	let place_id = isobject(v) && v.place_id
	let descr = isobject(v) ? v.description : v || ''
	if (!mode)
		return descr
	ui.color(place_id ? 'text' : 'label')
	ui.h(0, ui.sp05())
		ui.color(fg)
		ui.icon('', 'map_pin', 0, align, 'c')
		this.build_text(descr, mode, fg, row, full_width, align)
	ui.end_h()
}

// buttons -------------------------------------------------------------------

let btn = ui.field_types.button

// TODO: btn.build, and btn.click calling field.action(v, row, field).
btn.build = function(v, mode) {
	// TODO
}

btn.click = function() {
	// TODO
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
		let ln_row = ui.input_value(id+'.picker')
		if (ln_row !== undefined)
			s.input_value = ln_row
				? ln.cell_val(ln_row, lookup_val_field(field, ln)) : null
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
	let ln_row = ln.ready && value != null && val_field && display_field
		&& ln.lookup(val_field.name, [value])[0]
	let text
	if (!ln.ready) {
		text = S('loading', 'loading...')
	} else if (value == null) {
		text = null
	} else if (ln_row) {
		let display_v = ln.cell_val(ln_row, display_field)
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
			ui.grid(picker_id, {nav: ln, value: ln_row || null,
				max_w: ui.popup_max_w(), max_h: ui.em(12), resizable: true},
				0, 's', 's')
		}

	ui.end_dropdown(id)

	ui.end_stack()

	return value
}

//// RELOAD PUSH NOTIFICATIONS -----------------------------------------------

let rowset_navs = ui.rowset_navs = {} // {rowset_name -> set(nav)}

let init_rowset_events = memoize(function() {
	let es = new EventSource('/xrowset.events')
	es.onmessage = function(ev) {
		let a = words(ev.data)
		let [rowset_name, filter] = words(a.shift().replaceAll(':', ' '))
		let navs = rowset_navs[rowset_name]
		if (navs)
			for (let nav of navs)
				nav.reload({allow_diff_merge: true, update_ids: a, if_filter: filter})
	}
})


}()) // module function
