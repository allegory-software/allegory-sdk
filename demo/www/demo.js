
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
		let is_unimpersonate_clicked = bare_button('unimpersonate_button',
			'user-x', user.name || user.email, 0, null, null, false,
			'Stop impersonating')
		if (is_unimpersonate_clicked)
			unimpersonate()
	}
	mr(sp1())
	profile_menu_items[0].checked = saved_state.globals?.theme == 'light'
	let profile_action = bare_menu_button('profile_button', 'user-circle', '',
		user.is_admin ? admin_profile_menu_items : profile_menu_items)
	if (profile_action == 'lights_button') {
		let theme = screen_theme() == 'dark' ? 'light' : 'dark'
		save_state('globals', 'theme', theme)
		set_screen_theme(theme)
	} else if (profile_action == 'impersonate_button') {
		set_modal_open('impersonate_modal', true)
	} else if (profile_action == 'sign_out_button') {
		logout()
	}
}

rowsets.saved_state = { // saved widget state rowset
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
		for (let widget_id in saved_state) {
			let dot_i = widget_id.indexOf('.') // first dot index
			let state_id = dot_i < 0 ? widget_id : widget_id.slice(0, dot_i)
			let sub_id = dot_i < 0 ? null : widget_id.slice(dot_i + 1)
			let saved_vars = saved_state[widget_id] // map or malformed value
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
					save_state(old_widget_id)
				else
					save_state(old_widget_id, old_key, undefined)
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
				let saved_vars = saved_state[widget_id] // {state key -> value}
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
				value = saved_state[old_widget_id][old_key]
			}
			if (is_renamed)
				save_state(old_widget_id, old_key, undefined)
			save_state(widget_id, state_key, value)
			return {}
		})}
	},
}

function saved_state_grid(id) {
	grid(id, {rowset_name: 'saved_state'})
}

views.saved_state = {
	label: 'Saved state', icon: 'database', category: 'Tools',
	build: function(id) { saved_state_grid(id+'.grid') },
}

views.call = {
	label: 'Call', icon: 'phone', category: 'Tools',
	build: function(id) {
		let s = state(id)
		if (!s.free) {
			s.demo_call = null // {call, invite_token} or null before loading
			s.load_error = null // credentials error text or null
			s.request = null // credentials request or null
			on_free(id, function(s) {
				if (s.request) s.request.abort()
			})
			s.request = glue.get('/call_demo.json', function(demo_call) {
				s.request = null
				s.demo_call = demo_call
				animate()
			}, function(error, type) {
				if (type == 'abort') return
				s.request = null
				s.load_error = error
				animate()
			}, {silent: true})
		}
		v(1, sp(), 's', 's')
			if (s.request) text('', 'Loading demo call...', 0)
			if (s.load_error) text('', s.load_error, 0)
			call(id+'.widget', {
				call_id: s.demo_call ? String(s.demo_call.call) : null,
				invite_token: s.demo_call?.invite_token,
				name: user.name,
				can_join: s.demo_call != null,
			})
		end_v()
	},
}

views.model3_editor = {
	label: 'Model editor', icon: 'cube', category: 'Editors',
	build: function(id) {
		model3_editor(id+'.widget', {}, model3_editor_test_objects)
	},
}

function cmp_label(a, b) {
	return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

// query: folded search text or null for no search.
function label_matches(label, query) {
	return !query || fold_text(label).includes(query)
}

// first leaf tab in layout order that has a category -> {category, icon}
function find_container_category(node, rowset_info) {
	if (node.split)
		return find_container_category(node.side1, rowset_info)
			?? find_container_category(node.side2, rowset_info)
	for (let tab of node.tabs) {
		if (tab.layout) {
			let found = find_container_category(tab.layout, rowset_info)
			if (found)
				return found
		} else if (tab.kind == 'rowset') {
			let info = rowset_info.get(tab.args.rowset_name)
			if (info)
				return info
		} else {
			let view = views[tab.kind]
			if (view?.category)
				return {category: view.category, icon: view.icon}
		}
	}
}

// Use distinct state IDs for chooser buttons and replacement widgets.
// state(id, update) can otherwise run the widget's update on the
// previous button state, before the widget initializes its fields.
function app_dock_empty_tab(tab) {
	let tab_id = 'app_dock.tab.'+tab.id

	let s = state(tab_id+'.rowsets')
	if (!s.free) {
		s.items = [] // [{id, label, items: [{id, label, icon}]}]
		s.rowset_info = new Map() // {rowset name -> {category, icon}}
		s.load_error = null // rowset listing error text or null
		s.request = null // rowset listing request or null
		focus(tab_id+'.search')
		on_free(tab_id+'.rowsets', function(s) {
			if (s.request) s.request.abort()
		})
		s.request = glue.get('/rowset.json/rowsets', function(response_rowsets) {
			s.request = null
			let category_items = new Map()
			for (let [name, label, category, icon] of response_rowsets.rows) {
				icon = icon ?? 'database'
				let item = {id: name, label: label ?? display_name(name), icon}
				attr(category_items, category, array).push(item)
				s.rowset_info.set(name, {category, icon})
			}
			for (let name in rowsets) {
				let rowset = rowsets[name]
				if (!rowset.internal) {
					let icon = rowset.icon ?? 'database'
					let item = {id: name,
						label: rowset.label ?? display_name(name), icon}
					let category = rowset.category ?? 'Other'
					attr(category_items, category, array).push(item)
					s.rowset_info.set(name, {category, icon})
				}
			}
			s.items = []
			for (let [category, items] of category_items) {
				items.sort(cmp_label)
				s.items.push({id: 'category.'+category, label: category, items})
			}
			animate()
		}, function(error, type) {
			if (type == 'abort') return
			s.request = null
			s.load_error = error
			animate()
		}, {silent: true})
	}

	scrollbox(tab_id+'.scrollbox', 1, 'auto', 'auto', 's', 's')
		p(sp4(), sp8())

		v(0, sp2(), 'c', 't')

			ui.min_w(ui.em(36))
			h(0, sp2(), 'c')

				icon('', 'search', 0, 'c', 'c')
				let search = input(tab_id+'.search')

				if (s.load_error) text('', s.load_error, 0)

			end_h()

			let query = search ? fold_text(search) : null

			// containers: "New Container" first, then closed containers,
			// each in its first child's category.
			let categories = new Map()
			if (label_matches('New Container', query)) {
				let item = {container: true, id: null, label: 'New Container',
					icon: 'layout'}
				attr(categories, 'Containers', array).push(item)
			}
			for (let closed of dock_closed_containers('app_dock')) {
				if (!label_matches(closed.label, query))
					continue
				let found = find_container_category(closed.layout, s.rowset_info)
				let item = {container: true, id: closed.id, label: closed.label,
					icon: found?.icon ?? 'layout'}
				attr(categories, found?.category ?? 'Containers', array).push(item)
			}

			for (let name in views) {
				let view = views[name]
				if (!label_matches(view.label, query))
					continue
				attr(categories, view.category, array).push(name)
			}
			for (let category of s.items)
				for (let item of category.items)
					if (label_matches(item.label, query))
						attr(categories, category.label, array).push(item)

			// "Containers" first, then the other categories alphabetically.
			let category_names = [] // [category, ...]
			for (let category of categories.keys())
				if (category != 'Containers')
					category_names.push(category)
			category_names.sort()
			if (categories.has('Containers'))
				category_names.unshift('Containers')

			let k = 1
			for (let category of category_names) {
				let choices = categories.get(category)
				bold()
				mt(sp2())
				large()
				color('link')
				text('', category, 0)
				v(0, sp2())
					let cols = 5
					for (let i = 0; i < choices.length; i++) {
						if (i % 5 == 0)
							h(0, sp1(), 'l', 't')
						let choice = choices[i]
						let is_container = !isstr(choice) && choice.container
						let is_rowset = !isstr(choice) && !is_container
						let name = is_container ? choice.id ?? 'new'
							: is_rowset ? choice.id : choice
						let view = is_container || is_rowset ? choice : views[name]
						let icon = view.icon
						let button_id = tab_id+'.'
							+ (is_container ? 'container.' : is_rowset ? 'rowset.' : '')
							+ name+'_button'
						min_w(em(3))
						v(0, sp(), 'c', 't')
							if (button(button_id, icon, null, 0, 'c')) {
								if (is_container) {
									if (choice.id == null)
										set_dock_tab('app_dock', tab.id,
											{title: 'Container', icon: 'layout',
												layout: {tabs: []}})
									else
										restore_dock_container('app_dock', tab.id,
											choice.id)
								} else if (is_rowset) {
									set_dock_tab('app_dock', tab.id, {
										kind: 'rowset', title: view.label, icon: icon,
										args: {rowset_name: name},
									})
								} else {
									set_dock_tab('app_dock', tab.id, {
										kind: name, title: view.label, icon: icon,
									})
								}
							}
							//small()
							text_wrapped('view.'+k++, view.label.trim(), 0, 'c', 't')//, em(3))
						end_v()
						if (i % cols == cols-1 || i == choices.length - 1)
							end_h()
					}
				end_v()
			}

		end_v()
	end_scrollbox()
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
	let view = views[tab.kind]
	if (view) {
		view.build('app_dock.tab.'+tab.id+'.'+tab.kind, tab.args)
	} else if (tab.kind == 'rowset') {
		let id = 'app_dock.tab.'+tab.id+'.rowset'
		grid(id, {
			rowset_name: tab.args.rowset_name,
		})
		let nav = state_of(id, 'nav')
		if (nav.ready)
			set_current_tab_title(nav.label)
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
	set_screen_theme(saved_state.globals?.theme)
	dock('app_dock', {tabs: []}, app_dock_tab, app_dock_tab_opt)
	impersonate_modal('table_user')
}
