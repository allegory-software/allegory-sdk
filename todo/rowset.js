
/* rowset --------------------------------------------------------------------

A rowset is an in-memory table with typed columns and rows. It can come from
a http server as JSON, defined in HTML with the <rowset> tag, or constructed
in JS.

Rowset structure:

{
	fields : [{name:, FIELD_ATTR: VAL}, ...],  // array of field definitions.
	rows   : [[v1, v2, ...], ...],             // array of rows, values in field order.
	ROWSET_ATTR: VAL,                          // rowset attributes, see below.
}

HTML rowsets:

	<rowset pk=... ROWSET_ATTR=VAL ...>
		<field name=COL ATTR=VAL ...></field>
		<row COL=VAL ...></row>
	</rowset>

	NOTE: use `:id` for the `id` column!

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
	rowset        window.rowset_col_attrs['ROWSET.COL'] = {ATTR: VAL}
	rowset        e.rowset.fields = [{ATTR: VAL},...]
	field type    window.field_types[TYPE] = {ATTR: VAL}
	global        window.all_field_types[ATTR] = VAL

Field attributes:

	identification:

		name           : field name (defaults to field's numeric index)
		type           : for choosing a field preset: number, bool, etc.

	rendering:

		label          : field name for display purposes (auto-generated default).
		internal       : field cannot be made visible in a grid (false).
		hidden         : field is hidden by default but can be made visible (false).
		w              : field's width.
		min_w          : field's minimum width, in pixels.
		max_w          : field's maximum width, in pixels.

	navigation:

		focusable      : field can be focused (true).

	editing:

		client_default : default value/generator that new rows are initialized with.
		default        : default value that the server sets for new rows.
		readonly       : prevent editing.
		editor         : f({nav:, col:, embedded: t|f}) -> editor instance

		enum_values    : enum type: 'v1 ...' | ['v1', ...]
		enum_texts     : enum type: {v->text}
		enum_info      : enum type: {v->info}

	validation:

		not_null       : don't allow null (false).
		required       : don't allow null (false).
		maxlen         : max text length (256).

		min            : min value (0).
		max            : max value (inf).
		decimals       : max number of decimals (0).

	formatting:

		draw           : f(v, cx, [row]) -> true  draw value on 2d canvas context.
		draw           : f(v, pe, [row]) -> true  render value into parent element.
		draw           : f(v    , [row]) -> s     return plain text display value.

		draw_text      : f(s, [cx|pe], [row]) -> true|s   draw/render plain text.
		draw_null      : f([cx|pe], [row]) -> true|s      draw/render plain text.

		align          : 'left'|'right'|'center'
		attr           : custom value for html attribute `field`, for styling
		null_text      : plain text display value for null
		empty_text     : plain text display value for ''

		filesize_magnitude : filesize type, see kbytes()
		filesize_decimals  : filesize type, see kbytes()
		filesize_min       : filesize type, see kbytes()

		precision      : date, datetime, time, timeofday types

		duration_format: see duration() in glue.js

		button_options : button type: options to pass to button()

		format         : value format when saving it as json (date/time types, etc.)

	vlookup:

		lookup_rowset[_name|_url]: rowset to look up values of this field into.
		lookup_nav     : nav to look up values of this field into.
		lookup_nav_id  : nav id for creating lookup_nav.
		lookup_cols    : field(s) in lookup_nav that matches this field.
		display_col    : field in lookup_nav to use as display value of this field.
		null_lookup_col: field in nav to use as default value for nulls in this field.

	sorting:

		sortable       : allow sorting (true).
		compare_types  : f(v1, v2) -> -1|0|1  (for sorting)
		compare_vals   : f(v1, v2) -> -1|0|1  (for sorting and setting values)


Rowset state:

	e.fields_map[col] -> field
	e.fields[fi] -> field
	e.rows[ri] -> row

Row state:

	row.focusable      : row can be focused (true).
	row.can_change     : allow changing (true).
	row.can_remove     : allow removing (true).
	row.nosave         : row is not to be saved.
	row.is_new         : new row, not added on server yet.
	row.modified       : one or more row cells were modified (valid or not).
	row.removed        : row is marked for removal, not removed on server yet.
	row.errors         : [err1,...] row-level validation results. undefined if not validated yet.
	row.invalid        : row has cell and/or row errors.

Cell state:

	row[i]             : cell value as last seen on the server (always valid).
	row[input_val_i]   : modified cell value, valid or not.
	row[errors_i]      : [err1,...]; validation results.
	row[#all_fields]   : row index.

Getting cell state:

	e.cell_state(row, col, key, [default_val])
	e.cell_val(row, col) -> v
	e.cell_vals(row, cols) -> [v1,...]
	e.cell_input_val(row, col) -> iv
	e.cell_errors(row, col) -> [e1,...]
	e.cell_has_errors(row, col) -> t|f
	e.cell_modified(row, col) -> t|f

Setting row state:

	e.begin_set_state(row)
		e.set_cell_state(col, val, default_val)
		e.set_cell_val(row, col, val)
		e.reset_cell_val(row, col, val)
		e.revert_cell(row, col)
		e.set_row_state(key, val, default_val)
	e.end_set_state()
	e.revert_row()

	calls:
		e.do_update_row_state(ri, changes, ev)
		e.do_update_cell_state(ri, fi, key, val, ev)
		e.do_update_cell_editing(ri, [fi], editing)
		e.validate_row(row)
		e.validate_cell(field, val)
	announces:
		^^cell_state_changed(row, field, changes, ev)
		^^row_state_changed(row, changes, ev)
		^^focused_row_cell_state_changed(row, field, changes, ev)
		^^focused_row_state_changed(row, changes, ev)

Indexing:

	e.tree_index(cols, [range_defs], [rows]) -> ix
	ix.tree() -> index_tree
	ix.lookup(vals) -> [row1,...]
	e.lookup(cols, vals, [range_defs]) -> [row1, ...]

Grouping:

	e.row_groups({col_groups:, [range_defs:], [rows:], [group_label_sep:]}) -> [row1, ...]

Master-detail:
	needs:
		e.params <- 'param1[=master_col1] ...'
		e.param_nav
		e.param_nav_id

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
		e.editor
		e.enter_edit([editor_state], [focus])
		e.exit_edit([{cancel: true}])
		e.exit_row([{cancel: true}])
	calls:
		e.create_editor()
		e.do_cell_click(ri, fi)

Loading from server:
	needs:
		e.rowset_name
		e.rowset_url
	publishes:
		e.reload()
		e.abort_loading()
	calls:
		e.do_update_loading()
		e.do_update_load_progress()
		e.do_update_load_slow()
		e.do_update_load_fail()
		e.load_overlay(on)
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
		action_band_visible : auto      : auto | always | no
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

--------------------------------------------------------------------------- */

(function () {
"use strict"
let G = window
let e = Element.prototype

css('.nav-loading-overlay', 'p')
css('.nav-loading-overlay.error', 'bg-smoke')

css('.nav-loading-overlay-message', 'p-2 shadow-tooltip bg1')

css('.nav-loading-overlay-message .btn', '', `
	line-height: 1;
`)

css('.nav-loading-overlay-detail', 'mono m-y')

css('.loading-error-icon', 'm-x fg-error')

G.field_types = obj() // {TYPE->{K: V}}
G.all_field_types = obj() // {K: V}
G.rowset_col_attrs = obj() // {ROWSET.COL->{K:V}}

function map_keys_different(m1, m2) {
	if (m1.size != m2.size)
		return true
	for (let k1 of m1.keys())
		if (!m2.has(k1))
			return true
	return false
}

// ref-counted garbage-collected shared bare navs for lookup rowsets.
{
let max_unused_nav_count = 20
let max_unused_row_count =  1000000
let max_unused_val_count = 10000000

let shared_navs = obj() // {name: nav}

let gclist = []
let oldest_last = function(nav1, nav2) {
	let t1 = nav1.last_used_time
	let t2 = nav2.last_used_time
	return t1 == t2 ? 0 : (t1 < t2 ? 1 : -1) // reverse order
}
let gc = function() {
	gclist.clear()
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

			delete shared_navs[name]
			nav.del()

			nav_count -= 1
			row_count -= nav.all_rows.length
			val_count -= nav.all_rows.length * nav.all_fields.length
		}
	}
}

let prefix = (p, s) => s ? p + ':' + s : null

G.shared_nav = function(id, opt) {

	let name = prefix('id', id)
		|| prefix('rowset_name', opt.rowset_name)
		|| prefix('rowset_url', opt.rowset_url)

	if (!name) { // anonymous i.e. not shareable
		let ln = bare_nav(opt)
		ln.ref = function() { head.add(this) }
		ln.unref = function() { this.del() }
		return ln
	}

	let ln = shared_navs[name]
	if (!ln) {
		if (id) {
			ln = element({id: id})
			ln.id = null // not saving prop vals into the original.
		} else {
			ln = bare_nav(opt)
		}
		ln.rc = 0
		ln.ref = function() {
			if (!this.rc++) // jshint ignore:line
				if (!this.parent) {
					gc()
					head.add(this)
				}
		}
		ln.unref = function() {
			if (!--this.rc)
				this.last_used_time = time()
		}
		shared_navs[name] = ln
	}
	return ln
}

G.shared_navs = shared_navs // for debugging

} //shared nav scope

let rowset_attr_parse = {
	pk              : return_arg,
	can_add_rows    : bool_attr,
	can_remove_rows : bool_attr,
	can_change_rows : bool_attr,
	name_col : return_arg,
}

let field_attr_parse = {
	name     : return_arg,
	label    : return_arg,
	type     : return_arg,
	placeholder : return_arg,
	enum_values : return_arg,
	decimals : num,
	min      : return_arg, // parsing this depends on type
	max      : return_arg, // parsing this depends on type
	max_len  : num,
	min_len  : num,
	from     : num,
	to       : num,
	w        : num,
	min_w    : num,
	max_w    : num,
	precision: return_arg,
	not_null : bool_attr,
	required : bool_attr,
	sortable : bool_attr,
	maxlen   : num,
	lookup_rowset: return_arg,
	lookup_nav: return_arg,
}

let field_attr_map = {
	lookup_rowset : 'lookup_rowset_name',
}

function parse_text_attrs(t, parse) {
	let dt = obj()
	for (let k in t) {
		let uk = k.replace('-', '_')
		let v = t[k] ?? t[uk]
		assert(uk in parse, 'html attr parser missing for {0}', uk)
		v = parse[uk](v)
		let fk = field_attr_map[uk] || uk
		dt[fk] = v
	}
	return dt
}

function parse_field_attrs(field_attrs) {
	return parse_text_attrs(field_attrs, field_attr_parse)
}

css('rowset', 'skip')

component('rowset', function(e) {
	let fields = []
	let row_vals = []
	let rt = e.attrs; delete rt.id
	e.rowset = parse_text_attrs(rt, rowset_attr_parse)
	e.rowset.fields = fields
	e.rowset.row_vals = row_vals
	let cols = obj() // {name->true}
	for (let field_tag of e.$(':scope>field')) {
		let field = parse_field_attrs(field_tag.attrs)
		let field_index = fields.length
		if (field.name) {
			cols[field.name] = true
			fields.push(field)
		} else {
			warn('<field name=?> missing')
		}
	}
	for (let row_tag of e.$(':scope>row')) {
		let t = row_tag.attrs
		if (':id' in t) { t.id = t[':id']; delete t[':id']; }
		for (let k in t)
			warn_if(!cols[k], '<row> unknown field', k)
		if (row_tag.len)
			for (let val_tag of row_tag.$(':scope>val')) {
				let col = val_tag.attr('for')
				warn_if(!col, '<val for=?> missing')
				warn_if(!cols[col], '<val> unknown field', col)
				warn_if(col in t, '<val> overrides <row> value for', col)
				t[col] = val_tag.html
			}
		row_vals.push(t)
	}
	e.clear()
})

function nav_ajax(opt) {
	let rowset_tag = window['rowset_'+opt.rowset_name]
	if (rowset_tag) // html rowset
		opt.xhr = {
			wait: opt.wait,
			response: rowset_tag.rowset,
		}
	return ajax(opt)
}

let errors_no_messages = []
errors_no_messages.failed = true
errors_no_messages.client_side = true

e.make_nav_widget = function() {
	let e = this
	e.isnav = true
	e.make_disablable()

	e.prop('can_add_rows'            , {type: 'bool', default: true})
	e.prop('can_remove_rows'         , {type: 'bool', default: true})
	e.prop('can_change_rows'         , {type: 'bool', default: true})
	e.prop('can_move_rows'           , {type: 'bool', default: false})
	e.prop('can_sort_rows'           , {type: 'bool', default: true})
	e.prop('can_focus_cells'         , {type: 'bool', default: true , hint: 'allow focusing individual cells vs entire rows'})
	e.prop('can_select_multiple'     , {type: 'bool', default: true , hint: 'allow selecting multiple cells or rows'})
	e.prop('can_select_non_siblings' , {type: 'bool', default: true , hint: 'allow multi-selecting rows of different parents'})

	e.prop('auto_advance_row'        , {type: 'bool', default: false, hint: 'jump row on horizontal navigation limits'})
	e.prop('auto_focus_first_cell'   , {type: 'bool', default: true , hint: 'focus first cell automatically after loading'})
	e.prop('auto_edit_first_cell'    , {type: 'bool', default: false, hint: 'automatically enter edit mode after loading'})
	e.prop('stay_in_edit_mode'       , {type: 'bool', default: true , hint: 're-enter edit mode after navigating'})

	e.prop('save_on_add_row'         , {type: 'bool', default: false})
	e.prop('save_on_remove_row'      , {type: 'bool', default: true })
	e.prop('save_on_input'           , {type: 'bool', default: false})
	e.prop('save_on_exit_edit'       , {type: 'bool', default: false})
	e.prop('save_on_exit_row'        , {type: 'bool', default: true })

	e.prop('exit_edit_on_lost_focus' , {type: 'bool', default: false, hint: 'exit edit mode when losing focus'})
	e.prop('save_row_states'         , {type: 'bool', default: false, hint: 'static rowset only: save row states or just the values'})
	e.prop('action_band_visible'     , {type: 'enum', enum_values: 'auto always no', default: 'auto', to_attr: true, slot: 'user'})

	e.debug_anon_name = () => catany('', e.tag, catall(':', e.rowset_name))

	// init -------------------------------------------------------------------

	let rowset_tag = e.$1(':scope>rowset')
	if (rowset_tag) {
		rowset_tag.init_component()
		e.rowset = rowset_tag.rowset
		rowset_tag.remove()
	}

	for (let field_tag of e.$(':scope>col-attrs')) {
		let t = field_tag.attrs
		let col = t['for']; delete t['for']
		t = parse_field_attrs(t)
		if (col)
			attr(e, 'html_col_attrs')[col] = t
		else
			warn('<col-attrs for=COL ...> COL missing')
		field_tag.remove()
	}

	e.ready = false

	e.do_after('init', function() {
		if (e.dropdown)
			e.init_as_picker()
	})

	function init_all() {
		e.changed_rows = null // set(row)
		rows_moved = false
		init_row_validators()
		init_all_fields()
	}

	e.on_bind(function nav_bind(on) {
		bind_param_nav(on)
		bind_rowset_name(e.rowset_name, on)
		if (on) {
			init_param_vals()
			e.reload()
			e.update_action_band()
		} else {
			e.ready = false
			e.announce('ready', false)
			abort_all_requests()
			e.unfocus_focused_cell({cancel: true})
			init_all()
			e.announce('reset')
			disable_all(false)
		}
	})

	e.set_static_rowset = function(rs) {
		e.rowset = rs
		e.reload()
	}
	e.prop('static_rowset', {})

	e.set_row_vals = function() {
		if (save_barrier) return
		e.reload()
	}
	e.prop('row_vals', {slot: 'app'})

	e.set_row_states = function() {
		if (save_barrier) return
		e.reload()
	}
	e.prop('row_states', {slot: 'app'})

	function bind_rowset_name(name, on) {
		if (!name)
			return
		if (on) {
			init_rowset_events()
			attr(rowset_navs, name, set).add(e)
		} else {
			let navs = rowset_navs[name]
			if (navs) {
				navs.delete(e)
				if (!navs.size)
					delete rowset_navs[name]
			}
		}
	}

	e.set_rowset_name = function(v1, v0) {
		bind_rowset_name(v0, false)
		bind_rowset_name(v1, true)
		e.rowset_url = v1 ? '/rowset.json/' + v1 : null
		e.reload()
	}
	e.prop('rowset_name', {type: 'rowset', attr: 'rowset'})

	// fields utils -----------------------------------------------------------

	let fld = function(col) {
		if (isstr(col))
			return assert(e.all_fields_map[col], '{0} has no col: {1}', e.debug_name, col)
		else if (isnum(col))
			return assert(e.all_fields[col], '{0} has no col: {1}', e.debug_name, col)
		else
			return col
	}
	let optfld  = function(col) {
		if (isstr(col))
			return e.all_fields_map[col]
		else if (isnum(col))
			return e.all_fields[col]
		else
			return col
	}
	let fldname = col => fld(col).name

	function flds(cols) {
		let fields = cols && words(cols).map(fld)
		assert(fields && fields.length, '{0} has no cols: {1}', e.id, cols || '')
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

	e.fld = fld
	e.flds = flds
	e.optfld = optfld
	e.optflds = optflds

	// fields array matching 1:1 to row contents ------------------------------

	let ifa = obj() // init-field-attr: {field->f(field, v)}

	ifa.label = function(field, v) {
		if (v == null) {
			let name = field.given_name || field.name
			v = name && name.display_name()
		}
		field.label = v
	}

	ifa.exclude_vals = function(field, v) {
		if (v == null) return
		set_exclude_filter(field, v)
	}

	ifa.enum_values = function(field, v) {
		if (v == null) {
			if (field.known_values)
				field.known_values = null
			return
		}
		field.known_values = set(words(v))
	}

	function init_field_attrs(field, f) {

		let name = field.given_name || field.name
		let pt = e.prop_col_attrs && e.prop_col_attrs[name]
		let ht = e.html_col_attrs && e.html_col_attrs[name]
		let ct = e.col_attrs && e.col_attrs[name]
		let rt = e.rowset_name && rowset_col_attrs[e.rowset_name+'.'+name]
		let type = rt && rt.type || ht && ht.type || ct && ct.type || f.type
		let tt = field_types[type]
		let att = all_field_types

		assign_opt(field, att, tt, f, rt, ct, ht, pt)

		for (let k in ifa)
			ifa[k](field, field[k])

	}

	function set_field_attr(field, k, v) {

		let f = e.rowset.fields[field.val_index]

		if (v === undefined) {

			let name = field.given_name || field.name
			let ht = e.html_col_attrs && e.html_col_attrs[name]
			let ct = e.col_attrs && e.col_attrs[name]
			let rt = e.rowset_name && rowset_col_attrs[e.rowset_name+'.'+name]
			let type = f.type || (ct && ct.type) || (rt && rt.type)
			let tt = type && field_types[type]
			let att = all_field_types

			v = ht && ht[k]
			v = strict_or(v, ct && ct[k])
			v = strict_or(v, rt)
			v = strict_or(v, f[k])
			v = strict_or(v, tt && tt[k])
			v = strict_or(v, att[k])
		}

		if (field[k] === v)
			return

		field[k] = v

		let init = ifa[k]
		if (init)
			init(field, v)

	}

	function e_announce(...args) {
		e.announce(...args)
	}

	function init_field(f, fi) {

		let field = obj()

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

		init_field_attrs(field, f)

		e.all_fields[fi] = field
		e.all_fields_map[name] = field

		init_field_own_lookup_nav(field)
		bind_lookup_nav(field, true)

		if (field.timeago)
			e.bool_attr('has-timeago', true)

		field.announce = e_announce

		return field
	}

	function free_field(field) {
		if (field.editor_instance)
			field.editor_instance.del()
		bind_lookup_nav(field, false)
		free_field_own_lookup_nav(field)
	}

	e.add_field = function(f) {
		let fn = e.all_fields.length
		let field = init_field(f, fn)
		for (let ri = 0; ri < e.all_rows.length; ri++) {
			let row = e.all_rows[ri]
			// append a val slot to the row.
			row.splice(fn, 0, null)
			// append a slot into all cell_state sub-arrays of the row.
			fn++
			for (let i = 2 * fn; i < row.length; i += fn)
				row.splice(i, 0, null)
		}
		init_field_validator(field)
		init_fields()
		e.update({fields: true})
		return field
	}

	e.remove_field = function(field) {
		free_field(field)
		let fi = field.val_index
		e.all_fields.remove(fi)
		delete e.all_fields_map[field.name]
		for (let i = fi; i < e.all_fields.length; i++)
			e.all_fields[i].val_index = i
		let fn = e.all_fields.length
		for (let row of e.all_rows) {
			// remove the val slot of the row.
			row.splice(fi, 1)
			// remove all cell_state slots of the row for this field.
			for (let i = fn + 1 + fi; i < row.length; i += fn)
				row.splice(i, 1)
		}
		init_fields()
		e.update({fields: true})
	}

	function check_field(which, col) {
		if (col == null) return
		if (!e.bound) return
		if (!e.ready) return
		let field = e.optfld(col)
		if (!field)
			warn(which+' "'+col+'" not in rowset "'+e.rowset_name+'"')
		return field
	}

	function init_all_fields() {

		if (e.all_fields)
			for (let field of e.all_fields)
				free_field(field)

		e.all_fields = [] // fields in row value order.
		e.all_fields_map = obj() // {col->field}

		// not creating fields and rows unless bound because we don't get
		// events while not attached to DOM so the nav might get stale.
		let rs = e.bound && e.rowset || empty
		e.ready = rs != empty

		if (rs.fields)
			for (let fi = 0; fi < rs.fields.length; fi++)
				init_field(rs.fields[fi], fi)

		e.pk = isarray(rs.pk) ? rs.pk.join(' ') : rs.pk
		e.pk_fields = optflds(e.pk)
		init_find_row()
		e.val_field = check_field('val_col', e.val_col)
		e.pos_field = check_field('pos_col', rs.pos_col)
		e.name_field = check_field('name_col', e.name_col ?? rs.name_col)
		if (!e.name_field && e.pk_fields && e.pk_fields.length == 1)
			e.name_field = e.pk_fields[0]
		e.display_field = check_field('display_col', e.display_col) || e.name_field
		e.quicksearch_field = check_field('quicksearch_col', e.quicksearch_col)

		init_tree_fields()

		for (let field of e.all_fields)
			init_field_validator(field)

		init_all_rows()
		init_tree()

		init_fields()
		init_rows()

		if (e.ready)
			e.announce('ready', true)
	}

	function init_tree_fields() {
		let rs = e.bound && e.rowset || empty
		e.id_field = check_field('id_col', rs.id_col)
		if (!e.id_field && e.pk_fields && e.pk_fields.length == 1)
			e.id_field = e.pk_fields[0]
		e.parent_field = check_field('parent_col', rs.parent_col)
		e.tree_field = check_field('tree_col', e.tree_col ?? rs.tree_col) || e.name_field
		if (!e.id_field || !e.parent_field || !e.tree_field || e.tree_field.hidden)
			reset_tree_fields()
	}

	function reset_tree_fields() {
		e.id_field = null
		e.parent_field = null
		e.tree_field = null
	}

	function reset_tree() {
		reset_tree_fields()
		if (e.is_tree) {
			for (let row of e.all_rows) {
				row.child_rows = null
				row.parent_rows = null
				row.parent_row = null
			}
			e.child_rows = null
			e.is_tree = false
		}
	}

	function flat_changed() {
		if (!e.bound) return
		reset_tree()
		init_tree_fields()
		init_tree()
		init_rows()
		e.update({rows: true})
	}

	e.set_flat = flat_changed
	e.prop('flat', {type: 'bool', slot: 'user', default: false})

	e.set_must_be_flat = flat_changed
	e.prop('must_be_flat', {default: false, private: true})

	// `*_col` properties

	e.set_val_col = function(v) {
		if (!e.bound) return
		init_all_fields()
	}
	e.prop('val_col', {type: 'col'})

	e.set_tree_col = function() {
		if (!e.bound) return
		init_all_fields()
	}
	e.prop('tree_col', {type: 'col'})

	e.set_name_col = function(v) {
		if (!e.bound) return
		init_all_fields()
	}
	e.prop('name_col', {type: 'col'})

	e.set_quicksearch_col = function(v) {
		if (!e.bound) return
		e.quicksearch_field = check_field('quicksearch_col', v)
		reset_quicksearch()
		e.update({state: true})
	}
	e.prop('quicksearch_col', {type: 'col'})

	// field attributes exposed as `col.*` props

	e.get_col_attr = function(col, k) {
		return e.prop_col_attrs && e.prop_col_attrs[col] && e.prop_col_attrs[col][k]
	}

	e.set_col_attr = function(col, k, v) {
		let v0 = e.get_col_attr(col, k)
		if (v === v0)
			return
		attr(attr(e, 'prop_col_attrs'), col)[k] = v

		let field = e.all_fields_map[col]
		if (field) {
			set_field_attr(field, k, v)
			e.update({fields: true})
		}

		e.announce('field_changed', field, k, v)

		let attrs = field_prop_attrs[k]
		if (e._xoff) {
			attr(field_prop_attrs, k).default = v
		} else {
			let slot = attrs && attrs.slot
			let prop = 'col.' + col + '.' + k
			e.prop_changed(prop, v, v0, slot)
		}
	}

	function parse_col_prop_name(prop) {
		let [_, col, k] = prop.match(/^col\.([^\.]+)\.(.*)/)
		return [col, k]
	}

	e.get_prop = function(prop) {
		if (prop.starts('col.')) {
			let [col, k] = parse_col_prop_name(prop)
			return e.get_col_attr(col, k)
		}
		return e[prop]
	}

	e.set_prop = function(prop, v) {
		if (prop.starts('col.')) {
			let [col, k] = parse_col_prop_name(prop)
			e.set_col_attr(col, k, v)
			return
		}
		e[prop] = v
	}

	e.get_props = function() {
		let t = obj()
		for (let k in e.props)
			t[k] = true
		for (let f of e.fields)
			t['col.'+f.name] = true
		return t
	}

	e.get_prop_attrs = function(prop) {
		if (prop.starts('col.')) {
			let [col, k] = parse_col_prop_name(prop)
			return field_prop_attrs[k]
		}
		return e.props[prop]
	}

	// all_fields subset in custom order --------------------------------------

	function init_fields() {
		e.fields = []
		if (e.all_fields.length)
			for (let col of cols_array()) {
				let field = check_field('col', col)
				if (field && !field.internal)
					e.fields.push(field)
			}
		update_field_index()
		update_field_sort_order()

		// remove references to invisible fields.
		if (e.focused_field && e.focused_field.index == null)
			e.focused_field = null
		if (e.selected_field && e.selected_field.index == null)
			e.selected_field = null
		let lff = e.all_fields_map[e.last_focused_col]
		if (lff && lff.index == null)
			e.last_focused_col = null
		if (e.quicksearch_field && e.quicksearch_field.index == null)
			reset_quicksearch()
		if (e.selected_rows)
			for (let [row, sel_fields] of e.selected_rows)
				if (isobject(sel_fields))
					for (let field of sel_fields)
						if (field && field.index == null)
							sel_fields.delete(field)

	}

	e.field_index = function(field) {
		return field && field.index
	}

	function update_field_index() {
		for (let field of e.all_fields)
			field.index = null
		for (let i = 0; i < e.fields.length; i++)
			e.fields[i].index = i
	}

	// visible cols list ------------------------------------------------------

	e.set_cols = function() {
		e.exit_edit()
		init_fields()
		e.update({fields: true})
	}
	e.prop('cols', {slot: 'user'})

	function visible_col(col) {
		let field = check_field('col', col)
		return field && !field.internal
	}

	let user_cols = () =>
		e.cols != null &&
		e.cols.words().filter(function(col) {
			let f = e.all_fields_map[col]
			return f && !f.internal
		})

	let rowset_cols = () =>
		e.rowset && e.rowset.cols &&
		e.rowset.cols.words().filter(function(col) {
			let f = e.all_fields_map[col]
			return f && !f.internal
		})

	let all_cols = () =>
		e.all_fields.filter(function(f) {
			return !f.internal && !f.hidden
		}).map(f => f.name)

	let cols_array = function() {
		return user_cols() || rowset_cols() || all_cols()
	}

	function cols_from_array(cols) {
		cols = cols.join(' ')
		return cols == all_cols() ? null : cols
	}

	e.show_field = function(field, on, at_fi) {
		let cols = cols_array()
		if (on)
			cols.insert(min(at_fi || 1/0, e.fields.length), field.name)
		else
			cols.remove_value(field.name)
		e.cols = cols_from_array(cols)
	}

	e.move_field = function(fi, over_fi) {
		if (fi == over_fi)
			return
		let insert_fi = over_fi - (over_fi > fi ? 1 : 0)
		let cols = cols_array()
		let col = cols.remove(fi)
		cols.insert(insert_fi, col)
		e.cols = cols_from_array(cols)
		e.update({fields: true}) // in case cols haven't changed.
	}

	// param nav --------------------------------------------------------------

	function init_param_vals() {
		let pv0 = e.param_vals
		let pv1
		if (!e.params) {
			pv1 = null
		} else if (!(e.param_nav && e.param_nav.focused_row && !e.param_nav.focused_row.is_new)) {
			pv1 = false
		} else {
			pv1 = []
			let pmap = param_map(e.params)
			for (let [row] of e.param_nav.selected_rows) {
				let vals = obj()
				for (let [col, param] of pmap) {
					let field = e.param_nav.all_fields_map[col]
					if (!field)
						warn('param nav is missing col', col)
					let v = field && row ? e.param_nav.cell_val(row, field) : null
					vals[param] = v
				}
				pv1.push(vals)
			}
		}
		// check if new param vals are the same as the old ones to avoid
		// reloading the rowset if the params didn't really change.
		if (pv1 === pv0 || isarray(pv1) && isarray(pv0) && json(pv1) == json(pv0))
			return
		e.param_vals = pv1
		e.disable('no_param_vals', pv1 === false)
		e.announce('tabname_changed')
		e.announce('params_changed')
		return true
	}

	// A client_nav doesn't have a rowset binding. Instead, changes are saved
	// to either row_vals or row_states. Also, if it's a detail nav, it filters
	// itself based on param_vals since there's no server to ask for filtered rows.
	function is_client_nav() {
		return !e.rowset_url && (e.row_vals || e.row_states)
	}

	function params_changed() {
		if (!init_param_vals())
			return
		if (!e.rowset_url) { // re-filter and re-focus.
			e.unfocus_focused_cell({cancel: true})
			init_rows()
			e.update({rows: true})
			e.focus_cell()
		} else {
			e.reload()
		}
	}

	function param_nav_cell_state_changed(master_row, master_field, changes) {
		if (!('val' in changes))
			return

		if (is_client_nav()) { // cascade-update foreign keys.
			let field = fld(param_map(e.params).get(master_field.name))
			for (let row of e.all_rows)
				if (e.cell_val(row, field) === old_val)
					e.set_cell_val(row, field, val)
		} else {
			if (init_param_vals())
				e.reload()
		}
	}

	function param_vals_match(master_nav, e, params, master_row, row) {
		for (let [master_col, col] of params) {
			let master_field = master_nav.all_fields_map[master_col]
			let master_val = master_nav.cell_val(master_row, master_field)
			let field = e.all_fields_map[col]
			let val = e.cell_val(row, field)
			if (master_val !== val)
				return false
		}
		return true
	}

	function param_nav_row_removed_changed(master_row, removed) {
		if (is_client_nav()) { // cascade-remove detail rows.
			let params = param_map(e.params)
			for (let row of e.all_rows)
				if (param_vals_match(this, e, params, master_row, row)) {
					e.begin_set_state(row)
					e.set_row_state('removed', removed, false)
					e.end_set_state()
				}
		}
	}

	function bind_param_nav_cols(nav, params, on) {
		if (on && !e.bound)
			return
		if (!(nav && params))
			return
		nav.on('selected_rows_changed', params_changed, on)
		for (let [col, param] of param_map(params)) {
			// TODO:
			nav.on('cell_state_changed_for_'+col, param_nav_cell_state_changed, on)
		}
		// TODO: refactor this: use ^row_state_changed, etc !
		nav.on('row_removed_changed', param_nav_row_removed_changed, on)
	}

	function bind_param_nav(on) {
		bind_param_nav_cols(e.param_nav, e.params, on)
	}

	e.set_param_nav = function(nav1, nav0) {
		bind_param_nav_cols(nav0, e.params, false)
		bind_param_nav_cols(nav1, e.params, true)
		if (init_param_vals())
			e.reload()
	}
	e.prop('param_nav', {private: true})
	e.prop('param_nav_id', {bind_id: 'param_nav', type: 'nav',
			text: 'Param Nav', attr: 'param_nav'})

	e.set_params = function(params1, params0) {
		bind_param_nav_cols(e.param_nav, params0, false)
		bind_param_nav_cols(e.param_nav, params1, true)
		if (init_param_vals())
			e.reload()
	}
	e.prop('params')

	function param_map(params) {
		let m = map()
		for (let s of params.words()) {
			let p = s.split('=')
			let param = p && p[0] || s
			let col = p && (p[1] || p[0]) || param
			m.set(col, param)
		}
		return m
	}

	// tabname ----------------------------------------------------------------

	e.prop('tabname_template', {slot: 'lang', default: '{0}'})

	let tabname
	e.prop('tabname', {slot: 'lang'})

	e.set_tabname(
	function() {
		if (tabname)
			return tabname
		let view = e.param_vals && e.param_nav.selected_rows_tabname()
			|| e.rowset_name || 'Nav'
		return e.tabname_template.subst(view)
	}, function(s) {
		tabname = s
		e.announce('tabname_changed')
	})

	e.row_tabname = function(row) {
		return e.draw_row(row, div())
	}

	e.selected_rows_tabname = function() {
		if (!e.selected_rows)
			return S('no_rows_selected', 'No rows selected')
		let caps = []
		for (let [row, sel_fields] of e.selected_rows)
			caps.push(e.row_tabname(row))
		return caps.join(', ')
	}

	// all rows in load order -------------------------------------------------

	function free_all_rows() {
		if (e.all_rows && e.free_row)
			for (let row of e.all_rows)
				e.free_row(row)
		e.all_rows = null
	}

	// parse & validate cells & rows silently and without making too much
	// garbage and without getting the error messages, just the failed state.
	function validate_all_rows() {
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
	}

	function init_all_rows() {
		free_all_rows()
		e.do_update_load_fail(false)
		update_indices('invalidate')
		e.all_rows = e.bound && e.rowset && (
				   e.deserialize_all_row_states(e.row_states)
				|| e.deserialize_all_row_vals(e.row_vals)
				|| e.deserialize_all_row_vals(e.rowset.row_vals)
				|| e.rowset.rows
			) || []
		validate_all_rows()
	}

	// filtered and custom-sorted subset of all_rows --------------------------

	function init_rows() {
		e.focused_row = null
		e.selected_row = null
		e.selected_rows = map()
		reset_quicksearch()
		init_filters()
		e.rows = null
		sort_rows()
	}

	e.row_index = function(row) {
		return row && row[e.all_fields.length]
	}

	function update_row_index() {
		let index_fi = e.all_fields.length
		for (let i = 0; i < e.rows.length; i++)
			e.rows[i][index_fi] = i
	}

	function reinit_rows() {
		let fs = e.refocus_state('row')
		init_rows()
		e.update({rows: true})
		e.refocus(fs)
	}

	// editing utils ----------------------------------------------------------

	e.can_actually_add_rows = function() {
		return e.can_add_rows
			&& (!e.rowset || e.rowset.can_add_rows != false)
	}

	e.can_actually_remove_rows = function() {
		return e.can_remove_rows
			&& (!e.rowset || e.rowset.can_remove_rows != false)
	}

	e.can_change_val = function(row, field) {
		if (row) {
			if (row.removed)
				return false
			if (!row.is_new) {
				if (!e.can_change_rows)
					return false
				if (row.can_change == false)
					return false
				if (e.rowset && e.rowset.can_change_rows == false)
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
		if (!(e.rowset ? e.rowset.can_move_rows : e.can_move_rows))
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

	// navigation and selection -----------------------------------------------

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
		if (fi === true) fi = e.last_focused_col
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

		let was_editing = ev.was_editing || !!e.editor
		let focus_editor = ev.focus_editor || (e.editor && e.editor.has_focus)
		let enter_edit = ev.enter_edit || (was_editing && e.stay_in_edit_mode)
		let editable = (ev.editable || enter_edit) && !ev.focus_non_editable_if_not_found
		let expand_selection = ev.expand_selection && e.can_select_multiple
		let invert_selection = ev.invert_selection && e.can_select_multiple

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
		let row = e.rows[ri]

		e.focused_row = row
		e.focused_field = e.fields[fi]
		if (e.focused_field != null)
			e.last_focused_col = e.focused_field.name

		if (ev.set_val != false && e.val_field && ev.input) {
			let val = row ? e.cell_val(row, e.val_field) : null
			e.set_val(val, assign({input: e}, ev))
		}

		let old_selected_rows = map(e.selected_rows)
		if (ev.preserve_selection) {
			// leave it
		} else if (ev.selected_rows) {
			e.selected_rows = map(ev.selected_rows)
		} else if (e.can_focus_cells) {
			if (expand_selection) {
				e.selected_rows.clear()
				let ri1 = min(ri0, ri)
				let ri2 = max(ri0, ri)
				let fi1 = min(fi0, fi)
				let fi2 = max(fi0, fi)
				for (let ri = ri1; ri <= ri2; ri++) {
					let row = e.rows[ri]
					if (e.can_select_cell(row)) {
						let sel_fields = set()
						for (let fi = fi1; fi <= fi2; fi++) {
							let field = e.fields[fi]
							if (e.can_select_cell(row, field)) {
								sel_fields.add(field)
							}
						}
						if (sel_fields.size)
							e.selected_rows.set(row, sel_fields)
						else
							e.selected_rows.delete(row)
					}
				}
			} else {
				let sel_fields = e.selected_rows.get(row) || set()

				if (!invert_selection) {
					e.selected_rows.clear()
					sel_fields = set()
				}

				let field = e.fields[fi]
				if (field)
					if (sel_fields.has(field))
						sel_fields.delete(field)
					else
						sel_fields.add(field)

				if (sel_fields.size && row)
					e.selected_rows.set(row, sel_fields)
				else
					e.selected_rows.delete(row)

			}
		} else {
			if (expand_selection) {
				e.selected_rows.clear()
				let ri1 = min(ri0, ri)
				let ri2 = max(ri0, ri)
				for (let ri = ri1; ri <= ri2; ri++) {
					let row = e.rows[ri]
					if (!e.selected_rows.has(row)) {
						if (e.can_select_cell(row)) {
							e.selected_rows.set(row, true)
						}
					}
				}
			} else {
				if (!invert_selection)
					e.selected_rows.clear()
				if (row)
					if (e.selected_rows.has(row))
						e.selected_rows.delete(row)
					else
						e.selected_rows.set(row, true)
			}
		}

		e.selected_row = expand_selection ? e.rows[ri0] : null
		e.selected_field = expand_selection ? e.fields[fi0] : null

		if (row_changed) {
			e.do_focus_row(row, row0)
			e.announce('focused_row_changed', row, row0, ev)
		}

		if (row_changed || field_changed) {
			let field  = e.fields[fi]
			let field0 = e.fields[fi0]
			e.do_focus_cell(row, field, row0, field0)
			e.announce('focused_cell_changed', row, field, row0, field0, ev)
		}

		let sel_rows_changed = map_keys_different(old_selected_rows, e.selected_rows)
		if (sel_rows_changed)
			selected_rows_changed()

		let qs_changed = !!ev.quicksearch_text
		if (qs_changed) {
			e.quicksearch_text = ev.quicksearch_text
			e.quicksearch_field = ev.quicksearch_field
		} else if (e.quicksearch_text) {
			reset_quicksearch()
			qs_changed = true
		}

		if (row_changed || sel_rows_changed || field_changed || qs_changed)
			e.update({state: true})

		if (enter_edit && ri != null && fi != null) {
			e.update({enter_edit: [ev.editor_state, focus_editor || false]})
		}

		if (ev.make_visible != false)
			if (e.focused_row)
				e.update({scroll_to_focused_cell: true})

		return true
	}

	e.scroll_to_cell = noop

	e.scroll_to_focused_cell = function(fallback_to_first_cell) {
		if (e.focused_row_index != null)
			e.scroll_to_cell(e.focused_row_index, e.focused_field_index)
		else if (fallback_to_first_cell)
			e.scroll_to_cell(0, 0)
	}

	e.focus_next_cell = function(cols, ev) {
		let dir = strict_sign(cols)
		let auto_advance_row = ev && ev.auto_advance_row || e.auto_advance_row
		return e.focus_cell(true, true, dir * 0, cols, assign({must_move: true}, ev))
			|| (auto_advance_row && e.focus_cell(true, true, dir, dir * -1/0, ev))
	}

	e.focus_find_cell = function(lookup_cols, lookup_vals, col) {
		let fi = fld(col) && fld(col).index
		e.focus_cell(e.row_index(e.lookup(lookup_cols, lookup_vals)[0]), fi)
	}

	e.unfocus_focused_cell = function(ev) {
		return e.focus_cell(false, false, 0, 0, ev)
	}

	e.is_last_row_focused = function() {
		let [ri] = e.first_focusable_cell(true, true, 1, 0, {must_move: true})
		return ri == null
	}

	e.select_all_cells = function(fi) {
		let sel_rows_size_before = e.selected_rows.size
		e.selected_rows.clear()
		let of_field = e.fields[fi]
		for (let row of e.rows)
			if (e.can_select_cell(row)) {
				let sel_fields = true
				if (e.can_focus_cells) {
					sel_fields = set()
					for (let field of e.fields)
						if (e.can_select_cell(row, field) && (of_field == null || field == of_field))
							sel_fields.add(field)
				}
				e.selected_rows.set(row, sel_fields)
			}
		e.update({state: true})
		if (sel_rows_size_before != e.selected_rows.size)
			selected_rows_changed()
	}

	function selected_rows_changed() {
		e.announce('selected_rows_changed')
	}

	e.is_row_selected = function(row) {
		return e.selected_rows.has(row)
	}

	e.refocus_state = function(how) {
		let fs = {how: how}
		fs.was_editing = !!e.editor
		fs.focus_editor = e.editor && e.editor.has_focus
		fs.col = e.focused_field && e.focused_field.name
		fs.focused = e.has_focus
		if (how == 'pk' || how == 'val') {
			if (e.pk_fields)
				fs.pk_vals = e.focused_row ? e.cell_vals(e.focused_row, e.pk_fields) : null
		} else if (how == 'row')
			fs.row = e.focused_row
		return fs
	}

	e.refocus = function(fs) {
		let how = fs.how
		let must_not_move_row = !e.auto_focus_first_cell
		let ri, unfocus_if_not_found
		if (how == 'val') {
			if (e.val_field && e._nav && e._field) {
				ri = e.row_index(e.lookup(e.val_col, [e.input_val])[0])
				unfocus_if_not_found = true
			} else if (fs.pk_vals) {
				ri = e.row_index(e.lookup(e.pk_fields, fs.pk_vals)[0])
			}
		} else if (how == 'pk') {
			if (fs.pk_vals)
				ri = e.row_index(e.lookup(e.pk_fields, fs.pk_vals)[0])
		} else if (how == 'row') {
			ri = e.row_index(fs.row)
		} else if (how == 'unfocus') { // TODO: not used
			ri = false
			must_not_move_row = true
			unfocus_if_not_found = true
		} else {
			assert(false)
		}
		e.focus_cell(ri, fs.col, 0, 0, {
			must_not_move_row: must_not_move_row,
			unfocus_if_not_found: unfocus_if_not_found,
			enter_edit: e.auto_edit_first_cell,
			was_editing: fs.was_editing,
			focus_editor: fs.focus_editor,
			focused: fs.focused,
		})
	}

	// vlookup ----------------------------------------------------------------

	// cols        : 'col1 ...' | fi | field | [col1|field1,...]
	// range_defs  : {col->{freq:, unit:, offset:}}
	function create_index(cols, range_defs, rows) {
		trace_if(!cols)

		let idx = obj()

		let tree // map(f1_val->map(f2_val->[row1,...]))
		let cols_arr = words(cols) // [col1,...]
		let fis // [val_index1, ...]

		let range_val, range_label

		if (range_defs) {

			let range_val_funcs = obj() // {col->f}
			let range_label_funcs = obj() // {col->text}

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
				return f ? f(v) : e.draw_cell(row, fld(cols_arr[i]))
			}

		} else {

			range_val = return_arg

			range_label = function(v, i, row) {
				return e.draw_cell(row, fld(cols_arr[i]))
			}

		}

		function add_row(row) {
			let last_fi = fis.last
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
			assert(isarray(vals), 'lookup() array expected, got {0}', typeof vals)
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

	let indices = obj() // {cache_key->index}

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

	let find_row
	function init_find_row() {
		let pk = e.pk_fields
		if (!pk) {
			find_row = return_false
			return
		}
		let lookup = e.lookup
		let pk_vs = []
		let pk_fi = pk.map(f => f.val_index)
		let n = pk_fi.length
		find_row = function(row) {
			for (let i = 0; i < n; i++)
				pk_vs[i] = row[pk_fi[i]]
			return lookup(pk, pk_vs)[0]
		}
	}

	// groups -----------------------------------------------------------------

	function row_groups_one_level(cols, range_defs, rows) {
		let fields = optflds(cols)
		if (!fields)
			return
		let groups = set()
		let ix = e.tree_index(cols, range_defs, rows)
		for (let row of e.all_rows) {
			let group_vals = e.cell_vals(row, fields)
			let group = ix.lookup(group_vals)
			groups.add(group)
			group.key_vals = group_vals
		}
		return groups
	}

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
		path.remove(path_pos)
	}

	// parse `COL[/OFFSET][/UNIT][/FREQ]`
	function parse_range_def(col, range_defs) {
		let freq, offset, unit
		col = col.replace(/\/[^\/]+$/, k => { freq   = k.substring(1).num(); return '' })
		col = col.replace(/\/[^\/]+$/, k => { unit   = k.substring(1); return '' })
		col = col.replace(/\/[^\/]+$/, k => { offset = k.substring(1).num(); return '' })
		if (freq != null || offset != null || unit != null) {
			range_defs[col] = {
				freq   : freq,
				offset : offset,
				unit   : unit,
			}
		}
		return col
	}

	// opt:
	//   col_groups      : 'col1[/...] col2 > col3 col4 > ...'
	//   range_defs      : {col->{freq:, unit:, offset:}}
	//   rows            : [row1,...]
	//   group_label_sep : separator for multi-col group labels
	e.row_groups = function(opt) {
		let group_label_sep = opt.group_label_sep ?? ' / '
		let col_groups = opt.col_groups.split(/\s*>\s*/)
		if (false && col_groups.length == 1) // TODO: enable this optimization again?
			return row_groups_one_level(opt.col_groups, opt.range_defs, opt.rows)
		let range_defs = obj()
		if (opt.range_defs)
			assign(range_defs, opt.range_defs.map(def => assign(obj(), def)))
		let i = 0
		for (let col of col_groups)
			col_groups[i++] = parse_range_def(col, range_defs)
		let all_cols = col_groups.join(' ')
		let fields = optflds(all_cols)
		if (!fields)
			return
		let tree = e.tree_index(all_cols, range_defs, opt.rows).tree()
		let root_group = []
		let depth = col_groups[0].words().length-1
		function add_group(t, path, label_path, parent_group, parent_group_level) {
			let group = []
			group.key_cols = col_groups[parent_group_level]
			group.key_vals = path.slice()
			group.label = label_path.join_nodes(group_label_sep)
			parent_group.push(group)
			let level = parent_group_level + 1
			let col_group = col_groups[level]
			if (col_group) { // more group levels down...
				let depth = col_group.words().length-1
				flatten(t, [], [], depth, add_group, group, level)
			} else { // last group level, t is the array of rows.
				group.push(...t)
			}
		}
		flatten(tree, [], [], depth, add_group, root_group, 0)
		return root_group
	}

	// tree -------------------------------------------------------------------

	e.each_child_row = function(row, f) {
		if (e.is_tree)
			for (let child_row of row.child_rows) {
				e.each_child_row(child_row, f) // depth-first
				f(child_row)
			}
	}

	e.row_and_each_child_row = function(row, f) {
		f(row)
		e.each_child_row(row, f)
	}

	function init_parent_rows_for_row(row, parent_rows) {

		if (!init_parent_rows_for_rows(row.child_rows))
			return // circular ref: abort.

		if (!parent_rows) {

			// reuse the parent rows array from a sibling, if any.
			let sibling_row = (row.parent_row || e).child_rows[0]
			parent_rows = sibling_row && sibling_row.parent_rows

			if (!parent_rows) {

				parent_rows = []
				let parent_row = row.parent_row
				while (parent_row) {
					if (parent_row == row || parent_rows.includes(parent_row))
						return // circular ref: abort.
					parent_rows.push(parent_row)
					parent_row = parent_row.parent_row
				}
			}
		}
		row.parent_rows = parent_rows
		return parent_rows
	}

	function init_parent_rows_for_rows(rows) {
		let parent_rows
		for (let row of rows) {
			parent_rows = init_parent_rows_for_row(row, parent_rows)
			if (!parent_rows)
				return // circular ref: abort.
		}
		return true
	}

	function remove_parent_rows_for(row) {
		row.parent_rows = null
		for (let child_row of row.child_rows)
			remove_parent_rows_for(child_row)
	}

	function remove_row_from_tree(row) {
		let child_rows = (row.parent_row || e).child_rows
		if (!child_rows)
			return
		child_rows.remove_value(row)
		if (row.parent_row && row.parent_row.child_rows.length == 0)
			row.parent_row.collapsed = null
		row.parent_row = null
		remove_parent_rows_for(row)
	}

	function add_row_to_tree(row, parent_row) {
		row.parent_row = parent_row
		let child_rows = (parent_row || e).child_rows
		child_rows.push(row)
	}

	function init_tree() {

		e.is_tree = true
		e.can_be_tree = !!e.parent_field
		if (!e.can_be_tree || e.flat || e.must_be_flat) {
			reset_tree()
			return
		}

		e.child_rows = []
		for (let row of e.all_rows) {
			row.child_rows = []
			row.parent_row = null
			row.parent_rows = null
		}

		let p_fi = e.parent_field.val_index
		for (let row of e.all_rows) {
			let parent_id = row[p_fi]
			let parent_row = parent_id != null ? e.lookup(e.id_field.name, [parent_id])[0] : null
			add_row_to_tree(row, parent_row)
		}

		if (!init_parent_rows_for_rows(e.child_rows)) {
			// circular refs detected: revert to flat mode.
			warn('Circular refs detected. Cannot present data as a tree.')
			e.can_be_tree = false
			reset_tree()
			return
		}

	}

	// row moving -------------------------------------------------------------

	function change_row_parent(row, parent_row) {
		if (!e.is_tree)
			return
		if (parent_row == row.parent_row)
			return
		assert(parent_row != row)
		assert(!parent_row || !parent_row.parent_rows.includes(row))

		let parent_id = parent_row ? e.cell_val(parent_row, e.id_field) : null
		e.set_cell_val(row, e.parent_field, parent_id)

		remove_row_from_tree(row)
		add_row_to_tree(row, parent_row)

		assert(init_parent_rows_for_row(row))
	}

	// row collapsing ---------------------------------------------------------

	function set_parent_collapsed(row, collapsed) {
		for (let child_row of row.child_rows) {
			child_row.parent_collapsed = collapsed
			if (!child_row.collapsed)
				set_parent_collapsed(child_row, collapsed)
		}
	}

	function set_collapsed_all(row, collapsed) {
		if (row.child_rows.length > 0) {
			row.collapsed = collapsed
			for (let child_row of row.child_rows) {
				child_row.parent_collapsed = collapsed
				set_collapsed_all(child_row, collapsed)
			}
		}
	}

	function set_collapsed(row, collapsed, recursive) {
		if (!row.child_rows.length)
			return
		if (recursive)
			set_collapsed_all(row, collapsed)
		else if (row.collapsed != collapsed) {
			row.collapsed = collapsed
			set_parent_collapsed(row, collapsed)
		}
	}

	e.set_collapsed = function(row, collapsed, recursive) {
		if (!e.is_tree)
			return
		if (row)
			set_collapsed(row, collapsed, recursive)
		else
			for (let row of e.child_rows)
				set_collapsed(row, collapsed, recursive)
		reinit_rows()
	}

	e.toggle_collapsed = function(row, recursive) {
		e.set_collapsed(row, !row.collapsed, recursive)
	}

	// sorting ----------------------------------------------------------------

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

		let compare_types = field.compare_types  || e.compare_types
		let compare_vals = field.compare_vals || e.compare_vals
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
			if (row.child_rows.length > 1)
				sort_child_rows(row.child_rows, cmp)
	}

	function add_visible_child_rows(rows) {
		for (let row of rows)
			if (e.is_row_visible(row)) {
				e.rows.push(row)
				add_visible_child_rows(row.child_rows)
			}
	}

	function sort_rows() {
		if (!e.bound)
			return

		let must_create_rows = !e.rows || !order_by_map.size
		let must_sort = !!order_by_map.size
		let cmp = row_comparator(order_by_map)

		if (must_create_rows) {
			e.rows = []
			if (e.is_tree) {
				if (!must_sort)
					init_tree()
				if (cmp)
					sort_child_rows(e.child_rows, cmp)
				add_visible_child_rows(e.child_rows)
			} else {
				for (let row of e.all_rows)
					if (e.is_row_visible(row))
						e.rows.push(row)
				if (cmp)
					e.rows.sort(cmp)
			}
		} else {
			if (e.is_tree) {
				sort_child_rows(e.child_rows, cmp)
				e.rows = []
				add_visible_child_rows(e.child_rows)
			} else {
				e.rows.sort(cmp)
			}
		}

		update_row_index()
	}

	e.sort_rows = function(rows, order_by) {
		let order_by_map = map()
		set_order_by_map(order_by, order_by_map)
		row_comparator(order_by_map)
		return rows.sort()
	}

	// changing the sort order ------------------------------------------------

	function set_order_by_map(order_by, order_by_map) {
		order_by_map.clear()
		let pri = 0
		for (let field of e.all_fields) {
			field.sort_dir = null
			field.sort_priority = null
		}
		for (let s1 of (order_by || '').words()) {
			let m = s1.split(':')
			let col = m[0]
			let field = e.all_fields_map[col]
			if (field && field.sortable) {
				let dir = m[1] || 'asc'
				if (dir == 'asc' || dir == 'desc') {
					order_by_map.set(field, dir)
					field.sort_dir = dir
					field.sort_priority = pri
					pri++
				}
			}
		}
	}

	let order_by_map = map()

	function update_field_sort_order() {
		set_order_by_map(e.order_by, order_by_map)
	}

	function order_by_from_map() {
		let a = []
		for (let [field, dir] of order_by_map)
			a.push(field.name + (dir == 'asc' ? '' : ':desc'))
		return a.length ? a.join(' ') : undefined
	}

	e.set_order_by = function() {
		update_field_sort_order()
		sort_rows()
		e.update({vals: true, state: true, sort_order: true})
	}
	e.prop('order_by', {slot: 'user'})

	e.set_order_by_dir = function(field, dir, keep_others) {
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
	}

	// filtering --------------------------------------------------------------

	// expr: [bin_oper, expr1, ...] | [un_oper, expr] | [col, oper, val]
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

	let is_row_visible
	function init_filters() {
		e.is_filtered = false
		if (e.param_vals === false) {
			is_row_visible = return_false
			return
		}
		let expr = ['&&']
		if (e.param_vals && !e.rowset_url && e.all_fields.length) {
			// this is a detail nav that must filter itself based on param_vals.
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
		}
		for (let field of e.all_fields)
			if (field.exclude_vals)
				for (let v of field.exclude_vals) {
					expr.push(['!==', field.name, v])
					e.is_filtered = true
				}
		is_row_visible = expr.length > 1 ? e.expr_filter(expr) : return_true
	}

	e.is_row_visible = function(row) {
		return !(e.is_tree && row.parent_collapsed) && is_row_visible(row)
	}

	e.and_expr = function(cols, vals) {
		let expr = ['&&']
		let i = 0
		for (let col of cols.words())
			expr.push(['===', col, vals[i++]])
		return expr
	}

	e.filter_rows = function(rows, expr) {
		return rows.filter(e.expr_filter(expr))
	}

	// exclude filter UI ------------------------------------------------------

	e.create_exclude_vals_nav = function(opt, field) { // stub
		return bare_nav(opt)
	}

	function set_exclude_filter(field, exclude_vals) {
		let nav = field.exclude_vals_nav
		if (!exclude_vals) {
			if (nav) {
				field.exclude_vals_nav.del()
				field.exclude_vals_nav = null
			}
			return
		}
		if (!nav) {
			function draw_row(row, cx) {
				return e.draw_cell(row, field, cx)
			}
			nav = e.create_exclude_vals_nav({
					rowset: {
						fields: [
							{name: 'include', type: 'bool', default: true},
							{name: 'row', draw: draw_row},
						],
					},
				}, field)
			field.exclude_vals_nav = nav
		}
		let exclude_set = set(exclude_vals)
		let rows = []
		let val_set = set()
		for (let row of e.all_rows) {
			let v = e.cell_val(row, field)
			if (!val_set.has(v)) {
				rows.push([!exclude_set.has(v), row])
				val_set.add(v)
			}
		}
		nav.rowset.rows = rows
		nav.reset()

		reinit_rows()
	}

	// get/set cell & row state (storage api) ---------------------------------

	let next_key_index = 0
	let key_index = obj() // {key->i}

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
	//	value slots for that key are added the end of the row for all fields.
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
		rsc = obj() // {key->old_val}
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
		if (changed)
			e.update({state: true, vals: vals_changed, errors: errors_changed})
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

	// get/set cell vals and cell & row state ---------------------------------

	e.cell_val        = (row, col) => row[fld(col).val_index]
	e.cell_input_val  = (row, col) => e.cell_state(row, fld(col), 'input_val', e.cell_val(row, col))

	e.cell_errors     = (row, col, with_messages) => {
		let field = fld(col)
		let errors = e.cell_state(row, field, 'errors')
		if (errors == errors_no_messages && with_messages != false) {
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

	function init_field_validator(field) {
		if (field.readonly)
			return

		field.validator = create_validator(field)

		for (let k in field) {
			if (k.starts('validator_')) {
				k = k.replace(/^validator_/, '')
				let rule = field[k]
				rule.name = k
				field.validator.add_rule(rule)
			}
		}

		// parsing these here after we have a parser as they depend on type.
		if (field.min != null) field.min = field.validator.parse(field.min)
		if (field.max != null) field.max = field.validator.parse(field.max)

	}

	function init_row_validators() {
		e.row_validator = create_validator(e)
	}

	function add_validation_errors(validator, errors) {
		for (let result of validator.results)
			errors.push(assign(obj(), result))
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
					a.push(err.error)
				for (let field of e.all_fields)
					for (let err of (e.cell_errors(row, field) || empty_array)) {
						if (err.checked && err.failed)
							a.push(field.label + ': ' + err.error)
					}
		}
		if (!errs.length)
			return
		e.notify('error', errs.ul({class: 'error-list'}, true))
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
				let errors = e.validate_cell(field, val)
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

		let errors = e.validate_cell(field, val)
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

	// responding to val changes ----------------------------------------------

	e.do_update_val = function(v, ev) {
		if (ev && ev.input == e)
			return // coming from focus_cell(), avoid recursion.
		if (!e.val_field)
			return // fields not initialized yet.
		let row = e.lookup(e.val_col, [v])[0]
		let ri = e.row_index(row)
		let focus_opt = assign({
				must_not_move_row: true,
				unfocus_if_not_found: true,
			}, ev)
		focus_opt.set_val = false // avoid recursion.
		e.focus_cell(ri, true, 0, 0, focus_opt)
	}

	// editing ----------------------------------------------------------------

	e.editor = null

	e.do_cell_click = noop

	e.create_editor = function(field, opt) {

		let embed = opt && opt.embedded
		opt = assign_opt({
			// TODO: use original id as template but
			// load/save to this id after instantiation.
			//id: e.id && e.id+'.editor.'+field.name,
			nav: e,
			col: field.name,
			can_select_widget: embed,
			nolabel: embed,
			infomode: embed ? 'hidden' : null,
		}, opt)

		if (
				field.lookup_nav_id
			|| field.lookup_rowset_name
			|| field.lookup_rowset_url
			|| field.lookup_rowset
		)
			return lookup_dropdown(opt)

		return field.editor(opt)
	}

	e.cell_clickable = function(row, field) {
		if (field.type == 'bool')
			return true
		if (field.type == 'button')
			return true
		return false
	}

	let disabled_widgets
	function disable_all(disabled) {
		disabled = !!disabled
		if ((disabled_widgets != null) == disabled)
			return

		if (!disabled) {
			for (let ce of disabled_widgets)
				ce.disable(e, disabled)
			disabled_widgets = null
			return
		}

		if (e.hidden)
			return // bare nav

		let all_widgets = document.body.$('.widget')
		let skip = set()
		// skip self
		skip.add(e)
		// skip others with same nav or same edit group
		for (let ce of all_widgets) {
			if (e._nav && ce._nav == e)
				skip.add(ce)
			if (e.edit_group && ce.edit_group == e.edit_group)
				skip.add(ce)
		}
		// skip parents of skipped
		let skip_parents = set()
		for (let pe of skip) {
			while (pe) {
				if (pe.initialized)
					skip_parents.add(pe)
				pe = pe.parent
			}
		}
		// skip children of skipped
		let skip_all = set(skip)
		for (let se of skip) {
			for (let ce of se.$('.widget'))
				skip_all.add(ce)
		}
		// skip popups of skipped and of their children
		let skip_popups = set()
		for (let ce of $('.widget.popup'))
			for (let se of skip_all)
				if (se.contains(ce))
					skip_popups.add(ce)
		skip_all.addset(skip_popups)
		skip_all.addset(skip_parents)
		// finally, disable the rest
		disabled_widgets = []
		for (let ce of all_widgets) {
			if (!skip_all.has(ce)) {
				ce.disable(e, disabled)
				disabled_widgets.push(ce)
			}
		}

	}

	document.on('stopped_event', e, function(ev) {
		if (disabled_widgets == null)
			return
		if (ev.type != 'pointerdown')
			return
		if (!ev.target.effectively_disabled)
			return
		if (e.contains(ev.target))
			return // disabled but inside self
		if (e.action_band) {
			e.action_band.buttons.save.draw_attention()
			e.action_band.buttons.cancel.draw_attention()
		}
	})

	e.enter_edit = function(editor_state, focus) {
		let row = e.focused_row
		let field = e.focused_field
		if (!row || !field)
			return

		if (!e.editor) {

			if (!e.can_focus_cell(row, field, true))
				return false

			if (editor_state == 'click')
				if (e.do_cell_click(e.focused_row_index, e.focused_field_index))
					return false

			if (editor_state == 'click')
				editor_state = 'select_all'

			if (!field.editor_instance) {
				e.editor = e.create_editor(field, {embedded: true})
				field.editor_instance = e.editor
			} else {
				e.editor = field.editor_instance
				e.editor.show()
			}

			if (!e.editor)
				return false

			e.do_update_cell_editing(e.focused_row_index, e.focused_field_index, true)

			e.editor.on('lost_focus', editor_lost_focus)

		}

		if (e.editor.enter_editor)
			e.editor.enter_editor(editor_state)

		if (focus != false)
			e.editor.focus()

		return true
	}

	e.revert_cell = function(row, field, ev) {
		return e.reset_cell_val(row, field, e.cell_val(row, field), ev)
	}

	e.revert_row = function(row) {
		for (let field of e.all_fields)
			e.revert_cell(row, field)
	}

	e.exit_edit = function(ev) {
		if (!e.editor)
			return

		let cancel = ev && ev.cancel
		let row = e.focused_row
		let field = e.focused_field

		if (cancel)
			e.revert_cell(row, field)

		let had_focus = e.has_focus

		e.editor.off('lost_focus', editor_lost_focus)

		// TODO: remove these hacks once that popups can hide themselves
		// automatically when their target is changing its effective visibility.
		// For now this is good enough.
		if (e.editor.close_spicker)
			e.editor.close_spicker()
		if (e.editor.close)
			e.editor.close()

		e.editor.hide()
		e.editor = null

		e.do_update_cell_editing(e.focused_row_index, e.focused_field_index, false)

		// TODO: causes reflow
		if (had_focus)
			e.focus()

		if (!cancel) // from UI
			if (e.save_on_exit_edit)
				e.save(ev)
	}

	function editor_lost_focus(ev) {
		if (ev.target != e.editor) // other input that bubbled up.
			return
		if (e.exit_edit_on_lost_focus)
			e.exit_edit()
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
				e.set_cell_val(row, field, null, ev)
	}

	// cell lookup display val ------------------------------------------------

	e.set_display_col = function() {
		reset_quicksearch()
		e.display_field = check_field('display_col', e.display_col) || e.name_field
	}
	e.prop('display_col', {type: 'col'})

	function init_field_own_lookup_nav(field) {
		if (field.lookup_nav) // linked lookup nav (not owned).
			return
		if (  field.lookup_rowset
			|| field.lookup_rowset_name
			|| field.lookup_rowset_url
		) {
			field.lookup_nav = shared_nav(field.lookup_nav_id, {
				rowset      : field.lookup_rowset,
				rowset_name : field.lookup_rowset_name,
				rowset_url  : field.lookup_rowset_url,
			})
			field.own_lookup_nav = true
			field.lookup_nav.ref()
		}
	}

	function free_field_own_lookup_nav(field) {
		if (!field.own_lookup_nav)
			return
		field.lookup_nav.unref()
		field.lookup_nav = null
		field.own_lookup_nav = null
	}

	function col_vals_changed(field) {
		e.announce('col_vals_changed', field.name)
		reset_quicksearch()
		e.update({vals: true})
	}

	function setup_lookup_nav(field, ln) {
		field.lookup_fields = ln.flds(field.lookup_cols || ln.pk_fields)
		field.display_field = ln.fld(field.display_col || ln.name_field)
		field.align = field.display_field && field.display_field.align
		col_vals_changed(field)
	}

	function bind_lookup_nav(field, on) {
		let ln = field.lookup_nav
		if (!ln)
			return
		if (on) {
			if (ln.ready)
				lookup_nav_reset(field, ln)
		}
	}

	e.listen('reset', function(ln) {
		for (let field of e.all_fields) {
			if (ln == field.lookup_nav) {
				setup_lookup_nav(field, ln)
			}
		}
	})

	e.listen('rows_changed', function(ln) {
		for (let field of e.all_fields) {
			if (ln == field.lookup_nav) {
				col_vals_changed(field)
			}
		}
	})

	function check_lookup_field_changed(ln, ln_field) {
		for (let field of e.all_fields) {
			if (ln == field.lookup_nav) {
				if (ln_field == field.display_field)
					col_vals_changed(field)
				for (let lf of field.lookup_fields) {
					if (ln_field == lf) {
						col_vals_changed(field)
						break
					}
				}
			}
		}
	}

	e.listen('cell_state_changed', function(ln, ln_row, ln_field) {
		check_lookup_field_changed(ln, ln_field)
	})

	e.listen('col_vals_changed', function(ln, ln_field) {
		check_lookup_field_changed(ln, ln_field)
	})

	// cell value multi-target rendering --------------------------------------

	// cx can be a 2d context to draw into, an element to render into,
	// or nothing in which case returns a plain text representation.

	function draw_null_lookup_val(row, field, cx) {
		if (!row || !field.null_lookup_col) return
		let lf = e.all_fields_map[field.null_lookup_col]  ; if (!lf || !lf.lookup_cols) return
		let ln = lf.lookup_nav                            ; if (!ln) return
		let nfv = e.cell_val(row, lf)
		let ln_row = ln.lookup(lf.lookup_cols, [nfv])[0]  ; if (!ln_row) return
		let dcol = field.null_display_col ?? field.name
		let df = ln.all_fields_map[dcol]                  ; if (!df) return
		return ln.draw_cell(ln_row, df, cx)
	}

	e.draw_val = function(row, field, v, cx) {

		if (v == null) {
			let s = draw_null_lookup_val(row, field, cx)
			if (s) return s

			if (field.draw_null)
				return field.draw_null(cx, row)

			s = field.null_text
			if (s) return field.draw_text(s, cx)

			return
		}

		if (v === '') {
			if (field.empty_text)
				return field.draw_text(field.empty_text, cx)
			return
		}

		let ln = field.lookup_nav
		if (ln && field.lookup_fields && field.display_field) {
			let ln_row = ln.lookup(field.lookup_fields, [v])[0]
			if (ln_row) {
				let df = field.display_field
				return ln.draw_cell(ln_row, df, cx)
			}
		}

		return field.draw(v, cx, row)
	}

	e.draw_cell = function(row, field, cx) {
		return e.draw_val(row, field, e.cell_input_val(row, field), cx)
	}

	// row adding & removing --------------------------------------------------

	e.insert_rows = function(arg1, ev) {
		ev = ev || empty
		let from_server = ev.from_server
		if (!from_server && !e.can_actually_add_rows())
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
		let ri1 = at_row ? e.row_index(at_row) : e.rows.length
		let set_cell_val = from_server ? e.reset_cell_val : e.set_cell_val

		// request to focus the new row implies being able to exit the
		// focused row first. if that's not possible, the insert is aborted.
		if (ev.focus_it) {
			ev.was_editing  = !!e.editor
			ev.editor_state = ev.editor_state || e.editor && e.editor.state && e.editor.editor_state()
			ev.focus_editor = e.editor && e.editor.has_focus
			if (!e.focus_cell(false, false))
				return 0
		}

		let rows_added, rows_updated
		let added_rows = set()

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
			let row0 = row && e.all_rows.length > 0 && find_row(row)

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
							if (val === undefined)
								val = field.default
							row[fi] = val
						}
						fi++
					}
				}

				if (e.init_row)
					e.init_row(row, ri, ev)

				if (!from_server)
					row.is_new = true
				e.all_rows.push(row)
				assign(row, ev.row_state)
				added_rows.add(row)
				rows_added = true

				if (e.is_tree) {
					row.child_rows = []
					row.parent_row = parent_row || null
					let child_rows = (row.parent_row || e).child_rows
					child_rows.push(row)
					if (row.parent_row) {
						// set parent id to be the id of the parent row.
						let parent_id = e.cell_val(row.parent_row, e.id_field)
						row[e.parent_field.val_index] = parent_id
					}
					assert(init_parent_rows_for_row(row))
				}

				update_indices('row_added', row)

				if (e.is_row_visible(row)) {
					e.rows.insert(ri, row)
					if (e.focused_row_index >= ri)
						e.focused_row = e.rows[e.focused_row_index + 1]
					ri++
				}

				if (row.is_new)
					row_changed(row)

			}

		}

		if (rows_added) {
			update_row_index()
			if (ev.input)
				update_pos_field() // TODO: tree
			e.announce('rows_added', added_rows)
			e.announce('rows_changed')
		}

		if (rows_added || rows_updated)
			e.update({rows: rows_added, vals: rows_updated})

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

		let from_server = ev.from_server || !e.can_save_changes()

		if (!from_server && !e.can_actually_remove_rows())
			return false

		if (ev && ev.confirm && (rows_to_remove.length > 1 || !rows_to_remove[0].is_new))
			if (!confirm(S('delete_records_confirmation',
					'Are you sure you want to delete {0:record:records}?',
						rows_to_remove.length))
			) return false

		let removed_rows = set()
		let marked_rows = set()
		let rows_changed
		let top_row_index

		for (let row of rows_to_remove) {

			if (!from_server && !e.can_remove_row(row, ev))
				continue

			if (from_server || row.is_new) {

				if (ev.refocus) {
					let row_index = e.row_index(row)
					if (top_row_index == null || row_index < top_row_index)
						top_row_index = row_index
				}

				e.row_and_each_child_row(row, function(row) {
					if (e.focused_row == row)
						assert(e.focus_cell(false, false, 0, 0, {cancel: true, input: e}))
					row_unchanged(row)
					e.selected_rows.delete(row)
					removed_rows.add(row)
					if (e.free_row)
						e.free_row(row, ev)
				})

				remove_row_from_tree(row)

				update_indices('row_removed', row)

				row.removed = true

			} else {

				e.row_and_each_child_row(row, function(row) {
					row.removed = !ev.toggle || !row.removed
					if (row.removed) {
						marked_rows.add(row)
						row_changed(row)
					} else if (!row.modified) {
						row_unchanged(row)
					}
					rows_changed = true
				})

			}

		}

		if (removed_rows.size) {

			if (removed_rows.size < 100) {
				// much faster removal for a small number of rows (common case).
				for (let row of removed_rows) {
					e.rows.remove_value(row)
					e.all_rows.remove_value(row)
				}
				update_row_index()
			} else {
				e.all_rows = e.all_rows.filter(row => !removed_rows.has(row))
				init_rows()
			}

			if (ev.input)
				update_pos_field() // TODO: tree

			e.announce('rows_removed', removed_rows)

			if (top_row_index != null) {
				if (!e.focus_cell(top_row_index, true, null, null, {input: e}))
					e.focus_cell(top_row_index, true, -0, 0, {input: e})
			}

		}

		if (removed_rows.size)
			e.announce('rows_changed')

		if (rows_changed || removed_rows.size)
			e.update({state: rows_changed, rows: !!removed_rows.size})

		if (marked_rows.size)
			if (e.save_on_remove_row)
				e.save(ev)

		return !!(rows_changed || removed_rows.size)
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
		if (rs.fields.length != e.all_fields.length)
			return false
		for (let fi = 0; fi < rs.fields.length; fi++) {
			let f1 = rs.fields[fi]
			let f0 = e.all_fields[fi]
			if (f1.name !== f0.name)
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
		if (e.is_tree)
			return false

		let rows_added = e.insert_rows(rs.rows, {
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

		e.update({
			rows: rows_added || rm_rows.length || undefined,
			vals: rows_updated || undefined,
		})

		return true
	}

	// row moving -------------------------------------------------------------

	e.expanded_child_row_count = function(ri) { // expanded means visible.
		let n = 0
		if (e.is_tree) {
			let row = e.rows[ri]
			let min_parent_count = row.parent_rows.length + 1
			for (ri++; ri < e.rows.length; ri++) {
				let child_row = e.rows[ri]
				if (child_row.parent_rows.length < min_parent_count)
					break
				n++
			}
		}
		return n
	}

	function update_pos_field_for_children_of(row) {
		let index = 1
		let min_parent_count = row ? row.parent_rows.length + 1 : 0
		for (let ri = row ? e.row_index(row) + 1 : 0; ri < e.rows.length; ri++) {
			let child_row = e.rows[ri]
			if (child_row.parent_rows.length < min_parent_count)
				break
			if (child_row.parent_row == row)
				e.set_cell_val(child_row, e.pos_field, index++)
		}
	}

	function update_pos_field(old_parent_row, parent_row) {
		if (!e.pos_field)
			return
		if (e.is_tree) {
			update_pos_field_for_children_of(old_parent_row)
			if (parent_row != old_parent_row)
				update_pos_field_for_children_of(parent_row)
		} else {
			let index = 1
			for (let ri = 0; ri < e.rows.length; ri++)
				e.set_cell_val(e.rows[ri], e.pos_field, index++)
		}
	}

	e.rows_moved = noop // stub
	let rows_moved // flag in case there's no pos col and thus no e.changed_rows.

	function move_rows_state(focused_ri, selected_ri, ev) {

		let move_ri1 = min(focused_ri, selected_ri)
		let move_ri2 = max(focused_ri, selected_ri)

		let top_row = e.rows[move_ri1]
		let parent_row = top_row.parent_row

		move_ri2++ // make range exclusive.

		if (e.is_tree) {

			let min_parent_count = top_row.parent_rows.length

			// extend selection with all visible children which must be moved along.
			// another way to compute this would be to find the last selected sibling
			// of top_row and select up to all its extended_child_row_count().
			while (1) {
				let row = e.rows[move_ri2]
				if (!row)
					break
				if (row.parent_rows.length <= min_parent_count) // sibling or unrelated
					break
				move_ri2++
			}

			// check to see that all selected rows are siblings or children of the first row.
			for (let ri = move_ri1; ri < move_ri2; ri++)
				if (e.rows[ri].parent_rows.length < min_parent_count)
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
				let parent_count = rows[0].parent_rows.length
				for (let row of rows)
					if (row.parent_rows.length == parent_count) // sibling of top row
						change_row_parent(row, parent_row)
			}

			update_row_index()

			e.focused_row_index = insert_ri + (move_ri1 == focused_ri ? 0 : move_n - 1)

			if (is_client_nav()) {
				// client rowsets do not need a `pos` field to track row positions.
				// instead, row positions are implicit per e.all_rows array. so when
				// we move rows around, we need to move them in e.all_rows too.
				if (e.is_tree) {
					// rebuild e.all_rows from the updated tree.
					e.all_rows = []
					function add_child_rows(rows) {
						for (let row of rows) {
							e.all_rows.push(row)
							add_child_rows(row.child_rows)
						}
					}
					add_child_rows(e.child_rows)
				} else {
					if (e.param_vals) {
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
					e.all_rows.move(move_ri1, move_n, insert_ri)
					e.rows_moved(move_ri1, move_n, insert_ri, ev)
				}
			}

			update_row_index()

			update_pos_field(old_parent_row, parent_row)

			rows_moved = true
			if (e.save_on_move_row)
				e.save(ev)

			e.update({rows: true})
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

	// ajax requests ----------------------------------------------------------

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

	// loading ----------------------------------------------------------------

	e.reset = function(ev) {

		if (!e.bound)
			return

		abort_all_requests()

		let fs = e.refocus_state('val') || e.refocus_state('pk')
		e.unfocus_focused_cell({cancel: true, input: ev && ev.input})

		init_all()

		e.update({fields: true, rows: true})
		e.refocus(fs)

		e.announce('reset', ev)

	}

	// compress param_vals into a value array for single-key pks.
	function param_vals_filter() {
		if (!e.param_vals)
			return
		let cols = []
		for (let [col, param] of param_map(e.params))
			cols.push(col)
		if (cols.length == 1) {
			let col = cols[0]
			return json(e.param_vals.map(vals => vals[col]))
		} else {
			return json(e.param_vals)
		}
	}

	function rowset_url(format) {
		let u = e.rowset_url
		if (format)
			u = u.replace('.json', '.'+format)
		let s = href(u)
		let filter = param_vals_filter()
		if (filter) {
			let u = url_parse(s)
			u.args = u.args || obj()
			u.args.filter = filter
			s = url_format(u)
		}
		return s
	}

	e.reload = function(opt) {

		opt = opt || empty

		if (!e.bound)
			return

		if (!e.rowset_url || e.param_vals === false) {
			// client-side rowset or param vals not available: reset it.
			e.reset(opt.event)
			return
		}

		let saving = requests && requests.size && !e.load_request

		// ignore rowset-changed event if coming exclusively from our update operations.
		if (opt.update_ids) {
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
			if (opt.if_filter && opt.if_filter != param_vals_filter())
				return
			pr('reloading', e.rowset_name)
		}

		if (saving) {
			e.notify('error',
				S('error_load_while_saving', 'Cannot reload while saving is in progress.'))
			return
		}

		e.abort_loading()

		let req = nav_ajax(assign_opt({
			rowset_name: e.rowset_name,
			wait: e.wait || num(e.attr('wait')),
			url: rowset_url(),
			progress: load_progress,
			done: load_done,
			slow: load_slow,
			slow_timeout: e.slow_timeout,
			dont_send: true,
		}, opt))
		req.on('success', load_success)
		req.on('fail', load_fail)
		add_request(req)
		e.load_request = req
		e.load_request_start_clock = clock()
		e.loading = true
		loading(true)
		req.send()
	}

	e.download_xlsx = function() {
		let link = tag('a', {href: rowset_url('xlsx'), style: 'display: none'})
		document.body.add(link)
		link.click()
		link.del()
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

	function load_fail(err, type, status, message, body) {
		e.do_update_load_fail(true, err, type, status, message, body)
		return e.announce('nav_load_fail', err, type, status, message, body, this)
	}

	e.prop('focus_state', {slot: 'user'})

	function load_success(rs) {
		if (this.allow_diff_merge && e.diff_merge(rs))
			return
		e.rowset = rs
		e.reset(this.event)
	}

	// saving changes ---------------------------------------------------------

	function row_changed(row) {
		if (row.nosave)
			return
		if (!e.changed_rows)
			e.changed_rows = set()
		else if (e.changed_rows.has(row))
			return
		e.changed_rows.add(row)
		e.update({state: true})
	}

	function row_unchanged(row) {
		if (!e.changed_rows || !e.changed_rows.has(row))
			return
		e.changed_rows.delete(row)
		if (!e.changed_rows.size)
			e.changed_rows = null
		e.update({state: true})
	}

	function pack_changes() {

		let packed_rows = []
		let source_rows = []
		let changes = {rows: packed_rows}

		for (let row of e.changed_rows) {
			if (row.save_request)
				continue // currently saving this row.
			if (!e.validate_row(row))
				continue
			if (row.is_new) {
				let t = {type: 'new', values: obj()}
				for (let field of e.all_fields) {
					if (field.nosave)
						continue
					let val = e.cell_input_val(row, field)
					if (val !== field.default)
						t.values[field.name] = val
				}
				packed_rows.push(t)
				source_rows.push(row)
			} else if (row.removed) {
				let t = {type: 'remove', values: obj()}
				for (let f of e.pk_fields)
					t.values[f.name+':old'] = e.cell_val(row, f)
				packed_rows.push(t)
				source_rows.push(row)
			} else if (row.modified) {
				let t = {type: 'update', values: obj()}
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
		let update_id = floor(random() * 2**52).base(36)
		update_ids.add(update_id)
		let req = nav_ajax({
			rowset_name: e.rowset_name,
			wait: e.wait || num(e.attr('wait')),
			url: rowset_url(),
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
		rows_moved = false
		e.update({state: true})
		add_request(req)
		set_save_state(source_rows, req)
		e.announce('saving', true)
		req.send()
	}

	e.can_save_changes = function() {
		return !!(e.rowset_url || e.static_rowset)
	}

	e.save = function(ev) {
		if (e.static_rowset) {
			if (e.save_row_states)
				save_to_row_states()
			else
				save_to_row_vals()
			e.announce('saved')
		} else if (e.rowset_url) {
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
		rows_moved = false
		e.update({state: true})
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
		rows_moved = false
		e.update({state: true})
	}

	// row (de)serialization --------------------------------------------------

	e.do_save_row = return_true // stub

	e.serialize_row = function(row) {
		let drow = []
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			let field = e.all_fields[fi]
			let v = e.cell_input_val(row, field)
			if (v !== field.default && !field.nosave)
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
		let t = obj()
		for (let field of e.all_fields)
			t[field.name] = e.cell_state(row, field, key)
		return t
	}

	e.serialize_row_vals = function(row) {
		let vals = obj()
		for (let field of e.all_fields) {
			let v = e.cell_input_val(row, field)
			if (v !== field.default && !field.nosave)
				vals[field.name] = v
		}
		return vals
	}

	e.deserialize_row_vals = function(vals) {
		let row = []
		for (let fi = 0; fi < e.all_fields.length; fi++) {
			let field = e.all_fields[fi]
			let v = strict_or(vals[field.name], field.default)
			row[fi] = v
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
				let state = obj()
				if (row.is_new)
					state.is_new = true
				if (row.removed)
					state.removed = true
				state.vals = e.serialize_row_vals(row)
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
				for (let col of state.cells) {
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

	let save_barrier

	function save_to_row_vals() {

		save_barrier = true
		e.row_vals = e.serialize_all_row_vals()
		save_barrier = false

		e.commit_changes()
	}

	function save_to_row_states() {
		save_barrier = true
		e.row_states = e.serialize_all_row_states()
		save_barrier = false
	}

	// responding to notifications from the server ----------------------------

	e.notify = function(type, message, ...args) {
		notify(message, type)
		e.announce('notify', type, message, ...args)
	}

	e.do_update_loading = function(on) { // stub
		if (!on)
			e.load_overlay(false)
	}

	function loading(on) {
		e.class('loading', on)
		e.do_update_loading(on)
		e.announce('loading', on)
		e.do_update_load_progress(0)
	}

	e.do_update_load_progress = noop // stub

	e.do_update_load_slow = function(on) { // stub
		e.load_overlay(on, 'waiting',
			S('loading', 'Loading...'),
			S('stop_loading', 'Stop loading'))
	}

	e.do_update_load_fail = function(on, error, type, status, message, body) {
		if (!e.bound)
			return
		if (type == 'abort')
			e.load_overlay(false)
		else
			e.load_overlay(on, 'error', error, null, body)
	}

	// loading overlay --------------------------------------------------------

	{
	let oe
	e.load_overlay = function(on, cls, text, cancel_text, detail) {
		if (oe) {
			oe.del()
			oe = null
		}
		e.disable('loading', on)
		if (!on)
			return
		oe = overlay({class: 'nav-loading-overlay'})
		oe.content.class('nav-loading-overlay-message')
		if (cls)
			oe.class(cls)
		let focus_e
		if (cls == 'error') {
			let more_div = div({class: 'nav-loading-overlay-detail'})
			let band = action_band({
				layout: 'more... less... < > retry:ok forget-it:cancel',
				buttons: {
					more: function() {
						more_div.set(detail, 'pre-wrap')
						band.at[0].hide()
						band.at[1].show()
					},
					less: function() {
						more_div.clear()
						band.at[0].show()
						band.at[1].hide()
					},
					retry: function() {
						e.load_overlay(false)
						e.reload()
					},
					forget_it: function() {
						e.load_overlay(false)
					},
				},
			})
			band.at[1].hide()
			let error_icon = span({class: 'loading-error-icon fa fa-exclamation-circle'})
			oe.content.add(div(0, error_icon, text, more_div, band))
			focus_e = band.last.prev
		} else if (cls == 'waiting') {
			let cancel = button({
				text: cancel_text,
				action: function() {
					e.abort_loading()
				},
				attrs: {style: 'margin-left: 1em;'},
			})
			oe.content.add(text, cancel)
			focus_e = cancel
		} else
			oe.content.del()
		e.add(oe)
		if(focus_e && e.has_focus)
			focus_e.focus()
	}
	}

	// action bar -------------------------------------------------------------

	e.set_action_band_visible = function(v) {
		e.update({state: true})
	}

	function nrows(n) {
		return n != 1 ? S('records', 'records') : S('record', 'record')
	}

	function count_changed_rows(attr) {
		let c = e.changed_rows
		if (!c) return 0
		let n = 0
		for (let row of c)
			if (row[attr])
				n++
		return n
	}

	e.update_action_band = function() {

		if (e.action_band_visible == 'no')
			return

		if (e.action_band_visible == 'auto' && !e.changed_rows && !e.action_band)
			return

		let ab = e.action_band
		if (!ab) {

			ab = action_band({
				classes: 'grid-action-band',
				layout: 'reload add delete move_up move_down info < > cancel:cancel save:ok',
				buttons: {
					'reload': button({
						classes: 'grid-action-band-reload-button',
						icon: 'fa fa-sync',
						text: '',
						title: S('reload', 'Reload all records'),
						bare: true,
						action: () => e.reload(),
						tabindex: -1,
					}),
					'add': button({
						bare: true,
						icon: 'fa fa-plus',
						text: S('add', 'Add'),
						title: S('add_new_record', 'Add a new record (Insert key)'),
						action: function() {
							e.insert_rows(1, {
								input: e,
								at_focused_row: true,
								focus_it: true,
							})
						},
						tabindex: -1,
					}),
					'delete': button({
						bare: true,
						danger: true,
						icon: 'fa fa-minus',
						action: function() {
							e.remove_selected_rows({input: e, refocus: true})
						},
						tabindex: -1,
					}),
					'move_up'   : button({
						bare: true,
						icon: 'fa fa-angle-up',
						text: S('move_up', 'Move up'),
						hidden: true,
						action: function() {
							e.move_selected_rows_up()
						},
						tabindex: -1,
					}),
					'move_down' : button({
						bare: true,
						icon: 'fa fa-angle-down',
						text: S('move_down', 'Move Down'),
						hidden: true,
						action: function() {
							e.move_selected_rows_down()
						},
						tabindex: -1,
					}),
					'info': div({class: 'grid-action-band-info'}),
					'cancel': button({
						bare: true,
						icon: 'fa fa-rotate-left',
						text: S('cancel', 'Cancel'),
						title: S('discard_changes', 'Discard changes'),
						action: function() {
							e.exit_edit({cancel: true})
							e.revert_changes()
						},
						tabindex: -1,
					}),
					'save': button({
						bare: true,
						icon: 'fa fa-floppy-disk',
						text: S('save', 'Save'),
						title: S('save_changes', 'Save changes (Esc or Enter keys)'),
						primary: true,
						action: function() {
							e.exit_edit()
							e.save({notify_errors: true})
						},
						tabindex: -1,
					}),
				}
			})
			e.action_band = ab

			for (let k in ab.buttons) {
				let b = ab.buttons[k]
				b.static_text = b.text
			}

			ab.on_update(function(opt) {

				let sn = e.selected_rows.size
				let an = count_changed_rows('is_new' )
				let dn = count_changed_rows('removed')
				let cn = e.changed_rows ? e.changed_rows.size : 0
				let un = cn - an - dn

				ab.buttons.reload.disable('nav_state', cn || !e.rowset_url)

				ab.buttons.add.disable('nav_state', !e.can_actually_add_rows())

				let bd = ab.buttons.delete
				bd.disable('nav_state', !sn)
				let ds = sn > 1 ? S('delete_records', 'Delete {0} {1}', sn, nrows(sn)) : S('delete', 'Delete')
				bd.text = ds
				bd.static_text = ds
				bd.title =
					(sn > 1 ? ds : S('delete_focused_record', 'Delete focused record'))
					+ ' (' + S('delete_key', 'Delete key') + ')'

				let allow_move = e.can_actually_move_rows(true)
				let can_move   = e.can_actually_move_rows(false)
				ab.buttons.move_up   .show(allow_move)
				ab.buttons.move_down .show(allow_move)
				if (allow_move) {
					ab.buttons.move_up   .disable('nav_state', !can_move)
					ab.buttons.move_down .disable('nav_state', !can_move)
					ab.buttons.move_up   .title = can_move
						? S('move_record_up', 'Move record up in list (you can also drag it into position)')
						: e.can_actually_move_rows_error()
					ab.buttons.move_down .title = can_move
						? S('move_record_down', 'Move record down in list (you can also drag it into position)')
						: e.can_actually_move_rows_error()
				}

				let s = catany('\n',
					sn > 1 ? sn + ' ' + nrows(sn) + ' ' + S('selected', 'selected') : null,
					an > 0 ? an + ' ' + nrows(an) + ' ' + S('added'   , 'added'   ) : null,
					un > 0 ? un + ' ' + nrows(un) + ' ' + S('modified', 'modified') : null,
					dn > 0 ? dn + ' ' + nrows(dn) + ' ' + S('deleted' , 'deleted' ) : null
				)
				ab.buttons.info.set(s)

				ab.buttons.save  .disable('nav_state', !cn)
				ab.buttons.cancel.disable('nav_state', !cn)

			})

			let noinfo, tight
			ab.on_measure(function() {
				noinfo = this.parent.cw < 380
				tight  = this.parent.cw < 815
			})

			ab.on_position(function() {
				this.class('noinfo', noinfo)
				this.class('tight' , tight)
				for (let k in this.buttons) {
					let b = this.buttons[k]
					b.text = tight ? null : b.static_text
				}
				this.buttons.info.hide(noinfo)
			})

			ab.on('resize', function() {
				this.update()
			})

			e.add(ab)

		}

		let show = !!(e.action_band_visible != 'auto' || e.changed_rows)
		ab.update({show: show})

		disable_all(!!(e.changed_rows && e.changed_rows.size))

	}

	// quick-search -----------------------------------------------------------

	function* qs_reach_row(start_row, ri_offset) {
		let n = e.rows.length
		let ri1 = (e.row_index(start_row) ?? 0) + (ri_offset || 0)
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

	reset_quicksearch()

	e.quicksearch = function(s, start_row, ri_offset) {

		if (!s) {
			reset_quicksearch()
			e.update({state: true})
			return
		}

		s = s.lower()

		let field = e.focused_field || (e.quicksearch_col && e.all_fields_map[e.quicksearch_col])
		if (!field)
			return

		for (let ri of qs_reach_row(start_row, ri_offset)) {
			let row = e.rows[ri]
			let cell_text = e.cell_text_val(row, field).lower()
			if (cell_text.starts(s)) {
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

	// picker protocol --------------------------------------------------------

	e.prop('row_display_val_template', {private: true})
	e.prop('row_display_val_template_name', {attr: 'row_display_val_template'})

	e.draw_row = function(row, cx) { // stub
		if (isnode(cx)) {
			if (window.template) { // have webb_spa.js
				let ts = e.row_display_val_template
				if (!ts) {
					let tn = e.row_display_val_template_name
					if (tn)
						ts = template(tn)
					else
						ts = template(e.id + '_item') || template(e.tag + '_item')
				}
				if (ts) {
					cx.unsafe_html = render_string(ts, row && e.serialize_row_vals(row))
					return true
				}
			}
		}
		if (!row)
			return
		let field = e.display_field
		if (!field)
			return e.draw_text('no display field', cx)
		return e.draw_cell(row, field, cx)
	}

	e.pick_near_val = function(delta, ev) {
		if (e.focus_cell(true, true, delta, 0, ev))
			if (!ev || ev.pick !== false)
				e.fire('val_picked', ev)
	}

	init_all()

}

/* view-less nav -------------------------------------------------------------

*/

css('bare-nav', 'hidden')

G.bare_nav = component('nav', function(e) {
	e.class('bare-nav')
	e.make_nav_widget()
})

/* ---------------------------------------------------------------------------

Widget that has a nav as its data model. The nav can be either external,
internal, or missing (in which case the widget is disabled).

config props:
	nav_id     nav
	nav
	rowset
	rowset_name
fires:
	^bind_nav(nav, on)

*/

// TODO: make interpreting the inner html a separate init step!

G.make_nav_data_widget_extend_before = function(e) {

	let nav
	let rowset = e.$1(':scope>rowset')
	if (rowset) {
		nav = bare_nav({}, rowset)
	} else {
		nav = e.$1(':scope>nav')
		if (nav) {
			nav.init_component()
			nav.del()
		}
	}
	if (nav) {
		e.on_bind(function(on) {
			if (on)
				head.add(nav)
			else
				nav.del()
			e._html_nav = on ? nav : null
		})
	}

}

e.make_nav_data_widget = function() {

	let e = this

	// data binding -----------------------------------------------------------

	let nav

	function bind_nav(on) {
		if (!nav)
			return
		if (nav._internal)
			if (on)
				head.add(nav)
			else
				nav.del()
		e.fire('bind_nav', nav, on)
	}

	// NOTE: internal nav takes priority to external nav. This decision is
	// arbitrary, but also more stable (external nav can go anytime).
	function get_nav() {
		if (!e.bound) return
		if (e.rowset_name || e.rowset) { // internal
			if (nav && nav._internal
				&& ((e.rowset_name && nav.rowset_name == e.rowset_name) ||
					(e.rowset && nav.rowset == e.rowset))) // same inernal
				return nav
			return bare_nav({
				rowset_name : e.rowset_name,
				rowset      : e.rowset,
				_internal   : true,
			})
		}
		return e.nav || e._html_nav // external
	}

	function update_nav() {
		let nav1 = get_nav()
		if (nav == nav1)
			return
		bind_nav(false)
		nav = nav1
		bind_nav(true)
	}

	e.on_bind(update_nav)

	// external nav: referenced directly or by id.
	e.prop('nav', {private: true})
	e.prop('nav_id', {type: 'nav', attr: 'nav', bind_id: 'nav'})
	e.set_nav = update_nav

	// internal nav: local rowset binding
	e.prop('rowset', {private: true, type: 'rowset'})
	e.set_rowset = update_nav

	// internal nav: remote rowset binding
	e.prop('rowset_name', {type: 'rowset', attr: 'rowset'})
	e.set_rowset_name = update_nav

}

/* ---------------------------------------------------------------------------

Widget that has sa nav and a col from the nav as its data model, but doesn't
depend on the focused row (see next mixin for that).

config props:
	nav
	nav_id     nav
	col
state props:
	ready
fires:
	^bind_field(field, on)

*/

e.make_nav_col_widget = function() {

	let e = this

	let nav, field

	function bind_field(on) {
		if (on) {
			assert(!field)
			field = nav && nav.optfld(e.col) || null
			if (!field)
				return
			e.fire('bind_field', field, true)
		} else {
			if (!field)
				return
			e.fire('bind_field', field, false)
			field = null
		}
		e.ready = !!field
		e.update()
		return field
	}

	function update_field() {
		bind_field(false)
		bind_field(true)
	}

	function update_nav() {
		let nav1 = e.nav
		if (nav1 == nav)
			return
		bind_field(false)
		nav = nav1
		bind_field(true)
	}

	e.prop('col', {type: 'col'})
	e.set_col = update_field

	e.prop('nav', {private: true, type: 'nav'})
	e.prop('nav_id', {type: 'nav', attr: 'nav', bind_id: 'nav'})
	e.set_nav = update_nav

	e.listen('reset', function(te) {
		if (te != nav) return
		update_field()
	})

	e.listen('field_changed', function(te, changed_field, k, v) {
		if (te != nav) return
		if (changed_field != field) return
		update_field()
	})

	e.prop('ready', {type: 'bool', slot: 'state', default: true, updates: 'value'})

}

/* ---------------------------------------------------------------------------

Widget that has a nav cell or a range of two nav cells as its data model.

config props:
	nav
	nav_id     nav
	col[1,2]
state props:
	ready
	row
fires:
	^bind_field(field, on)

*/

e.make_nav_input_widget = function(field_props, range, field_range_props) {

	let e = this

	// state: field[1,2]

	let nav, field, field1, field2

	field_props       = field_props       && words(field_props      ).tokeys()
	field_range_props = field_range_props && words(field_range_props).tokeys()

	function bind_field(field, col, input_widget, INPUT_VALUE, on) {
		if (on) {
			assert(!field)
			field = nav && nav.optfld(col) || null
			if (!field)
				return
			e.xoff()
			if (field_props)
				for (let k in field_props)
					if (field[k] !== undefined)
						input_widget.set_prop(k, field[k])
			if (field_range_props)
				for (let k in field_range_props)
					if (field[k] !== undefined)
						e.set_prop(k, field[k])
			e.xon()
			e.fire('bind_field', field, true)
			e[INPUT_VALUE] = e.get_input_val_for(field)
		} else {
			if (!field)
				return
			e.fire('bind_field', field, false)
			field = null
		}
		e.ready = range ? !!field1 && !!field2 : !!field
		e.update()
		return field
	}

	function bind_fields(on) {
		if (range) {
			field1 = bind_field(field1, e.col1, e.input_widgets[0], 'input_value1', on)
			field2 = bind_field(field2, e.col2, e.input_widgets[1], 'input_value2', on)
		} else {
			field = bind_field(field, e.col, e, 'input_value', on)
		}
	}

	function update_fields() {
		bind_fields(false)
		bind_fields(true)
	}

	function update_nav() {
		let nav1 = e.nav
		if (nav1 == nav)
			return
		bind_fields(false)
		nav = nav1
		bind_fields(true)
	}

	if (range) {
		e.prop('col1', {type: 'col'})
		e.prop('col2', {type: 'col'})
		e.set_col1 = update_fields
		e.set_col2 = update_fields
	} else {
		e.prop('col', {type: 'col'})
		e.set_col = update_fields
	}

	e.prop('nav', {private: true, type: 'nav'})
	e.prop('nav_id', {type: 'nav', attr: 'nav', bind_id: 'nav'})
	e.set_nav = update_nav

	e.listen('reset', function(te) {
		if (te != nav) return
		update_fields()
	})

	e.listen('field_changed', function(te, changed_field, k, v) {
		if (te != nav) return
		if (changed_field != field) return
		if (field_props && field_props[k])
			for (let input_widget of e.input_widgets) {
				e.xoff()
				input_widget.set_prop(k, v)
				e.xon()
			}
		if (field_range_props && field_range_props[k]) {
			e.xoff()
			e.set_prop(k, v)
			e.xon()
		}
	})

	e.listen('label_find_target', function(label, f) {
		if (f == field || f == field1 || f == field2) {
			return e
		}
	})

	// state: ready, row, input

	e.prop('ready', {type: 'bool', slot: 'state', default: true, updates: 'value'})

	e.property('row', () => nav && nav.focused_row)

	e.get_input_val_for = function(field) {
		let row = e.row
		return row && field ? nav.cell_input_val(row, field) : null
	}

	function set_input_values(ev) {
		if (range) {
			e.set_prop('input_value1', e.get_input_val_for(field1), ev)
			e.set_prop('input_value2', e.get_input_val_for(field2), ev)
		} else {
			e.set_prop('input_value', e.get_input_val_for(field), ev)
		}
	}

	function set_cell_val_for(field, v, ev) {
		if (v === undefined)
			v = null
		let was_set
		if (field) {
			if (!e.row)
				if (nav && !nav.all_rows.length)
					if (nav.can_actually_change_val())
						nav.insert_rows(1, {focus_it: true})
			if (e.row) {
				nav.set_cell_val(e.row, field, v, ev)
				was_set = true
			}
		}
	}

	if (range) {
		e.set_cell_val1 = function(v, ev) { set_cell_val_for(field1, v, ev) }
		e.set_cell_val2 = function(v, ev) { set_cell_val_for(field2, v, ev) }
	} else {
		e.set_cell_val  = function(v, ev) { set_cell_val_for(field , v, ev) }
	}

	e.listen('focused_row_cell_state_changed', function(te, row, f, changes, ev) {
		if (te != nav) return
		if (f != field && f != field1 && f != field2) return
		if (changes.input_val && !(ev && ev.target == e))
			set_input_values(ev)
	})

	e.listen('focused_row_changed', function(te, row, row0, ev) {
		if (te != nav) return
		set_input_values(ev)
	})

	// e.listen('col_vals_changed', update)
	// e.listen('field_changed', update)
	// e.listen('col_info_changed', update)

}


// validation rules ----------------------------------------------------------

function field_name(e) {
	return (e.label || e.name || S('value', 'value')).display_name()
}

// NOTE: this must work with values that are unparsed and invalid!
function field_value(e, v) {
	if (v == null) return 'null'
	if (isstr(v)) return v
	if (e.to_text)
		v = e.to_text(v)
	return str(v)
}

add_validation_rule({
	name: 'pk',
	props: 'pk',
	applies  : (e) => e.pk,
	validate : (e, row) => {
		let rows = e.lookup(e.pk, e.cell_input_vals(row, e.pk)).filter(row1 => row1 != row)
		return rows.length < 1
	},
	error    : (e, v) => S('validation_pk_message', '{0} is not unique',
			e.pk_fields.map(field => field.label).join(' + ')),
	rule     : (e) => S('validation_pk_rule', '{0} must be unique',
			e.pk_fields.map(field => field.label).join(' + ')),
})

add_validation_rule({
	name     : 'lookup',
	props    : 'lookup_nav lookup_cols', // TODO: lookup_nav.ready ??
	vprops   : 'input_value',
	applies  : (e) => e.lookup_fields,
	validate : (e, v) => e.lookup_fields
			&& e.lookup_nav.lookup(e.lookup_fields, [v]).len > 0,
	error    : (e, v) => S('validation_lookup_error',
		'{0} unknown value {1}', field_name(e), field_value(e, v)),
	rule     : (e) => S('validation_lookup_rule',
		'{0} value unknown', field_name(e)),
})

/* field type definitions ----------------------------------------------------


*/

{

G.field_prop_attrs = {
	label : {slot: 'lang'},
	w     : {slot: 'user'},
}

assign(all_field_types, {
	default: null,
	w: 100,
	min_w: 22,
	max_w: 2000,
	align: 'left',
	not_null: false,
	required: false,
	sortable: true,
	maxlen: 256,
	null_text : S('null_text', ''),
	empty_text: S('empty_text', 'empty text'),
})

all_field_types.to_text = function(v) {
	return String(v)
}

all_field_types.fixed_width = 0

all_field_types.draw_text = function(s, cx) {
	if (!cx)
		return s
	if (isnode(cx)) {
		cx.set(s)
		return true
	}
	cx.font = cx.text_font
	if (cx.measure) {
		cx.measured_width = cx.measureText(s).width + this.fixed_width
		return true
	}
	let x
	if (this.align == 'right')
		x = cx.cw
	else if (this.align == 'center')
		x = round(cx.cw / 2)
	else
		x = 0
	let y = round(cx.ch / 2)
	cx.textAlign = this.align
	cx.textBaseline = 'middle'
	cx.fillStyle = cx.fg_text
	cx.fillText(s, x, y)
	if (cx.quicksearch_len) {
		let s1 = s.slice(0, cx.quicksearch_len)
		let m = cx.measureText(s)
		let ascent  = m.actualBoundingBoxAscent
		let descent = m.actualBoundingBoxDescent
		let w = ceil(cx.measureText(s1).width)
		let h = cx.line_height
		cx.fillStyle = cx.bg_search
		cx.beginPath()
		cx.rect(0, round(y - h / 2), w, h)
		cx.fill()
		cx.fillStyle = cx.fg_search
		cx.fillText(s1, x, y)
	}
	return true
}

all_field_types.draw = function(v, cx) {
	let s = this.to_text(v)
	return this.draw_text(s, cx)
}

all_field_types.editor = function(opt) {
	return textedit(opt)
}

// passwords -----------------------------------------------------------------

let pwd = {}
field_types.password = pwd

pwd.editor = function(opt) {
	return pass_input(opt)
}

// numbers -------------------------------------------------------------------

let number = {align: 'right', decimals: 0, is_number: true}
field_types.number = number

number.to_text = function(s) {
	let x = num(s)
	return x != null ? x.dec(this.decimals) : s
}

number.editor = function(opt) {
	return num_input(opt)
}

// file sizes ----------------------------------------------------------------

let filesize = assign({}, number)
field_types.filesize = filesize

filesize.is_small = function(x) {
	if (x == null)
		return true
	let min = this.filesize_min
	if (min == null)
		min = 1/10**(this.filesize_decimals || 0)
	return x < min
}

filesize.to_text = function(s) {
	let x = num(s)
	if (x == null)
		return s
	let mag = this.filesize_magnitude
	let dec = this.filesize_decimals || 0
	return x.kbytes(dec, mag)
}

filesize.draw = function(x, cx) {
	let small = this.is_small(x)
	let s = this.to_text(x)
	if (isnode(cx)) {
		cx.set(s)
		cx.class('dba-insignificant-size', small)
		return true
	}
	if (cx) {
		if (small)
			cx.fg_text = cx.fg_disabled
		return this.draw_text(s, cx)
	}
	return s
}

filesize.scale_base = 1024
filesize.scales = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500]

// counts --------------------------------------------------------------------

let count = assign({}, number)
field_types.count = count

count.to_text = function(s) {
	let x = num(s)
	if (x == null)
		return s
	let mag = this.magnitude
	let dec = this.decimals || 0
	return x.kcount(dec, mag)
}

// dates ---------------------------------------------------------------------

let date = {
	align: 'right',
	is_time: true,
	w: 80,
	precision: 'd',
	format: 'sql', // sql | time
	min: parse_date('1000-01-01 00:00:00', 'SQL'),
	max: parse_date('9999-12-31 23:59:59', 'SQL'),
}
field_types.date = date

date.to_text = function(v) {
	if (!isnum(v)) // invalid
		return str(v)
	if (this.timeago)
		return v.timeago()
	return v.date(null, this.precision)
}

let inh_draw = all_field_types.draw
date.draw = function(v, cx) {
	if (isnode(cx)) {
		cx.attr('timeago', !!this.timeago)
		cx.time = t
		cx.set(t.timeago())
		return true
	}
	return inh_draw.call(this, v, cx)
}

date.to_json = function(t) {
	if (this.format == 'sql')
		return v.date('SQL', this.precision)
	return t
}

date.editor = function(opt) {
	return date_input(assign_opt({
		align: 'right',
		mode: opt.embedded ? 'fixed' : null,
	}, opt))
}

let dt = assign({}, date, {precision: 'm', w: 140})
field_types.datetime = dt

// timestamps ----------------------------------------------------------------

let ts = assign({}, date)
field_types.time = ts

ts.has_time = true
ts.min = parse_date('1970-01-01 00:00:01', 'SQL')
ts.max = parse_date('2038-01-19 03:14:07', 'SQL') // range of MySQL TIMESTAMP type

// timeofday (MySQL TIME type) -----------------------------------------------

let td = {align: 'center', is_timeofday: true}
field_types.timeofday = td

td.to_text = function(v) {
	if (!isnum(v)) // invalid
		return str(v)

}

td.editor = function(opt) {
	return timeofdayedit(opt)
}

// duration ------------------------------------------------------------------

let d = {align: 'right', is_duration: true}
field_types.duration = d

d.to_text = function(v) {
	if (!isnum(v)) return v // invalid
	return v.duration(this.duration_format)
}

// booleans ------------------------------------------------------------------

let bool = {align: 'center', min_w: 28, w: 40, is_bool: true}
field_types.bool = bool

bool.draw_null = function(cx) {
	if (isnode(cx)) {
		cx.class('fa fa-square', true)
		return true
	}
	if (cx) {
		let text_font = cx.text_font
		cx.text_font = cx.icon_font
		all_field_types.draw.call(this, '\uf0c8', cx)
		cx.text_font = text_font
		return true
	}
}

bool.draw = function(v, cx) {
	if (!isbool(v))
		return bool.draw_null.call(this, cx)
	if (isnode(cx)) {
		cx.class('fa fa-check', v == true)
		cx.class('fa-square', false)
		return true
	}
	if (cx) {
		if (!v)
			return
		let text_font = cx.text_font
		cx.text_font = cx.icon_font
		all_field_types.draw.call(this, '\uf00c', cx)
		cx.text_font = text_font
		return true
	}
	return v ? S('true', 'true') : S('false', 'false')
}

bool.editor = function(opt) {
	return checkbox(assign_opt({
		center: opt.embedded,
	}, opt))
}

// enums ---------------------------------------------------------------------

let enm = {}
field_types.enum = enm

enm.editor = function(opt) {
	return dropdown(assign_opt({
		items: words(this.enum_values),
		format_item: s => div({class: 'enum-item'}, s),
	}, opt))
}

enm.to_text = function(v) {
	let s = this.enum_texts ? this.enum_texts[v] : undefined
	return s !== undefined ? s : v
}

// tag lists -----------------------------------------------------------------

let tags = {}
field_types.tags = tags

tags.tags_format = 'words' // words | array

tags.editor = function(opt) {
	return tagsedit(assign_opt({
		mode: opt.embedded ? 'fixed' : null,
	}, opt))
}

tags.to_text = function(v) {
	return isarray(v) ? v.join(' ') : v
}

// colors --------------------------------------------------------------------

let color = {}
field_types.color = color

css('.item-color', '', `
	width: 100%;
`)

color.format = function(s) {
	return div({class: 'item-color', style: 'background-color: '+s}, '\u00A0')
}

// TODO: color.draw = function(s) {}

color.editor = function(opt) {
	return color_dropdown(assign_opt({
		mode: opt.embedded ? 'fixed' : null,
	}, opt))
}

// percents ------------------------------------------------------------------

let percent = {is_number: true}
field_types.percent = percent

percent.to_text = function(p) {
	return isnum(p) ? (p * 100).dec(this.decimals) + '%' : p
}

css('.item-progress', 'rel', `
	width: 100%;
	height: 100%;
`)

css('.item-progress-bar', 'abs', `
	top: 0; left: 0; bottom: 0;
	background-color: var(--bg-selected);
`)

// rel: so it stays on top of the absolute progress bar
css('.item-progress-text', 'rel t-c', `
	top: 0; left: 0; right: 0; bottom: 0;
`)

percent.format = function(s) {
	let bar = div({class: 'item-progress-bar'})
	let txt = div({class: 'item-progress-text'}, this.to_text(s))
	bar.style.right = (100 - (isnum(s) ? s * 100 : 0)) + '%'
	return div({class: 'item-progress'}, bar, txt)
}

// TODO: percent.draw = function(s) {}

// icons ---------------------------------------------------------------------

let icon = {}
field_types.icon = icon

icon.format = function(icon) {
	return div({class: 'fa '+icon})
}

icon.draw = function(s, cx) {
	s = fontawesome_char(s)
	if (!s)
		return
	let text_font = cx.text_font
	cx.text_font = cx.icon_font
	all_field_types.draw.call(this, s, cx)
	cx.text_font = text_font
}

icon.editor = function(opt) {
	return icon_dropdown(assign_opt({
		mode: opt.embedded ? 'fixed' : null,
	}, opt))
}

// columns -------------------------------------------------------------------

let col = {}
field_types.col = col

// google maps places --------------------------------------------------------

let place = {}
field_types.place = place

place.format_pin = function() {
	return span({
		class: 'place-pin fa fa-map-marker-alt',
		title: S('view_on_google_maps', 'View on Google Maps')
	})
}

place.format = function(v, row, place) {
	if (!place) {
		let pin = this.format_pin()
		pin.onpointerdown = function(ev) {
			if (this.place_id) {
				window.open('https://www.google.com/maps/place/?q=place_id:'+this.place_id, '_blank')
				return false
			}
		}
		let descr = span()
		place = span(0, pin, descr)
		place.pin = pin
		place.descr = descr
	}
	place.pin.place_id = isobject(v) && v.place_id
	place.pin.class('disabled', !place.pin.place_id)
	place.descr.textContent = isobject(v) ? v.description : v || ''
	return place
}

place.draw = function(v, cx) {
	let place_id = isobject(v) && v.place_id
	let descr = isobject(v) ? v.description : v || ''
	let icon_char = fontawesome_char('fa-map-marker-alt')
	let indent_x = cx.font_size * 1.25
	if (cx.measure) {
		all_field_types.draw.call(this, descr, cx)
		cx.measured_width += indent_x
		return
	}
	cx.font = cx.icon_font
	cx.fillStyle = place_id ? cx.fg_text : cx.fg_disabled
	cx.textBaseline = 'middle'
	cx.fillText(icon_char, 0, round(cx.ch / 2))
	cx.save()
	cx.translate(indent_x, 0)
	all_field_types.draw.call(this, descr, cx)
	cx.restore()
}

place.editor = function(opt) {
	return placeedit(opt)
}

// URLs ----------------------------------------------------------------------

let url = {}
field_types.url = url

url.format = function(v) {
	let href = v.match('://') ? v : 'http://' + v
	let a = tag('a', {href: href, target: '_blank'}, v)
	return a
}

url.cell_dblclick = function(cell) {
	window.open(cell.href, '_blank')
	return false // prevent enter edit
}

// phone numbers -------------------------------------------------------------

let phone = {}
field_types.phone = phone

// emails --------------------------------------------------------------------

let email = {}
field_types.email = email

email.validator_email = {
	validate : (e, v) => v.includes('@'),
	error    : (e, v) => S('validation_error_email', 'Not a valid email.'),
	rule     : (e) => S('validation_rule_email', 'Email must be valid.'),
}

// buttons -------------------------------------------------------------------

let btn = {align: 'center', readonly: true}
field_types.button = btn

btn.format = function(val, row) {
	let field = this
	return button(assign_opt({
		tabindex: null, // don't steal focus from the grid when clicking.
		style: 'flex: 1',
		action: function() {
			field.action.call(this, val, row, field)
		},
	}, this.button_options))
}

btn.draw = function(v, cx) {
	// TODO
}

btn.click = function() {
	// TODO
}

// public_key, secret_key, private_key ---------------------------------------

field_types.secret_key = {
	editor: function(opt) {
		return textedit(assign_opt({
			attrs: {mono: true},
		}, opt))
	},
}

field_types.public_key = {
	editor: function(opt) {
		return textarea(assign_opt({
			attrs: {mono: true},
		}, opt))
	},
}

field_types.private_key = {
	editor: function(opt) {
		return textarea(assign_opt({
			attrs: {mono: true},
		}, opt))
	},
}

}

// reload push-notifications -------------------------------------------------

G.rowset_navs = obj() // {rowset_name -> set(nav)}

let init_rowset_events = memoize(function() {
	let es = new EventSource('/xrowset.events')
	es.onmessage = function(ev) {
		let a = ev.data.words()
		let [rowset_name, filter] = a.shift().replaceAll(':', ' ').words()
		let navs = rowset_navs[rowset_name]
		if (navs)
			for (let nav of navs)
				nav.reload({allow_diff_merge: true, update_ids: a, if_filter: filter})
	}
})


}()) // module function

