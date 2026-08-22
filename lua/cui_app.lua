--[==[

	Canvas-UI-based Application Server.
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	webb_app, canvas-ui

USAGE

	require'cui_app'(...)
	....
	return exit(app:run())

API

	fontfile(name, path, [desc])  preload a font and load it in the page
	user_json() -> {signed_in=, anonymous=, email=, phone=}

ACTIONS

	gen_auth_code.json
	login.json
	logout.json

UI API

	ui.login_window() -> signed_in

USES

	app.main_file                 js file to run in the page

CONFIG

	favicon_href

]==]

local webb_app = require'webb_app'

local fontfiles = {}
function fontfile(name, path, desc)
	add(fontfiles, {name, path, desc})
end

--sign-in window -> signed_in. call before opening any container.
--scrim emitted before the window: layers draw forward, hit-test in reverse.
local login_js = [[
ui.login_window = function() {

	if (user.signed_in)
		return true

	let s = ui.state('login')

	ui.popup('login_window', 'window', 'screen', 'ic', '[]')
		//ui.bg_dots('login_dots', 0.1)
		ui.bb('bg0', null, 1, 'light')
		ui.mb(ui.em(6))
		ui.focus_group(true, null, 'login')
		ui.v(1, 0, 'c', 'c', 300)

			ui.scope()
				ui.font_size(4)
				ui.color('label')
				ui.icon('user', 0, 'c', 't')
			ui.end_scope()

			ui.scope()
				ui.m(ui.sp8())
				ui.font('heading')
				ui.font_size(2.5)
				ui.text('', 'Sign In', 1, 'c', 't')
			ui.end_scope()

			if (!s.email) {

				ui.pb(ui.sp())
				ui.text('', 'Email', 0, '[', 't')
				let email = ui.input('login_email', '', 0)
				ui.scope()
					ui.color('label')
					ui.pt(ui.sp())
					ui.pb(ui.sp2())
					ui.text_wrapped('login_hint',
						"Same for new and returning users: we'll find your "+
						"account or create one.", 0, '[', 't', 1/0)
				ui.end_scope()
				ui.mt(ui.sp2())
				ui.default_button('login_send_button')
				if (ui.primary_icon_button('login_send_button', 'mail-fast',
					'Continue', 1, 's'))
					post('/gen_auth_code.json', {email: email},
						function(t) {
							ui.state('login').email = t.email
							ui.focus('login_code')
							ui.animate()
						},
						function(e) { alert(e) }
					)

			} else {

				ui.pb(ui.sp())
				ui.text('', 'Enter the 6-digit code', 0, '[', 't')
				let code = ui.input('login_code', '', 0)
				ui.mt(ui.sp2())
				ui.default_button('login_signin_button')
				if (ui.primary_icon_button('login_signin_button', 'key',
					'Sign in', 1, 's'))
					post('/login.json', {email: s.email, code: code},
						function(new_user) {
							user = new_user
							ui.state('login').email = null
							ui.animate()
						},
						function(e) { alert(e) }
					)

			}

		ui.end_v()
		ui.end_focus_group()
	ui.end_popup()

	ui.focus_first('login')

	return false
}
]]

function user_json()
	return {
		--signed_in is always non-nil to avoid an empty table to encode as [].
		signed_in = user() ~= nil and not user'anonymous',
		anonymous = user'anonymous',
		email = user'email',
		phone = user'phone',
	}
end

action['gen_auth_code.json'] = function()
	checkarg(method'POST')
	local email = checkarg(str_arg(post'email'))
	local code = auth_gen_code{email = email}
	return {email = email, code = config'env' == 'dev' and code or nil}
end

action['login.json'] = function()
	checkarg(method'POST')
	local email = checkarg(str_arg(post'email'))
	local code = checkarg(str_arg(post'code'))
	login{type = 'code', email = email, code = code}
	return user_json()
end

action['logout.json'] = function()
	checkarg(method'POST')
	login{type = 'logout'}
	return user_json()
end

--tie webb to cui
function action.en()
	local vars = {}
	login() --sets lang from user profile.
	vars.theme = user'theme'
	vars.title = (args(1) or ''):gsub('[-_]', ' ')
	vars.lang = lang()
	vars.country = country()
	vars.favicon_href = config('favicon_href', 'favicon.ico')
	vars.preloads = {}
	vars.fonts = {}
	for _,t in ipairs(fontfiles) do
		local name, path, desc = unpack(t, 1, 3)
		local url = '/'..path
		add(vars.preloads, format('\t<link rel="preload" href="%s" as="font" type="font/%s" crossorigin>\n',
			url, path_ext(path)))
		add(vars.fonts, format('ui.load_font(%s, %s%s)',
			json(name), json(url), desc and ', '..json(desc) or ''))
	end
	vars.main_file = app.main_file
	vars.preloads = cat(vars.preloads, '\n')
	vars.fonts = cat(vars.fonts, '\n')
	vars.user = json(user_json())
	vars.login_js = login_js
	out((([[
<html lang={{lang}} country={{country}} theme="{{theme}}"><head>
	<meta charset="utf-8">
	<title>{{title}}</title>
	<link rel="icon" href="{{favicon_href}}">
{{{preloads}}}
	<script src="/glue.js" global></script>
	<script src="/ui.js" global></script>
	<script src="/ui_validation.js" ></script>
	<script src="/ui_nav.js" ></script>
	<script src="/ui_grid.js" ></script>
	<script src="/ui_code_edit.js" ></script>
	<script src="/lezer.js" ></script>
	<script src="/webrtc.js" ></script>
	<script>
{{{fonts}}}
user = {{{user}}}
{{{login_js}}}
	</script>
	<script src="/{{main_file}}"></script>
</head><style></style>
<body>
</body>
</html>
]]):gsub('({{{?)(.-)}}}?', function(braces, k)
		local v = vars[k]
		return #braces == 3 and (v or '') or html_escape(v)
	end)))
end

action['404.html'] = action.en

function cui_module(path)
	local name = basename(path)
	package.path = package.path .. ';' .. path .. '/?.lua'
	local www = indir(path, 'www')
	if exists(www) then wwwdir(www) end
	load_config_file(indir(path, name..'.conf'))
	if exists(indir(path, name..'.lua')) then
		require(name)
	end
	local schema = name..'_schema.lua'
	if exists(indir(path, schema)) then
		db().schema:import(schema)
	end
end

return webb_app
