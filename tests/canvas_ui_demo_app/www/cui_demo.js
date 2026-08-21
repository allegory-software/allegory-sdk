
code = '<h1>Hello World!</h1>'

font_alias('heading', 'opensans')
icon_alias('user'       , 'ti', '\ueb4d')
icon_alias('user-circle', 'ti', '\uef68')
icon_alias('mail-fast'  , 'ti', '\uf069')
icon_alias('key'        , 'ti', '\ueac7')
icon_alias('plus'       , 'ti', '\ueb0b')
icon_alias('arrow-up'   , 'ti', '\uea25')
icon_alias('arrow-down' , 'ti', '\uea16')
icon_alias('close'      , 'ti', '\ueb55')

listen('ajax_error', function(...args) {
	_(...args)
	let [message, type, status] = args
	if (type == 'http' && status == 403) {
		user.signed_in = false
		animate()
	}
})

h1 = function(size) {
	scope()
	font('opensans')
	font_weight(300)
	font_size(2.5 * (size ?? 1))
}
end_h1 = function() {
	end_scope()
}

main = function() {

	if (!login_window())
		return

	v()

	h('', 0, 'r')
		mr(sp())
		let open = state('profile_button', 'open')
		let button_stack_i = stack()
			let toggle = bare_icon_button('profile_button', 'user-circle')
			if (toggle) {
				open = !open
				state('profile_button').open = open
			}
		end_stack()
		if (open) {
			mt(sp())
			popup('profile_popup', 'open', button_stack_i, 'b', '[', 200, 300, 'constrain change_side')
				bb_tooltip('bg1', 0, 'light', 0, sp())
				if (user.signed_in) {
					if (button('sign_out_button', 'Sign out'))
						post('/logout.json', {},
							function(new_user) {
								user = new_user
								state('profile_button').open = false
								animate()
							},
							function(e) { alert(e) }
						)
				}
			end_popup()
		}
	end_h()

	code_edit('code_edit1', {code: code})

	end_v()
}
