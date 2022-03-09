/*

	User settings dropdown and sign-in dialog.
	Written by Cosmin Apreutesei. Public Domain.

GLOBALS

	init_auth()
	sign_in()
	sign_out()

*/

{

let init_usr_nav = function() {

	let set = {}

	set.theme = set_theme

	set.lang = function(v, ev) {
		if (ev && ev.input)
			location.reload()
	}

	function set_val(k, v, ev) {
		if (set[k])
			set[k](v, ev)
	}

	let nav = bare_nav({
		id: 'usr_nav',
		rowset_name: 'usr',
		save_on_input: true,
	})

	nav.on('reset', function(event) {

		if (event == 'logout') {
			// logout has created an anonymous user + session for us.
			// refresh the page to wipe out any sensitive information in it.
			location.reload()
			return
		}

		if (event == 'login') {
			// reload in order to reset lang & country from user settings.
			location.reload()
			return
		}

		// first-time load by init_auth(): init the app with the signed-in user.
		// the user can be anonymous or not, we're doing the same thing.

		let usr = this.row_state_map(this.rows[0], 'val')

		pr('login', usr.usr, usr.email || '(no email)',
			usr.roles ? usr.roles.names().join(',') : '(no roles)')
		setglobal('usr', usr)

		if (window.xmodule)
			xmodule.set_layer(config('app_name'), 'user',
				config('app_name') + '-user-'+usr.usr)

		set_signed_in(!usr.anonymous)

		for (let field of nav.all_fields)
			set_val(field.name, nav.cell_val(nav.rows[0], field))
	})

	nav.on('load_fail', function(err, type, status, satus_message, body, req) {

		let event = req.event
		let forbidden = type == 'http' && status == 403

		if (event == 'logout') {
			if (forbidden) {
				// normal logout without the server creating an anonymous user.
				// refresh the page to wipe out any sensitive information in it.
				location.reload()
				return false // prevent showing the error via notify().
			} else {
				// other error. the error is shown and the logout button is
				// re-enabled to let the user retry.
				return
			}
		}

		if (event == 'login') {
			// login error (forbidden or not). the error is shown and the login
			// button is re-enabled to let the user retry.
			return
		}

		if (forbidden) {
			// first-time load by init_auth(): session login failed: sign-in.
			sign_in()
			return false // prevent showing the error via notify().
		}

		// other type of error: let the error be notified, don't take any action.
		// if this happens on app load, you get a blank screen.

		// TODO: x-if an oops page with a reload button.

	})

	nav.on('cell_state_changed', function(row, field, changes, ev) {
		if (changes.val)
			set_val(field.name, changes.val[0], ev)
	})

	head.add(nav)
}

let set_signed_in = function(signed_in) {
	setglobal('signed_in', signed_in)
	setglobal('signed_out', !signed_in)
}

function init_auth() {
	set_signed_in(false)
	init_usr_nav()
}

function sign_out(opt) {
	usr_nav.reload(assign_opt({
		upload: {type: 'logout'},
		event: 'logout',
	}, opt))
}

component('x-usr-button', function(e) {

	button.construct(e)

	e.bare = true
	e.text = ''
	e.icon = 'fa fa-user-circle'
	e.tabindex = -1

	let tt
	e.on('activate', function() {
		if (tt && tt.target) {
			tt.close()
		} else {
			let usr_form = unsafe_html(render('usr_form'))
			tt = tooltip({
				classes: 'x-usr-tooltip',
				target: e, side: 'bottom', align: 'start',
				text: usr_form,
				close_button: true,
				autoclose: true,
			})
			tt.focus_first()
		}
	})

})

on('auth_sign_in_button.init', function(e) {
	e.on('activate', function() { sign_in() })
})

on('auth_sign_out_button.init', function(e) {
	e.on('activate', function() { sign_out({notify: e}) })
})

// sign-in form --------------------------------------------------------------

let sign_in_dialog = memoize(function() {

	let e = unsafe_html(render('sign_in_dialog'))

	e.lang_dropdown = e.$1('.sign-in-lang-dropdown')
	e.slides        = e.$1('.sign-in-slides')
	e.email_edit    = e.$1('.sign-in-email-edit')
	e.code_edit     = e.$1('.sign-in-code-edit')
	e.email_button  = e.$1('.sign-in-email-button')
	e.code_button   = e.$1('.sign-in-code-button')

	e.email_edit.field = {not_null: true}
	e.code_edit.field = {not_null: true}

	if (e.lang_dropdown) {
		e.lang_dropdown.val = lang()
		e.lang_dropdown.on('state_changed', function(changes) {
			if (changes.input_val) {
				exec('/sign-in', {lang: changes.input_val[0], refresh: true})
			}
		})
	}

	e.email_edit.on('state_changed', function(changes) {
		if (changes.input_val)
			e.email_button.disabled = e.email_edit.invalid
	})

	e.email_button.action = function() {
		let d = sign_in_dialog()
		e.email_button.post(href('/sign-in-email.json'), {
			email: e.email_edit.input_val,
		}, function() {
			d.code_edit.errors = null
			d.slides.slide(1)
		}, function(err) {
			e.email_edit.errors = [{message: err, passed: false}]
			e.email_edit.focus()
		})
	}

	e.code_button.action = function() {
		let d = sign_in_dialog()
		usr_nav.reload({
			upload: {
				type: 'code',
				code: e.code_edit.input_val,
			},
			notify: e.code_button,
			event: 'login',
			fail: function(err) {
				e.code_edit.errors = [{message: err, passed: false}]
				e.code_edit.focus()
			},
		})
	}

	return e
})

function sign_in() {
	let d = sign_in_dialog()
	d.email_edit.val = null
	d.code_edit.val = null
	d.slides.slide(0)
	d.modal()
}

}
