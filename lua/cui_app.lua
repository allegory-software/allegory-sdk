--[==[

	Canvas UI-based Application Server.
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	webb_app, canvas-ui, rowset, rowset_mdbx

USAGE

	require'cui_app'(...)
	....
	return exit(app:run())

API

	fontfile(name, path, [desc])  preload a font and load it in the page
	user_json() -> {signed_in=, anonymous=, name=, email=, phone=}
	db() -> db                             open the configured db
	scan(tbl, [path], [alias]) -> scan     db():scan()
	query('TABLE [ALIAS]'|rel, [alias]) -> rel   db():from()

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
	db_file      var/SCRIPTNAME.mdbx
	db_changes_size 16M

]==]

require'mdbx_schema'

db_schema = mdbx_schema() -- application paper schema
db_schema:import'schema_mdbx'

local webb_app = require'webb_app'
require'rowset'
require'rowset_mdbx'

local app_db
function db()
	if not app_db then
		require'mdbx_query'
		app_db = mdbx_open(config('db_file',
			varpath(scriptname..'.mdbx')), {owner = mainthread()})
		app_db:open_changes_file(config('db_changes_size', 16 * 1024^2))
		app_db.schema = db_schema
	end
	return app_db
end
function scan(...) return db():scan(...) end
function query(...) return db():from(...) end

cmd('install', 'Install application', function()
	app:install()
end)

local fontfiles = {}
function fontfile(name, path, desc)
	add(fontfiles, {name, path, desc})
end

function user_json()
	return {
		--signed_in is always non-nil to avoid an empty table to encode as [].
		signed_in = user() ~= nil and not user'anonymous',
		anonymous = user'anonymous',
		name = user'name',
		email = user'email',
		phone = user'phone',
		ui_state = user'ui_state' or '{}',
	}
end

action['user.json'] = user_json

action['ui_state.json'] = function()
	local uid = user() -- current user id
	allow(uid and not user'anonymous', 'sign in required')
	if method'POST' then
		local ui_state = checkarg(post'ui_state') -- saved UI state as JSON
		checkarg(try_json_decode(ui_state, null), 'invalid UI state JSON')
		db():atomic('w', function()
			db():update('usr', 'usr ui_state', uid, ui_state)
		end)
		return true
	else
		checkarg(method'GET')
		return {ui_state = user'ui_state' or '{}'}
	end
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
	vars.ui_state = (user'ui_state' or '{}'):gsub('<', '\\u003c')
	out((([[
<html lang={{lang}} country={{country}} theme="{{theme}}"><head>
	<meta charset="utf-8">
	<meta name="darkreader-lock">
	<title>{{title}}</title>
	<link rel="icon" href="{{favicon_href}}">
{{{preloads}}}
	<script src="/glue.js" global></script>
	<script src="/ui.js" global></script>
	<script src="/ui_icon_defs.js"></script>
	<script src="/ui_login.js" ></script>
	<script src="/ui_field.js" ></script>
	<script src="/ui_nav.js" ></script>
	<script src="/ui_grid.js" ></script>
	<script src="/ui_code_edit.js" ></script>
	<script src="/lezer.js" ></script>
	<script src="/webrtc.js" ></script>
	<script src="/ui_db_explorer.js" ></script>
	<script src="/ui_os_explorer.js" ></script>
	<script>
{{{fonts}}}
user = {{{user}}}
ui.saved_state = {{{ui_state}}}
ui.save_unsaved_state = function(saved_state) {
	post('/ui_state.json', {ui_state: json(saved_state)})
}
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
		db_schema:import(schema)
	end
end

local function cui_app(...)
	if package.loaded[scriptname] then return end
	webb_app(...)
	db_schema:import(function()
		add_cols('usr after theme', {
			ui_state, text,
		})
	end)
	function app:respond(req)
		tenant()
		checkfound(action(unpack(args())))
	end
	function app:install()
		local db = db() -- application database
		db:track_row_changes(false)
		db:sync_schema()
		db:track_row_changes(true)
	end
	app:before('run_server', function()
		watch_row_changes(db())
	end)
	after(logging.rpc, 'close_all_sockets', function()
		if app_db then
			app_db:close()
			app_db = nil
		end
	end)
end

return cui_app
