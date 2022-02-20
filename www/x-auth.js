/*

	User settings dropdown and sign-in dialog.
	Written by Cosmin Apreutesei. Public Domain.

GLOBALS

	init_auth()
	sign_out()

ACTIONS

	sign-in
	sign-in-code

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
		save_row_on: 'input',
	})

	nav.on('reset', function() {

		let usr = this.row_state_map(this.rows[0], 'val')
		pr('login', usr.usr, usr.email)
		setglobal('usr', usr)

		if (window.xmodule)
			xmodule.set_layer(config('app_name'), 'user',
				config('app_name') + '-user-'+usr.usr)

		signed_in(usr && !usr.anonymous, true)

		for (let field of nav.all_fields)
			set_val(field.name, nav.cell_val(nav.rows[0], field))
	})

	nav.on('load_fail', function(err, type, status) {
		if (type == 'http' && status == 403) { // forbidden
			signed_in(false, true)
			return false // prevent notify toaster.
		}
	})

	nav.on('cell_state_changed', function(row, field, changes, ev) {
		if (changes.val)
			set_val(field.name, changes.val[0], ev)
	})

	head.add(nav)
}

let login = function(upload, notify, success, fail) {
	usr_nav.reload({
		upload: upload,
		notify: notify,
		success: success,
		fail: fail,
	})
}

let signed_in = function(signed_in, check_auto_sign_in) {
	setglobal('signed_in', signed_in)
	setglobal('signed_out', !signed_in)
	if (!signed_in && check_auto_sign_in && config('auto_sign_in'))
		exec('/sign-in')
}

function init_auth() {
	signed_in(false, false)
	init_usr_nav()
}

function sign_out() {
	login({type: 'logout'})
}

component('x-usr-button', function(e) {

	button.construct(e)

	e.bare = true
	e.text = ''
	e.icon = 'fa fa-user-circle'

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
			exec('/sign-in', {lang: changes.input_val[0], refresh: true})
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
		login({
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

on('auth_sign_in_button.init', function(e) {
	e.on('activate', function() { sign_in() })
})

on('auth_sign_out_button.init', function(e) {
	e.on('activate', function() { sign_out() })
})

}
