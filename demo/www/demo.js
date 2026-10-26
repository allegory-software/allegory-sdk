
listen('ajax_error', function(...args) {
	_(...args)
	let [message, type, status] = args
	if (type == 'http' && status == 403) {
		user.signed_in = false
		animate()
	}
})

const profile_menu_items = [ // [{id, label}]
	{id: 'sign_out_button', label: 'Sign out'},
]

main = function() {

	if (!login_window())
		return

	v()

	h('', 0, 'r')
		mr(sp())
		let profile_action = bare_menu_button(
			'profile_button', 'user-circle', '', profile_menu_items)
		if (profile_action == 'sign_out_button') {
			post('/logout.json', {},
				function(new_user) {
					user = new_user
					animate()
				},
				function(e) { alert(e) }
			)
		}
	end_h()

	ui.dock('app_dock', {tabs: []}, function(tab) {
		//
	})

	end_v()
}
