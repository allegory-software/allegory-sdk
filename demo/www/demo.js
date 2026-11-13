
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

ui.views.saved_state = {
	label: 'Saved state', icon: 'database', category: 'Tools',
	build: function(id) { saved_state_grid(id+'.grid') },
}

ui.views.call = {
	label: 'Call', icon: 'phone', category: 'Tools',
	build: function(id) {
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
	},
}

ui.views.model3_editor = {
	label: 'Model editor', icon: 'cube', category: 'Editors',
	build: function(id) {
		ui.model3_editor(id+'.widget', {}, ui.model3_editor_test_objects)
	},
}

// Use distinct state IDs for chooser buttons and replacement widgets.
// ui.state(id, update) can otherwise run the widget's update on the
// previous button state, before the widget initializes its fields.
function app_dock_empty_tab(tab) {
	let tab_id = 'app_dock.tab.'+tab.id

	let s = ui.state(tab_id+'.rowsets')
	if (!s.free) {
		s.items = [] // [{id, label, items: [{id, label, icon}]}]
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
			}
			for (let name in ui.rowsets) {
				let rowset = ui.rowsets[name]
				if (!rowset.internal) {
					let item = {id: name, label: rowset.label ?? name,
						icon: rowset.icon}
					attr(category_items, rowset.category ?? 'Other', array).push(item)
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
		ui.p(ui.sp4(), ui.sp8())
		v(0, sp2(), 'c', 'c')

			ui.h(0, ui.sp2())

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

				if (s.load_error) text('', s.load_error, 0)

			ui.end_h()

			let categories = new Map()
			for (let name in ui.views) {
				let view = ui.views[name]
				attr(categories, view.category, array).push(name)
			}
			for (let category of s.items)
				for (let item of category.items)
					attr(categories, category.label, array).push(item)

			let k = 1
			for (let [category, choices] of categories) {
				ui.bold()
				ui.mt(ui.sp2())
				ui.large()
				ui.color('link')
				ui.text('', category, 0)
				v(0, sp2())
					for (let i = 0; i < choices.length; i++) {
						if (i % 6 == 0)
							ui.h(0, ui.sp1(), 'l', 't')
						let choice = choices[i]
						let is_rowset = !isstr(choice)
						let name = is_rowset ? choice.id : choice
						let view = is_rowset ? choice : ui.views[name]
						let icon = is_rowset ? view.icon ?? 'database' : view.icon
						let button_id = tab_id+'.'
							+ (is_rowset ? 'rowset.' : '')+name+'_button'
						ui.min_w(ui.em(3))
						v(0, ui.sp(), 'c', 't')
							if (button(button_id, icon, null, 0, 'c')) {
								if (is_rowset) {
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
							ui.text_wrapped('view.'+k++, view.label.trim(), 0, 'c', 't')//, ui.em(3))
						end_v()
						if (i % 6 == 5 || i == choices.length - 1)
							ui.end_h()
					}
				end_v()
			}

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
	let view = ui.views[tab.kind]
	if (view) {
		view.build('app_dock.tab.'+tab.id+'.'+tab.kind, tab.args)
	} else if (tab.kind == 'rowset') {
		let id = 'app_dock.tab.'+tab.id+'.rowset'
		ui.grid(id, {
			rowset_name: tab.args.rowset_name,
		})
		let nav = ui.state_of(id, 'nav')
		if (nav.ready)
			ui.set_current_tab_title(nav.label)
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
