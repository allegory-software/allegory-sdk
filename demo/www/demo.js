
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

let admin_profile_menu_items = [ // profile menu of admins
	profile_menu_items[0],
	null,
	{id: 'impersonate_button', label: 'Impersonate', icon: 'user-share'},
	profile_menu_items[2],
]

function profile_button() {
	if (user.impersonating) {
		mr(sp1())
		let unimpersonate = bare_button('unimpersonate_button', 'user-x',
			user.name || user.email, 0, null, null, false,
			'Stop impersonating')
		if (unimpersonate)
			ui.unimpersonate()
	}
	mr(sp1())
	profile_menu_items[0].checked = ui.saved_state.globals?.theme == 'light'
	let profile_action = bare_menu_button('profile_button', 'user-circle', '',
		user.is_admin ? admin_profile_menu_items : profile_menu_items)
	if (profile_action == 'lights_button') {
		let theme = ui.screen_theme() == 'dark' ? 'light' : 'dark'
		ui.save_state('globals', 'theme', theme)
		ui.set_screen_theme(theme)
	} else if (profile_action == 'impersonate_button') {
		ui.set_modal_open('impersonate_modal', true)
	} else if (profile_action == 'sign_out_button') {
		ui.logout()
	}
}

ui.rowsets.saved_state = { // saved widget state rowset
	category: 'Demo',
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

// Use distinct state IDs for chooser buttons and replacement widgets.
// ui.state(id, update) can otherwise run the widget's update on the
// previous button state, before the widget initializes its fields.
function app_dock_empty_tab(tab) {
	let tab_id = 'app_dock.tab.'+tab.id
	let s = ui.state(tab_id+'.rowsets')
	if (!s.free) {
		s.items = [] // [{id, label, items: [{id, label, icon}]}]
		s.menu_items = {} // {rowset_name -> {id, label, icon}}
		s.load_error = null // rowset listing error text or null
		s.request = null // rowset listing request or null
		ui.on_free(tab_id+'.rowsets', function(s) {
			if (s.request) s.request.abort()
		})
		s.request = glue.get('/rowset.json/rowsets', function(rowsets) {
			s.request = null
			let category_items = new Map()
			for (let [name, label, category, icon] of rowsets.rows) {
				let item = {id: name, label, icon}
				attr(category_items, category, array).push(item)
				s.menu_items[name] = item
			}
			for (let name in ui.rowsets) {
				let rowset = ui.rowsets[name]
				if (!rowset.internal) {
					let item = {id: name, label: rowset.label ?? name,
						icon: rowset.icon}
					attr(category_items, rowset.category ?? 'Other', array).push(item)
					s.menu_items[name] = item
				}
			}
			s.items = []
			for (let [category, items] of category_items)
				s.items.push({id: 'category.'+category, label: category, items})
			ui.animate()
		}, function(error, type) {
			if (type == 'abort') return
			s.request = null
			s.load_error = error
			ui.animate()
		}, {silent: true})
	}
	ui.scrollbox(tab_id+'.scrollbox', 1, 'auto', 'auto', 's', 's')
		v(0, sp2(), 'c', 'c')
			if (button(tab_id+'.container', 'layout', 'Container'))
				set_dock_tab('app_dock', tab.id,
					{title: 'Container', icon: 'layout',
						layout: {tabs: []}})
			let closed_containers = ui.dock_closed_containers('app_dock')
			let closed_container_id = menu_button(tab_id+'.containers_button',
				'archive', 'Containers', closed_containers, null, null, null, null,
				!closed_containers.length)
			if (closed_container_id)
				ui.restore_dock_container('app_dock', tab.id, closed_container_id)
			if (button(tab_id+'.db_tables', 'list-details', 'Tables'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'db_tables', title: 'Tables', icon: 'list-details'})
			if (button(tab_id+'.db_rows', 'table-row', 'Rows'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'db_rows', title: 'Rows', icon: 'table-row'})
			if (button(tab_id+'.db_fields', 'table-column', 'Fields'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'db_fields', title: 'Fields', icon: 'table-column'})
			if (button(tab_id+'.db_indexes', 'list-search', 'Indexes'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'db_indexes', title: 'Indexes', icon: 'list-search'})
			if (button(tab_id+'.process_tree', 'hierarchy', 'Process tree'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'process_tree', title: 'Process tree', icon: 'hierarchy'})
			if (button(tab_id+'.folder_tree', 'folder', 'Folder tree'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'folder_tree', title: 'Folder tree', icon: 'folder'})
			if (button(tab_id+'.file_editor_button', 'file-code', 'File editor'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'file_editor', title: 'File editor', icon: 'file-code'})
			if (button(tab_id+'.open_ports', 'network', 'Open ports'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'open_ports', title: 'Open ports', icon: 'network'})
			if (button(tab_id+'.saved_state', 'database', 'Saved state'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'saved_state', title: 'Saved state', icon: 'database'})
			let rowset_name = menu_button(tab_id+'.rowsets_button',
				'database', 'Rowsets', s.items, null, null, null, null,
				!!s.request || !!s.load_error)
			if (rowset_name)
				set_dock_tab('app_dock', tab.id, {
					kind: 'rowset', title: s.menu_items[rowset_name].label,
					icon: s.menu_items[rowset_name].icon ?? 'database',
					args: {rowset_name: rowset_name},
				})
			if (s.load_error) text('', s.load_error, 0)
			if (button(tab_id+'.call', 'phone', 'Call'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'call', title: 'Call', icon: 'phone'})
			if (button(tab_id+'.model3_editor', 'cube', 'Model editor'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'model3_editor', title: 'Model editor', icon: 'cube'})
			if (button(tab_id+'.house_model_editor', 'building-cottage',
					'House model editor'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'house_model_editor', title: 'House model editor',
						icon: 'building-cottage'})
			if (button(tab_id+'.floor_editor', 'layout-board', 'Floor editor'))
				set_dock_tab('app_dock', tab.id,
					{kind: 'floor_editor', title: 'Floor editor',
						icon: 'layout-board'})
		end_v()
	ui.end_scrollbox()
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
	} else if (tab.kind == 'file_editor') {
		ui.file_editor('app_dock.tab.'+tab.id+'.file_editor')
	} else if (tab.kind == 'open_ports') {
		ui.open_ports('app_dock.tab.'+tab.id+'.open_ports')
	} else if (tab.kind == 'saved_state') {
		saved_state_grid('app_dock.tab.'+tab.id+'.saved_state.grid')
	} else if (tab.kind == 'rowset') {
		let id = 'app_dock.tab.'+tab.id+'.rowset'
		ui.grid(id, {
			rowset_name: tab.args.rowset_name,
		})
		let nav = ui.state_of(id, 'nav')
		if (nav.ready)
			ui.set_current_tab_title(nav.label)
	} else if (tab.kind == 'call') {
		let id = 'app_dock.tab.'+tab.id+'.call'
		let s = ui.state(id)
		if (!s.free) {
			s.demo_call = null // {call, invite_token} or null before loading
			s.load_error = null // credentials error text or null
			s.request = null // credentials request or null
			ui.on_free(id, function(s) {
				if (s.request) s.request.abort()
			})
			s.request = glue.get('/call_demo.json', function(demo_call) {
				s.request = null
				s.demo_call = demo_call
				ui.animate()
			}, function(error, type) {
				if (type == 'abort') return
				s.request = null
				s.load_error = error
				ui.animate()
			}, {silent: true})
		}
		v(1, sp(), 's', 's')
			if (s.request) text('', 'Loading demo call...', 0)
			if (s.load_error) text('', s.load_error, 0)
			ui.call(id+'.widget', {
				call_id: s.demo_call ? String(s.demo_call.call) : null,
				invite_token: s.demo_call?.invite_token,
				name: user.name,
				can_join: s.demo_call != null,
			})
		end_v()
	} else if (tab.kind == 'model3_editor') {
		ui.model3_editor('app_dock.tab.'+tab.id+'.model3_editor.widget', {},
			ui.model3_editor_test_objects)
	} else if (tab.kind == 'house_model_editor') {
		let id = 'app_dock.tab.'+tab.id+'.house_model_editor'
		ui.unit_model_editor(id+'.widget')
	} else if (tab.kind == 'floor_editor') {
		let id = 'app_dock.tab.'+tab.id+'.floor_editor'
		ui.unit_plan_editor(id+'.widget')
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
	restore_tab(tab) {
		if (tab.kind == 'rowset'
				&& !(isstr(tab.args?.rowset_name) && tab.args.rowset_name))
			return {id: tab.id}
		return tab
	},
}

main = function() {
	if (!login_window())
		return
	ui.set_screen_theme(ui.saved_state.globals?.theme)
	dock('app_dock', {tabs: []}, app_dock_tab, app_dock_tab_opt)
	ui.impersonate_modal('table_user')
}
