(function() {

const {
	get, post, json_arg,
} = glue

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

	// page rendered without a user: ask the server for the session.
	if (!window.user && !s.request && !s.load_error)
		s.request = get('/user.json', function(current_user) {
			s.request = null
			ui.switch_user(current_user)
		}, function(error, type) {
			if (type == 'abort') return
			s.request = null
			s.load_error = error
			ui.animate()
		}, {silent: true})

	let has_inputs = !!window.user && !user.signed_in
	if (has_inputs && !s.has_inputs)
		ui.focus_first('login')
	s.has_inputs = has_inputs

	if (window.user && user.signed_in)
		return true

	ui.popup('login_window', 'modal', 'screen', 'ic', 'c')
		//ui.bg_dots('login_dots', 0.1)
		ui.shadow('modal')
		ui.bb('bg0', null, 1, 'light')
		ui.mb(ui.em(2))
		ui.pv(ui.em(3))
		ui.pt(ui.em(3.5))
		ui.ph(ui.em(2.5))
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
				s.email_text = ui.input('login_email', s.email_text)
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
					s.request = post('/gen_auth_code.json',
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
					s.request = post('/login.json',
						{email: s.email, code: s.code},
						function(new_user) {
							s.request = null
							s.email = null
							ui.switch_user(new_user)
						},
						function(e, type) {
							if (type == 'abort') return
							s.request = null
							alert(e)
						}
					)

			}

			if (window.user?.impersonating) {
				ui.mt(ui.sp2())
				if (ui.button('login_unimpersonate_button', 'user-x',
					'Stop impersonating', 1, 's'))
					ui.unimpersonate()
			}

		ui.end_v()
		ui.end_focus_group()
	ui.end_popup()

	return false
}

ui.switch_user = function(new_user) {
	user = new_user
	ui.load_saved_state(json_arg(new_user.ui_state))
	ui.free_all_state()
	ui.animate()
}

function post_user(url, data) {
	let s = ui.state('login')
	if (s.request) return
	s.request = post(url, data, function(new_user) {
		s.request = null
		ui.switch_user(new_user)
	}, function(e, type) {
		if (type == 'abort') return
		s.request = null
		alert(e)
	})
}

ui.unimpersonate = function() { post_user('/unimpersonate.json') }

ui.logout = function() { post_user('/logout.json') }

ui.impersonate_modal = function(rowset_name) {
	let grid_id = 'impersonate_grid'
	let uid, ok, cancel
	if (ui.modal('impersonate_modal', 'Impersonate')) {
		ui.m(ui.sp2())
		ui.min_wh(ui.em(32), ui.em(20))
		ui.v(1, ui.sp2(), 's', 's')
			ui.grid(grid_id, {rowset_name: rowset_name, cols: 'name email'})
			uid = ui.state_of(grid_id, 'nav')?.focused_row_cell_val('user')
			ui.h(0, ui.sp(), 's')
				ui.box(1)
				ui.default_button('impersonate_ok')
				ok = ui.primary_button('impersonate_ok', 'user-share',
					'Impersonate', 0, 'l', 'c', uid == null)
				cancel = ui.button('impersonate_cancel', 'x', 'Cancel')
			ui.end_h()
		ui.end_v()
		ui.end_modal()
	}
	if (ok) {
		post_user('/impersonate.json', {uid: uid})
	} else if (cancel) {
		ui.set_modal_open('impersonate_modal', false, true)
	}
}

}())
