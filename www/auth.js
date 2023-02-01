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

	set.tenant = function(v, ev) {
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

	nav.on('reset', function usr_nav_reset(event) {

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
			usr.roles ? (usr.roles || '').words().join(',') : '(no roles)')
		setglobal('usr', usr)

		if (window.xmodule)
			xmodule.set_layer(config('app_name'), 'user',
				config('app_name') + '-user-'+usr.usr)

		set_signed_in()

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

		// TODO: if an oops page with a reload button.

	})

	nav.on('cell_state_changed', function(row, field, changes, ev) {
		if (changes.val)
			set_val(field.name, changes.val[0], ev)
	})

	head.add(nav)
}

let set_signed_in = function set_signed_in() {
	let usr = window.usr
	let signed_out = usr === null
	let signed_in = usr && usr.anonymous == false || false
	let    roles = (usr && usr.roles || '').words().tokeys()
	let ru_roles = (usr && usr.realusr_roles || '').words().tokeys()
	setglobal('signed_in'              , signed_in, false)
	setglobal('signed_out'             , signed_out, false)
	setglobal('signed_in_dev'          , !!roles.dev, false)
	setglobal('signed_in_admin'        , !!roles.admin, false)
	setglobal('signed_in_realusr_dev'  , !!ru_roles.dev, false)
	setglobal('signed_in_realusr_admin', !!ru_roles.admin, false)
	setglobal('signed_in_anonymous'    , !!(usr && usr.anonymous), false)
}

function init_auth() {
	set_signed_in()
	init_usr_nav()
}

function sign_out(opt) {
	usr_nav.reload(assign_opt({
		upload: {type: 'logout'},
		event: 'logout',
	}, opt))
}

widget('usr-button', function(e) {

	button.construct(e)

	e.bare = true
	e.text = ''
	e.icon = 'fa fa-user-circle'
	e.focusable = false

	let tt
	e.on('click', function() {
		if (tt && tt.target) {
			tt.close()
		} else {
			let usr_form = unsafe_html(render('usr_form', {
				multilang: config('multilang', true),
			}))
			tt = tooltip({
				classes: 'usr-tooltip',
				target: e, side: 'bottom', align: 'start',
				text: usr_form,
				close_button: true,
				autoclose: true,
			})
			tt.focus_first()
		}
	})

	function signed_in_changed(signed_in) {
		// e.text = signed_in ? S('account', 'Account') : S('sign_in', 'Sign in')
	}

	e.on_bind(function(on) {
		window.on('signed_in_changed', signed_in_changed, on)
	})

})

on('auth_sign_in_button.init', function(e) {
	e.on('click', function() { sign_in() })
})

on('auth_sign_out_button.init', function(e) {
	e.on('click', function() { sign_out({notify: e}) })
})

on('usr_usr_dropdown.init', function(e) {
	e.val = id_arg(current_url.args.usr)
	e.on('state_changed', function(changes, ev) {
		if (changes.input_val) {
			let url = assign(obj(), current_url)
			url.args.usr = changes.input_val[0]
			exec(url_format(url), {refresh: true})
		}
	})
})

widget('usr-lang-dropdown', function(e) {

	lookup_dropdown.construct(e)

})

// sign-in form --------------------------------------------------------------

let dialog = memoize(function() {

	let e = unsafe_html(render('sign_in_dialog', {
		multilang: config('multilang', true),
	}))

	e.slides = e.$1('.sign-in-slides')

	let p1 = e.slides.items[0]
	e.lang_dropdown = p1.$1('.sign-in-lang-dropdown')
	e.email_edit    = p1.$1('.sign-in-email-edit')
	e.email_button  = p1.$1('.sign-in-email-button')

	let p2 = e.slides.items[1]
	e.code_edit     = p2.$1('.sign-in-code-edit')
	e.code_button   = p2.$1('.sign-in-code-button')

	// e.lang_dropdown.reset_val(lang())
	e.lang_dropdown.on('val_picked', function() {
		exec('/sign-in', {lang: this.input_val, refresh: true})
	})

	e.on_update(function(opt) {
		// adding this dynamically to prevent loading the background needlessly.
		e.dialog.class('sign-in-splash-img', !window.signed_in && !window.signed_in_anonymous)
	})

	return e
})

/*
on('sign_in_slides.bind', function(e) {

// e.email_edit.field = {not_null: true}
// e.code_edit.field = {not_null: true}

e.email_edit.on('state_changed', function(changes) {
	if (changes.input_val)
		e.email_button.disabled = e.email_edit.invalid
})

e.email_button.action = function() {
	let d = dialog()
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
	let d = dialog()
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
*/

function sign_in() {
	let d = dialog()
	d.email_edit.val = null
	d.code_edit.val = null
	d.slides.slide(0)
	d.modal()
	return d
}

widget('sign-in-dialog', function(e) {

	e.style.display = 'contents'

	e.on_bind(function(on) {
		if (on)
			sign_in()
		else
			dialog().close()
	})

})

}
