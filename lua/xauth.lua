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

template.usr_form = function()
	return render_string([[
<x-if global=signed_in>
	<x-form id=usr_form nav_id=usr_nav>
		<x-input col=email ></x-input>
		<x-input col=name  ></x-input>
		{{#multilang}}
		<x-lookup-dropdown col=lang     ></x-lookup-dropdown>
		<x-lookup-dropdown col=country  ></x-lookup-dropdown>
		{{/multilang}}
		<x-enum-dropdown col=theme></x-enum-dropdown>
		<x-if global=signed_in_dev>
			<x-lookup-dropdown col=tenant></x-lookup-dropdown>
		</x-if>
		<x-button id=auth_sign_out_button bare icon="fa fa-sign-out-alt">
			<t s=log_out>Log out</t>
		</x-button>
</x-if>
<x-if global=signed_out>
	<x-form id=usr_form nav_id=usr_nav>
	<x-button id=auth_sign_in_button><t s=sign_in>Sign-In</t></x-button>
</x-if>
]], {multilang = multilang()})
end

template.sign_in_dialog = function()
	return render_string([[
<x-dialog cancelable=false>
	<content>
		{{#logo}}
			<img class=sign-in-logo src="{{logo}}">
		{{/logo}}
		<x-slides class=sign-in-slides>

			<x-form>
				<div class=x-dialog-heading>
					Sign-in
				</div>
				<p small s=sign_in_greet><t s=sign_in_greet>
					The security of your account is important to us.
					That is why instead of having you set up a hard-to-remember password,
					we will send you a one-time activation code every time
					you need to sign in.
				</t></p>
				{{#multilang}}
				<x-list-dropdown class=sign-in-lang-dropdown label=Language val_col=lang display_col=name rowset_name=pick_lang></x-list-dropdown>
				{{/multilang}}
				<x-textedit class=sign-in-email-edit field_type=email label="Email address" focusfirst></x-textedit>
				<x-button primary class=sign-in-email-button>E-mail me a sign-in code</x-button>
			</x-form>

			<x-form>
				<div class=x-dialog-heading>
					Enter code
				</div>
				<p small><t label=sign_in_email_sent>
					An e-mail was sent to you with a 6-digit sign-in code.
					Enter the code below to sign-in.
					<br>
					If you haven't received an email even after
					a few minutes, please <a href="/sign-in">try again</a>.
				</t></p>
				<x-textedit class=sign-in-code-edit field_type=sign_in_code label="6-digit sign-in code" focusfirst></x-textedit>
				<x-button primary class=sign-in-code-button>Sign-in</x-button>
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
	try_sendmail{from = noreply, to = email, subject = subj, text = text, html = html}
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
	where_all = 'anonymous = 0',
	pk = 'usr',
	order_by = 'tenant, active desc, ctime desc',
	insert_row = function(self, row)
		row.tenant = row.tenant or tenant()
		allow(usr'roles'.dev or row.tenant == tenant(),
			'only devs can create users of other tenants')
		row.usr = create_or_update_user(row)
	end,
	update_row = function(self, row)
		row.usr = row['usr:old']
		allow(usr'roles'.dev or row.tenant == tenant(),
			'only devs can move users to other tenants')
		create_or_update_user(row)
	end,
	delete_row = function(self, row)
		allow(usr'roles'.dev or row.tenant == tenant(),
			'only devs can remove users of other tenants')
		self:delete_from('usr', row)
		clear_userinfo_cache(row['usr:old'])
	end,
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
	field_attrs = {
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
	where_all = 'usr = $usr()',
	pk = 'usr',
	rw_cols = 'tenant name theme lang country',
	update_row = function(self, row)
		local is_dev = usr'roles'.dev --only devs can change their tenant
		self:update_into('usr', row, 'name theme lang country '..(is_dev and 'tenant' or ''))
		clear_userinfo_cache(row['usr:old'])
	end,
}
