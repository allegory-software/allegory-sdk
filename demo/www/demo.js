
listen('ajax_error', function(...args) {
	_(...args)
	let [message, type, status] = args
	if (type == 'http' && status == 403) {
		user.signed_in = false
		animate()
	}
})

let profile_menu_items = [ // [{id, label}]
	{id: 'lights_button', label: 'Lights', icon: 'sun'},
	null,
	{id: 'sign_out_button', label: 'Sign out', icon: 'logout'},
]

function profile_button() {
	mr(sp1())
	profile_menu_items[0].checked = ui.saved_state.globals?.theme == 'light'
	let profile_action = bare_menu_button(
		'profile_button', 'user-circle', '', profile_menu_items)
	if (profile_action == 'lights_button') {
		let theme = ui.screen_theme() == 'dark' ? 'light' : 'dark'
		ui.save_state('globals', 'theme', theme)
		ui.set_screen_theme(theme)
	} else if (profile_action == 'sign_out_button') {
		post('/logout.json', null,
			function(new_user) {
				user = new_user
				animate()
			},
			function(e) { alert(e) }
		)
	}
}

ui.rowsets.saved_state = { // saved widget state rowset
	fields: [
		{name: 'id', not_null: true},
		{name: 'sub_id'},
		{name: 'key', not_null: true},
		{name: 'value'},
	],
	pk: 'id sub_id key',
	can_move_rows: false,
	get rows() {
		let rows = [] // [[id, sub-id, state key, JSON value], ...]
		for (let widget_id in ui.saved_state) {
			let dot_i = widget_id.indexOf('.') // first dot index
			let state_id = dot_i < 0 ? widget_id : widget_id.slice(0, dot_i)
			let sub_id = dot_i < 0 ? null : widget_id.slice(dot_i + 1)
			let saved_vars = ui.saved_state[widget_id] // map or malformed value
			if (isobj(saved_vars)) {
				for (let state_key in saved_vars)
					rows.push([state_id, sub_id, state_key,
						json(saved_vars[state_key])])
			} else {
				rows.push([state_id, sub_id, null, json(saved_vars)])
			}
		}
		return rows
	},
	save(changes) {
		return {rows: changes.rows.map(function(row) {
			let values = row.values
			let old_id = values['id:old']
			let old_sub_id = values['sub_id:old']
			let old_key = values['key:old']
			let old_widget_id = old_sub_id == null
				? old_id : old_id+'.'+old_sub_id
			if (row.type == 'remove') {
				if (old_key == null)
					ui.save_state(old_widget_id)
				else
					ui.save_state(old_widget_id, old_key, undefined)
				return {remove: true}
			}
			let state_id = values.id ?? old_id
			let sub_id = values.sub_id !== undefined
				? values.sub_id : old_sub_id
			let state_key = values.key ?? old_key
			let widget_id = sub_id == null ? state_id : state_id+'.'+sub_id
			let is_new = row.type == 'new'
			let is_renamed = !is_new
				&& (widget_id != old_widget_id || state_key != old_key)
			if (is_new || is_renamed) {
				let saved_vars = ui.saved_state[widget_id] // {state key -> value}
				if (saved_vars && state_key in saved_vars)
					return {error: 'Saved setting already exists'}
			}
			let value
			if (is_new || values.value !== undefined) {
				try {
					value = json_arg(values.value ?? null)
				} catch (err) {
					return {field_errors: {value: err.message}}
				}
			} else {
				value = ui.saved_state[old_widget_id][old_key]
			}
			if (is_renamed)
				ui.save_state(old_widget_id, old_key, undefined)
			ui.save_state(widget_id, state_key, value)
			return {}
		})}
	},
}

function saved_state_grid(id) {
	ui.grid(id, {rowset_name: 'saved_state'})
}

function app_dock_empty_tab(tab) {
	let tab_id = 'app_dock.tab.'+tab.id
	v(0, sp2(), 'c', 'c')
		if (button(tab_id+'.container', 'layout', 'Container'))
			set_dock_tab('app_dock', tab.id,
				{label: 'Container', icon: 'layout', layout: {tabs: []}})
		if (button(tab_id+'.db_tables', 'list-details', 'Tables'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'db_tables', label: 'Tables', icon: 'list-details'})
		if (button(tab_id+'.db_rows', 'table-row', 'Rows'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'db_rows', label: 'Rows', icon: 'table-row'})
		if (button(tab_id+'.db_fields', 'table-column', 'Fields'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'db_fields', label: 'Fields', icon: 'table-column'})
		if (button(tab_id+'.db_indexes', 'list-search', 'Indexes'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'db_indexes', label: 'Indexes', icon: 'list-search'})
		if (button(tab_id+'.process_tree', 'hierarchy', 'Process tree'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'process_tree', label: 'Process tree', icon: 'hierarchy'})
		if (button(tab_id+'.folder_tree', 'folder', 'Folder tree'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'folder_tree', label: 'Folder tree', icon: 'folder'})
		if (button(tab_id+'.open_ports', 'network', 'Open ports'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'open_ports', label: 'Open ports', icon: 'network'})
		if (button(tab_id+'.saved_state', 'database', 'Saved state'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'saved_state', label: 'Saved state', icon: 'database'})
	end_v()
}

function app_dock_app_tab(tab) {
	v(0, sp2(), 's', 't')
		text('', tab.kind)
		if (tab.kind == 'notes') {
			input('app_dock.tab.'+tab.id+'.text')
		}
	end_v()
}

function app_dock_tab(tab) {
	if (tab.kind == 'db_tables') {
		ui.db_tables('app_dock.tab.'+tab.id+'.db_tables')
	} else if (tab.kind == 'db_rows') {
		ui.db_rows('app_dock.tab.'+tab.id+'.db_rows')
	} else if (tab.kind == 'db_fields') {
		ui.db_fields('app_dock.tab.'+tab.id+'.db_fields')
	} else if (tab.kind == 'db_indexes') {
		ui.db_indexes('app_dock.tab.'+tab.id+'.db_indexes')
	} else if (tab.kind == 'process_tree') {
		ui.process_tree('app_dock.tab.'+tab.id+'.process_tree')
	} else if (tab.kind == 'folder_tree') {
		ui.folder_tree('app_dock.tab.'+tab.id+'.folder_tree', '~')
	} else if (tab.kind == 'open_ports') {
		ui.open_ports('app_dock.tab.'+tab.id+'.open_ports')
	} else if (tab.kind == 'saved_state') {
		saved_state_grid('app_dock.tab.'+tab.id+'.saved_state.grid')
	} else if (tab.kind) {
		app_dock_app_tab(tab)
	} else {
		app_dock_empty_tab(tab)
	}
}

function app_dock_tab_strip(tablist_id, selected_tab, tablist, layout) {
	let top_right_tablist = layout // current node on the upper-right path
	while (top_right_tablist.split)
		top_right_tablist = top_right_tablist.split == 'h'
			? top_right_tablist.side2 : top_right_tablist.side1
	if (tablist == top_right_tablist) {
		profile_button()
	}
}

let app_dock_tab_opt = { // dock options
	on_build_strip: app_dock_tab_strip,
}

main = function() {
	if (!login_window())
		return
	ui.set_screen_theme(ui.saved_state.globals?.theme)
	dock('app_dock', {tabs: []}, app_dock_tab, app_dock_tab_opt)
}
