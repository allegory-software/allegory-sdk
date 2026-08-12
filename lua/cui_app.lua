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

	fontfile(name, path)          preload a font and declare its @font-face

USES

	app.main_file                 js file to run in the page

CONFIG

	favicon_href

]==]

local webb_app = require'webb_app'

local fontfiles = {}
function fontfile(name, path)
	add(fontfiles, {name, path})
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
	vars.css = {}
	for _,t in ipairs(fontfiles) do
		local name, path = unpack(t)
		local ext = path_ext(path)
		add(vars.preloads, format('\t<link rel="preload" href="/%s" as="font" type="font/%s" crossorigin>\n',
			path, ext))
		add(vars.css, format([[
@font-face {
	font-family: "%s";
	src: url(/%s) format(%s);
	font-display: block;
}
]], name, path, ext))
	end
	vars.main_file = app.main_file
	vars.preloads = cat(vars.preloads, '\n')
	vars.css = cat(vars.css, '\n')
	vars.user = json(user_json())
	out((([[
<html lang={{lang}} country={{country}} theme="{{theme}}"><head>
	<meta charset="utf-8">
	<title>{{title}}</title>
	<link rel="icon" href="{{favicon_href}}">
{{{preloads}}}
	<style>
{{{css}}}
	</style>
	<script src="/glue.js" global></script>
	<script src="/ui.js" global></script>
	<script src="/ui_validation.js" ></script>
	<script src="/ui_nav.js" ></script>
	<script src="/ui_grid.js" ></script>
	<script src="/ui_code_edit.js" ></script>
	<script src="/lezer.js" ></script>
	<script src="/adapter.js" ></script>
	<script src="/webrtc.js" ></script>
	<script>
user = {{{user}}}
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
