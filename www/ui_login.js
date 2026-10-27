//sign-in window -> signed_in. call before opening any container.
//scrim emitted before the window: layers draw forward, hit-test in reverse.

ui.login_window = function() {

	let s = ui.state('login')
	if (!s.free) {
		s.request = null // session, code, sign-in or sign-out request or null
		s.load_error = null // session request error text or null
		ui.on_free('login', function(s) {
			if (s.request) s.request.abort()
		})
	}
	s.email ??= null // submitted email or null before requesting a code
	s.email_text ??= null // typed email text or null
	s.code ??= null // typed sign-in code or null

	//page rendered without a user: ask the server for the session.
	if (!window.user && !s.request && !s.load_error)
		s.request = glue.get('/user.json', function(current_user) {
			s.request = null
			user = current_user
			ui.saved_state = glue.json_arg(current_user.ui_state)
			ui.animate()
		}, function(error, type) {
			if (type == 'abort') return
			s.request = null
			s.load_error = error
			ui.animate()
		}, {silent: true})

	if (window.user && user.signed_in)
		return true

	ui.popup('login_window', 'modal', 'screen', 'ic', 'c')
		//ui.bg_dots('login_dots', 0.1)
		ui.shadow('modal')
		ui.bb('bg0', null, 1, 'light')
		ui.mb(ui.em(2))
		ui.p(ui.em(2))
		ui.focus_group(true, null, 'login')
		ui.min_w(300)
		ui.v(1, 0, 'c', 'c')

			ui.font_size(4)
			ui.color('label')
			ui.icon('', 'user', 0, 'c', 't')

			ui.m(ui.sp8())
			ui.font('heading')
			ui.font_size(2.5)
			ui.text('', 'Sign In', 1, 'c', 't')

			if (!window.user) {

				ui.text('', s.load_error || 'Loading session...', 0, 'c', 't')

			} else if (!s.email) {

				ui.pb(ui.sp())
				ui.text('', 'Email', 0, '[', 't')
				s.email_text = ui.input('login_email', s.email_text, null, 1)
				ui.color('label')
				ui.pt(ui.sp())
				ui.pb(ui.sp2())
				ui.text_wrapped('login_hint',
					"Same for new and returning users: we'll find your "+
					"account or create one.", 0, '[', 't', 1/0)
				ui.mt(ui.sp2())
				ui.default_button('login_send_button')
				if (ui.primary_button('login_send_button', 'mail-fast',
					'Continue', 1, 's') && !s.request)
					s.request = glue.post('/gen_auth_code.json',
						{email: s.email_text},
						function(t) {
							s.request = null
							s.email = t.email
							s.code = null
							if (t.code) console.log('Sign-in code:', t.code)
							ui.focus('login_code')
							ui.animate()
						},
						function(e, type) {
							if (type == 'abort') return
							s.request = null
							alert(e)
						}
					)

			} else {

				ui.pb(ui.sp())
				ui.text('', 'Enter the 6-digit code', 0, '[', 't')
				s.code = ui.input('login_code', s.code, null, 0)
				ui.mt(ui.sp2())
				ui.default_button('login_signin_button')
				if (ui.primary_button('login_signin_button', 'key',
					'Sign in', 1, 's') && !s.request)
					s.request = glue.post('/login.json',
						{email: s.email, code: s.code},
						function(new_user) {
							s.request = null
							user = new_user
							ui.saved_state = glue.json_arg(new_user.ui_state)
							s.email = null
							ui.animate()
						},
						function(e, type) {
							if (type == 'abort') return
							s.request = null
							alert(e)
						}
					)

			}

		ui.end_v()
		ui.end_focus_group()
	ui.end_popup()

	ui.focus_first('login')

	return false
}

//sign out. login_window() shows the window again after the reply.
ui.logout = function() {
	let s = ui.state('login')
	if (s.request) return
	s.request = glue.post('/logout.json', null, function(current_user) {
		s.request = null
		user = current_user
		ui.animate()
	}, function(e, type) {
		if (type == 'abort') return
		s.request = null
		alert(e)
	})
}
