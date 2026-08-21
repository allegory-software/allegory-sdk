
code = '<h1>Hello World!</h1>'

function login() {

}

listen('ajax_error', function(...args) {
	_(...args)
	login()
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

auth_code_email = null
function gen_auth_code_ok(t) {
	_(t.email)
	_(t.code)
	auth_code_email = t.email
	animate()
}

function gen_auth_code_error(e) {
	alert(e)
}

function login_ok(new_user) {
	user = new_user
	auth_code_email = null
}

function login_error(e) {
	alert(e.message)
}

main = function() {

	v()

	h('', 0, 'r')
		mr(sp())
		let open = state('profile_button', 'open')
		let button_stack_i = stack()
			let toggle = bare_icon_button('profile_button', 'fas', '\uf504')
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
					if (button('sign_out_button', 'Sign out')) {

					}
				}
			end_popup()
		}
	end_h()

	if (!user.signed_in) {
		popup('login_window', 'window', 'screen',
			'ic', 'c', 400, 500, 'constrain'
		)
			bb('bg1', null, 1, 'light')
			p(em(3))
			v()
				h1(); text('', 'Sign in', 1, 'c', 't'); end_h1()
				if (!auth_code_email) {
					pb(sp())
					text('', 'Email', 0, '[', 't')
					let email = input('email_input', 'test@test.com', 0)
					// h1(0.5)
						if (button('sign_in_button', 'Send authentication code', 1, 'c'))
							post('/gen_auth_code.json', {email: email},
								gen_auth_code_ok,
								gen_auth_code_error
							)
					// end_h1()
				} else {
					pb(sp())
					text('', 'Enter the 6-digit code', 0, '[', 't')
					let code = input('code_input', '', 0)
					p(sp())
					// h1(0.5)
						if (button('sign_in_button', 'Sign in', 1, 'c'))
							post('/login.json',
								{email: auth_code_email, code: code},
								login_ok, login_error
							)
					// end_h1()
				}
			end_v()
		end_popup()
	}

	code_edit('code_edit1', {code: code})

	end_v()
}
