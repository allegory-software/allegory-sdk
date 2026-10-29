
listen('ajax_error', function(...args) {
	_(...args)
	let [message, type, status] = args
	if (type == 'http' && status == 403) {
		user.signed_in = false
		animate()
	}
})

let profile_menu_items = [ // [{id, label}]
	{id: 'sign_out_button', label: 'Sign out', icon: 'logout'},
]

function profile_button() {
	mr(sp1())
	let profile_action = bare_menu_button(
		'profile_button', 'user-circle', '', profile_menu_items)
	if (profile_action == 'sign_out_button') {
		post('/logout.json', null,
			function(new_user) {
				user = new_user
				animate()
			},
			function(e) { alert(e) }
		)
	}
}

function app_dock_empty_tab(tab) {
	let tab_id = 'app_dock.tab.'+tab.id
	v(0, sp2(), 'c', 'c')
		if (button(tab_id+'.container', 'layout', 'Container'))
			set_dock_tab('app_dock', tab.id,
				{label: 'Container', layout: {tabs: []}})
		if (button(tab_id+'.db_explorer', 'database-search',
			'Database explorer'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'db_explorer', label: 'Database explorer'})
		if (button(tab_id+'.process_tree', 'hierarchy', 'Process tree'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'process_tree', label: 'Process tree'})
		if (button(tab_id+'.folder_tree', 'folder', 'Folder tree'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'folder_tree', label: 'Folder tree'})
		if (button(tab_id+'.open_ports', 'network', 'Open ports'))
			set_dock_tab('app_dock', tab.id,
				{kind: 'open_ports', label: 'Open ports'})
	end_v()
}

function app_dock_app_tab(tab) {
	v(0, sp2(), 's', 't')
		text('', tab.kind+': '+tab.label)
		if (tab.kind == 'notes') {
			saved_value(tab_id+'.text', null)
			input(tab_id+'.text', null)
		}
	end_v()
}

function app_dock_tab(tab) {
	if (tab.kind == 'db_explorer') {
		ui.db_explorer('app_dock.tab.'+tab.id+'.db_explorer')
	} else if (tab.kind == 'process_tree') {
		ui.process_tree('app_dock.tab.'+tab.id+'.process_tree')
	} else if (tab.kind == 'folder_tree') {
		ui.folder_tree('app_dock.tab.'+tab.id+'.folder_tree', '~/sdk')
	} else if (tab.kind == 'open_ports') {
		ui.open_ports('app_dock.tab.'+tab.id+'.open_ports')
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
	dock('app_dock', {tabs: []}, app_dock_tab, app_dock_tab_opt)
}
