--[==[

	webb | xapp authentication UI
	Written by Cosmin Apreutesei. Public Domain.

TEMPLATES

	usr_nav
	usr_form
	sign_in_dialog
	sign_in_email_html
	sign_in_email_text

ACTIONS

	x-auth.css
	sign_in_email.json
	sign_in_phone.json

CONFIG

	noreply_email         no-reply@HOST         sender of auth emails

]==]

require'webb_spa'
require'webb_auth'
require'xrowset_sql'

jsfile'x-auth.js'
cssfile'x-auth.css'

wwwfile['x-auth.css'] = [[

.breadcrumbs {
	margin: 1em 0;
}

.x-usr-button {

}

.x-usr-tooltip .x-tooltip-content {
	min-width: 300px;
	margin-top: 1em;
}

.x-usr-button > .x-button-icon {
	font-size: 1.2em;
}

.sign-in-slides {
	align-self: center;
	width: 300px;
	padding: 1em 2em;
}

.sign-in-slides .x-button {
	//margin: .25em 0;
}

#usr_form {
	grid-template-areas:
		"email"
		"name"
		"lang"
		"country"
		"theme"
		"auth_sign_out_button"
		"auth_sign_in_button"
}

#auth_sign_out_button,
#auth_sign_in_button {
	padding-top    : .5em;
	padding-bottom : .5em;
	margin-top     : .5em;
	margin-bottom  : .5em;
}

.sign-in-email-button,
.sign-in-code-button
{
	margin-top: .5em;
}

.sign-in-splash-img {
	background-image: url("https://source.unsplash.com/random/1920x1080?abstract");
	background-position: center;
}

]]

template.sign_in_dialog = function()
	return render_string([[
<x-dialog cancelable=false>
	<content>
		{{#logo}}
			<img class=sign-in-logo src="{{logo}}">
		{{/logo}}
		<x-slides class=sign-in-slides>

			<x-form>
				<div class=x-dialog-heading><t s=heading_sign_in>
					Sign-in
				</t></div>
				<p small><t s=sign_in_greet>
					The security of your account is important to us.
					That is why instead of having you set up a hard-to-remember password,
					we will send you a one-time activation code every time
					you need to sign in.
				</t></p>
				{{#multilang}}
				<x-list-dropdown
					class=sign-in-lang-dropdown
					val_col=lang
					display_col=name
					rowset_name=pick_lang
				></x-list-dropdown>
				{{/multilang}}
				<x-textedit
					class=sign-in-email-edit
					field_type=email
					label:s:textedit_label_sign_in_email="E-mail address" focusfirst
				></x-textedit>
				<x-button primary
					class=sign-in-email-button
					text:s:button_text_sign_in_email="E-mail me a sign-in code"
				></x-button>
			</x-form>

			<x-form>
				<div class=x-dialog-heading><t s=heading_sign_in_enter_code>
					Enter code
				</t></div>
				<p small><t s=sign_in_email_sent>
					An e-mail was sent to you with a 6-digit sign-in code.
					Enter the code in the box below to sign-in.
					<br>
					If you haven't received an email even after
					a few minutes, please <a href="/sign-in">try again</a>.
				</t></p>
				<x-textedit
					class=sign-in-code-edit
					field_type=sign_in_code
					label:s:textedit_label_sign_in_code="6-digit sign-in code"
					focusfirst></x-textedit>
				<x-button primary
					class=sign-in-code-button
					text:s:button_text_sign_in="Sign-in"
				></x-button>
			</x-form>

		</x-slides>
	</content>
</x-dialog>
]], {multilang = multilang(), logo = config'sign_in_logo'})
end

template.sign_in_email_text = [[

Your sign-in code:

{{code}}

]]

template.sign_in_email_html = [[

<p>Your sign-in code:</p>

<h1>{{code}}</h1>

]]

action['sign_in_email.json'] = function()
	local params = post()
	local noreply = config'noreply_email' or email'no-reply'
	local email = allow(json_str_arg(params.email),
		S('email_required', 'Email address required'))
	local code = allow(gen_auth_code('email', email))
	local subj = S('sign_in_email_subject', 'Your sign-in code')
	local text = render('sign_in_email_text', {code = code, host = host()})
	local html = render('sign_in_email_html', {code = code, host = host()})
	sendmail{from = noreply, to = email, subject = subj, text = text, html = html}
	return {ok = true}
end

action['sign_in_phone.json'] = function()
	local phone = allow(json_str_arg(params.phone),
		S('phone_required', 'Phone number required'))
	local code = allow(gen_auth_code('phone', phone))
	local msg = S('sign_in_sms_message',
		'Your sign-in code for {1} is: {0}', code, host())
	sendsms(phone, msg)
	return {ok = true}
end

rowset.users = sql_rowset{
	allow = 'admin',
	select = [[
		select
			tenant      ,
			usr         ,
			active      ,
			emailvalid  ,
			email       ,
			title       ,
			name        ,
			phonevalid  ,
			phone       ,
			sex         ,
			birthday    ,
			newsletter  ,
			roles       ,
			note        ,
			clientip    ,
			atime       ,
			ctime       ,
			mtime
		from
			usr
	]],
	cols = [[
		tenant usr email title name roles active birthday newsletter atime ctime mtime
	]],
	field_attrs = {
		tenant   = {
			default = function() return tenant() end,
			readonly = function() return not usr'roles'.dev end,
		},
		note     = {hidden = true  },
		clientip = {hidden = true  },
		name     = {not_null = true},
		email    = {not_null = true},
		roles    = {type = 'tags'},
	},
	where_all = 'anonymous = 0 and tenant = $tenant()',
	pk = 'usr',
	order_by = 'tenant, active desc, ctime desc',
	insert_row = function(self, row)
		row.usr = usr_create(row)
		self:rowset_changed'usr'
	end,
	update_row = function(self, row)
		row.usr = row['usr:old']
		usr_update(row)
		self:rowset_changed'usr'
	end,
	delete_row = function(self, row)
		usr_delete(row['usr:old'])
		self:rowset_changed'usr'
	end,
}

rowset.impersonate_users = sql_rowset{
	allow = function() return realusr'roles'.dev end,
	select = [[
		select
			tenant,
			usr,
			email
		from usr
	]],
	where_all = 'anonymous = 0 and usr <> $realusr()',
	order_by = 'tenant, usr',
	pk = 'usr',
}

rowset.tenants = sql_rowset{
	allow = 'dev',
	select = [[
		select
			tenant,
			active,
			name,
			ctime
		from tenant
	]],
	pk = 'tenant',
	rw_cols = 'active name',
	order_by = 'tenant',
	insert_row = function(self, row)
		self:insert_into('tenant', row, 'active name')
	end,
	update_row = function(self, row)
		self:update_into('tenant', row, 'active name')
	end,
	delete_row = function(self, row)
		self:delete_from('tenant', row)
	end
}

rowset.usr = sql_rowset{
	allow = function()
		return login(post())
	end,
	select = [[
		select
			tenant      ,
			usr         ,
			0 as realusr,
			anonymous   ,
			emailvalid  ,
			email       ,
			title       ,
			name        ,
			phonevalid  ,
			phone       ,
			sex         ,
			birthday    ,
			newsletter  ,
			roles       ,
			'' as realusr_roles,
			#if multilang()
			lang        ,
			country     ,
			#endif
			theme       ,
			atime       ,
			ctime       ,
			mtime
		from
			usr
	]],
	where_all = 'usr = $usr()',
	pk = 'usr',
	field_attrs = {
		realusr = {compute = function() return realusr() end},
		realusr_roles = {compute = function() return cat(index(realusr'roles'), ' ') end},
		theme = {
			type = 'enum',
			enum_values = {'dark', 'default'},
			enum_texts = {
				dark = S('theme_dark', 'Dark'),
				default = S('theme_default', 'Default'),
			},
		},
		lang = {
			lookup_rowset_name = 'pick_lang',
		},
	},
	rw_cols = 'tenant name theme lang country',
	update_row = function(self, row)
		local is_dev = usr'roles'.dev --only devs can change their tenant
		self:update_into('usr', row, 'name theme lang country '..(is_dev and 'tenant' or ''))
		clear_userinfo_cache(row['usr:old'])
	end,
}
