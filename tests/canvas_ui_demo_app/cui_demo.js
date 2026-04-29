
load_font('mono', 'fonts/jetbrains-mono-nl-regular.woff2')
load_font('inter', 'fonts/inter-roman.var.woff2')
load_font('opensans', 'fonts/opensans.var.woff2')
load_font('las', 'icons/la-solid-900.woff2') //, {sizeAdjust: '120%'})
load_font('fas', 'icons/fa-solid-900.woff2') //, {sizeAdjust: '200%'})

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
	allert(e.message)
}

dropdown_tooltip = function(id, items, fr, max_min_w, min_w, min_h) {

	keepalive(id)
	focusable(id)
	let open = state(id, 'open')
	let foc_i = open ? state(id+'.list', 'focused_item_i') : null
	let sel_i = foc_i ?? state(id, 'i') ?? 0
	sel_i = valid_list_index(sel_i, items)
	state(id).set('i', sel_i)

	let click = hit(id) && click
	let picked = state(id+'.list', 'item_picked')
	let toggle = click
		|| (focused(id) && keydown('enter'))
		|| picked

	if (toggle) {
		open = !open
	} else if (open && click && !hit(id) && !picked && !captured(id+'.list')) {
		open = false
	}

	state(id).set('open', open)

	if (click)
		if (open)
			focus(id+'.list')
		else
			focus(id)

	if (!open && focused(id)) {
		let d = key('arrowup') && -1 || key('arrowdown') && 1 || 0
		if (d) {
			sel_i = valid_list_index(sel_i + d, items)
			state(id).set('i', sel_i)
			state(id+'.list').set('focused_item_i', sel_i)
		}
	}

	let s = sel_i != null ? items[sel_i] : ''

	stack('', fr, 's', 's', min_w ?? em(12), min_h)

		// placeholder to align popup to it.
		m(1)
		p(sp())
		text('', '', 0, 'l', 'c')

		if (open)
			popup(id+'.popup', 'open', null, 'il', 's', 0, 0, 'constrain change_side')

			if (open)
				shadow('picker')

			bb('input', null, 1, 'intense', focused(id) || focused(id+'.list') ? 'hover' : null)

			m(1)
			v()

				stack(id)
					p(sp())
					h(0, sp())
						text('', s, 1, 'l', 'c', max_min_w ?? em(8))
						stack('', 0)
							polyline('', '0 4  7 11  14 4', false, null, null, 'label')
						end_stack()
					end_h()
				end_stack()

				if (open) {
					stack()
						state_init(id+'.list', 'focused_item_i', sel_i)
						list(id+'.list', items, 0, 's', 's', 'l', 'c', 0, max_min_w)
					end_stack()
				}

			end_v()

		if (open)
			end_popup()

	end_stack()
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
				state('profile_button').set('open', open)
			}
		end_stack()
		if (open) {
			mt(sp())
			popup('profile_popup', 'open', button_stack_i, 'b', '[', 200, 300, 'constrain change_side')
				bb_tooltip('bg1', 0, 'light', 0, sp())
				if (user.anonymous) {

				} else {
					if (button('sign_out_button', 'Sign out')) {

					}
				}
			end_popup()
		}
	end_h()

	if (user.anonymous) {
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
