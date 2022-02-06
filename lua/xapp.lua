--[==[

	webb | x-widgets-based apps
	Written by Cosmin Apreutesei. Public Domain.

LOADS

	x-widgets, fontawesome, markdown-it, xauth

]==]

require'webb_spa'
require'xrowset'

js[[

on_dom_load(function() {
	init_components()
	init_auth()
	init_action()
})

]]

cssfile[[
fontawesome.css
x-widgets.css
]]

jsfile[[
markdown-it.js
markdown-it-easy-tables.js
x-widgets.js
x-nav.js
x-input.js
x-listbox.js
x-grid.js
x-module.js
]]

Sfile[[
webb.lua
webb_query.lua
webb_spa.lua
webb_xapp.lua
x-widgets.js
x-nav.js
x-input.js
x-listbox.js
x-grid.js
x-module.js
]]

fontfile'fa-solid-900.ttf'

require'xauth'
