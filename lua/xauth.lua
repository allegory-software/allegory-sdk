--[==[

	webb | authentication rowsets
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

require'webb_auth'
require'xrowset_sql'

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
