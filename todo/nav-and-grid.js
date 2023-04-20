
server-side properties:
	publishes:
		e.sql_select_all
		e.sql_select
		e.sql_select_one
		e.sql_select_one_update
		e.sql_pk
		e.sql_insert_fields
		e.sql_update_fields
		e.sql_where
		e.sql_where_row
		e.sql_where_row_update
		e.sql_schema
		e.sql_db



	// server-side props ------------------------------------------------------

	e.set_sql_db = function(v) {
		if (!e.id)
			return
		e.rowset_url = v ? '/sql_rowset.json/' + e.id : null
		e.reload()
	}

	e.set_sql_select = e.reload

	e.prop('sql_select_all'        , {slot: 'server'})
	e.prop('sql_select'            , {slot: 'server'})
	e.prop('sql_select_one'        , {slot: 'server'})
	e.prop('sql_select_one_update' , {slot: 'server'})
	e.prop('sql_pk'                , {slot: 'server'})
	e.prop('sql_insert_fields'     , {slot: 'server'})
	e.prop('sql_update_fields'     , {slot: 'server'})
	e.prop('sql_where'             , {slot: 'server'})
	e.prop('sql_where_row'         , {slot: 'server'})
	e.prop('sql_where_row_update'  , {slot: 'server'})
	e.prop('sql_schema'            , {slot: 'server'})
	e.prop('sql_db'                , {slot: 'server'})



// ---------------------------------------------------------------------------
// global one-row nav for all standalone (i.e. not bound to a nav) widgets.
// ---------------------------------------------------------------------------

G.global_val_nav = function() {
	global_val_nav = () => nav // memoize.
	let nav = bare_nav({
		rowset: {
			fields: [],
			rows: [[]],
		},
	})
	head.add(nav)
	nav.focus_cell(true, false)
	return nav
}


------------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// grid dropdown
// ---------------------------------------------------------------------------

G.grid_dropdown = component('grid-dropdown', function(e) {

	e.class('grid-dropdown')
	nav_dropdown_widget(e)

	e.create_picker = function(opt) {
		return element(assign_opt(opt, {
			tag: 'grid',
			id: e.id && e.id + '.dropdown',
			val_col: e.val_col,
			display_col: e.display_col,
			rowset: e.rowset,
			rowset_name: e.rowset_name,
		}, e.grid))
	}

})

// ---------------------------------------------------------------------------
// row form
// ---------------------------------------------------------------------------

G.row_form = component('row-frm', function(e) {

	e.class('row-form')
	grid.props.vertical = {default: true}

	e.construct('grid', null, false)

	function bind_nav(nav, on) {
		if (!e.bound)
			return
		if (!nav)
			return
		nav.on('reset'                          , reset, on)
		nav.on('focused_row_changed'            , row_changed, on)
		nav.on('display_vals_changed'           , display_vals_changed, on)
		nav.on('focused_row_cell_state_changed' , focused_row_cell_state_changed, on)
		nav.on('col_attr_changed'               , col_attr_changed, on)
	}

	e.on_bind(function(on) {
		bind_nav(e._nav, on)
	})

	e.set_nav = function(nav1, nav0) {
		assert(nav1 != e)
		bind_nav(nav0, false)
		bind_nav(nav1, true)
		reset()
	}

	e.prop('nav'    , {private: true})
	e.prop('nav_id' , {bind_id: 'nav', type: 'nav', attr: 'nav'})

	function reset() {
		e.rowset.fields = e._nav.all_fields_map
		e.rowset.rows = [e._nav.focused_row]
		e.reset()
		e.row = e.all_rows[0]
	}

	function row_changed(nav_row) {
		e.all_rows = [nav_row]
		e.row = e.all_rows[0]
		//for (let i = 0; i < e.all_fields.length; i++)

	}

	function display_vals_changed() {
		e.update()
	}

	function focused_row_cell_state_changed(row, nav_field, changes) {
		if (e.updating)
			return
		let field = e.all_fields[nav_field.val_index]
		if (changes.val)
			e.reset_cell_val(row, field, changes.val[0])
		else if (changes.input_val)
			e.set_cell_val(row, field, changes.input_val[0])
	}

	function col_attr_changed(col, attr, val) {
		if (attr == 'text')
			e.set_prop('col.'+col+'.'+attr, val)
	}

	e.on('cell_state_changed', function(row, field, changes) {
		if (changes.input_val) {
			let nav_row = e._nav.all_rows[e.row_index(row)]
			let nav_field = e._nav.all_fields[e.field_index(field)]
			e._nav.set_cell_val(nav_row, nav_field, changes.input_val[0])
		}
	})

})

// ---------------------------------------------------------------------------
// grid profile
// ---------------------------------------------------------------------------

G.grid_profile = component('grid-profile', function(e) {

	tabs_item_widget(e)

})

