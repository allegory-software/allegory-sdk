/*

	User settings dropdown and sign-in dialog.
	Written by Cosmin Apreutesei. Public Domain.

DEFINES GLOBALS

	init_auth()
	sign_out()

USES CSS

	.x-auth-signed-in       mark elements that must be bound only when signed-in.
	.x-auth-signed-out      mark elements that must be bound only when signed-out.
*/

{

let settings_nav

let init_settings_nav = function() {

	init_settings_nav = noop

	let set = {}

	set.night_mode = function(v) {
		set_theme(v ? 'dark' : null)
	}

	let nav = bare_nav({
		id: config('app_name')+'_user_settings_nav',
		static_rowset: {
			fields: [
				{
					name: 'email',
					readonly: true,
					text: S('email_address', 'E-mail address'),
				},
				{
					name: 'night_mode', type: 'bool', default: false,
					text: S('night_mode', 'Night Mode'),
				},
			],
		},
		row_vals: [{
			night_mode: false,
			email: window.usr && usr.email,
		}],
		props: {row_vals: {slot: 'user'}},
		save_row_on: 'input',
	})
	document.head.add(nav)

	function set_all() {
		for (let field of nav.all_fields) {
			let set_val = set[field.name]
			if (set_val)
				set_val(nav.cell_val(nav.focused_row, field))
		}
	}

	nav.on('reset', set_all)

	nav.on('focused_row_cell_state_changed', function(row, field, changes) {
		if (changes.val) {
			let set_val = set[field.name]
			if (set_val)
				set_val(changes.val[0])
		}
	})

	nav.on('saved', function() {
		if (!window.xmodule)
			return
		xmodule.save()
	})

	set_all()
}

component('x-settings-button', function(e) {

	button.construct(e)

	e.bare = true
	e.text = ''
	e.icon = 'fa fa-user-circle'

	let tt
	e.on('activate', function() {
		if (tt && tt.target) {
			tt.close()
		} else {
			let settings_form = unsafe_html(render('user_settings_form'))
			tt = tooltip({
				classes: 'x-settings-tooltip',
				target: e, side: 'bottom', align: 'start',
				text: settings_form,
				close_button: true,
				autoclose: true,
			})
		}
	})

})

// sign-in form --------------------------------------------------------------

let sign_in_dialog = memoize(function() {

	let e = unsafe_html(render('sign_in_dialog', window.sign_in_options))

	e.lang_dropdown = e.$1('.sign-in-lang-dropdown')
	e.slides        = e.$1('.sign-in-slides')
	e.email_edit    = e.$1('.sign-in-email-edit')
	e.code_edit     = e.$1('.sign-in-code-edit')
	e.email_button  = e.$1('.sign-in-email-button')
	e.code_button   = e.$1('.sign-in-code-button')

	e.email_edit.field = {not_null: true}
	e.code_edit.field = {not_null: true}

	e.lang_dropdown.val = lang()

	e.lang_dropdown.on('state_changed', function(changes) {
		if (changes.input_val) {
			exec('/sign-in?lang='+changes.input_val[0], {refresh: true})
		}
	})

	e.email_edit.on('state_changed', function(changes) {
		if (changes.input_val)
			e.email_button.disabled = e.email_edit.invalid
	})

	e.email_button.action = function() {
		let d = sign_in_dialog()
		e.email_button.post(href('/sign-in-email.json'), {
			email: e.email_edit.input_val,
		}, function() {
			sign_in_code()
		}, function(err) {
			e.email_edit.errors = [{message: err, passed: false}]
			e.email_edit.focus()
		})
	}

	e.code_button.action = function() {
		let d = sign_in_dialog()
		call_login({
				type: 'code',
				code: e.code_edit.input_val,
			},
			e.code_button,
			function() {
				if (location.pathname.starts('/sign-in'))
					exec('/')
				else
					e.close()
			},
			function(err) {
				e.code_edit.errors = [{message: err, passed: false}]
				e.code_edit.focus()
			}
		)
	}

	return e
})

let sign_in_dialog_modal = function() {
	return sign_in_dialog().modal()
}

function sign_in() {
	let d = sign_in_dialog_modal()
	d.email_edit.val = null
	d.code_edit.val = null
	d.slides.slide(0)
}

let sign_in_code = function() {
	let d = sign_in_dialog_modal()
	d.code_edit.errors = null
	d.slides.slide(1)
}

flap.sign_in = function(on) {
	let d = sign_in_dialog()
	if (!on && d)
		d.close()
}

action.sign_in = function() {
	setflaps('sign_in')
	sign_in()
}

action.sign_in_code = function() {
	setflaps('sign_in')
	sign_in_code()
}

let signed_in = function(on, check_auto_sign_in) {
	setglobal('signed_in', on)
	setglobal('signed_out', !on)
	if (!on && check_auto_sign_in && config('auto_sign_in'))
		exec('/sign-in')
}

let call_login = function(upload, notify_widget, success, fail) {
	ajax({
		url: href('/login.json'),
		upload: upload || empty,
		notify: notify_widget,
		success: function(usr1) {

			pr('login', usr1.usr, usr1.email)
			setglobal('usr', usr1)

			if (window.xmodule)
				xmodule.set_layer(config('app_name'), 'user',
					config('app_name') + '-user-'+usr.usr)

			if (success)
				success()

			signed_in(usr && !usr.anonymous, true)

		},
		fail: function(err) {
			notify(err, 'error')
			if (fail) fail(err)
		},
	})
}

function init_auth() {
	signed_in(false, false)
	init_settings_nav()
	call_login()
}

function sign_out() {
	call_login({type: 'logout'})
}

on('auth_sign_in_button.init', function(e) {
	e.on('activate', function() { sign_in() })
})

on('auth_sign_out_button.init', function(e) {
	e.on('activate', function() { sign_out() })
})

}
