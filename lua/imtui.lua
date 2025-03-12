--[[

	Immediate Mode Text User Interface library for Linux terminals.
	Written by Cosmin Apreutesei. Public Domain.

]]

require'glue'
assert(Linux, 'not on Linux')
require'fs'
require'sock'
require'signal'
require'termios'

local DEBUG = false

ui = {}

-- encoding and writing terminal output --------------------------------------

local TERM = env'TERM'
local term_is_256_color =
	TERM == 'xterm-256color' or
	TERM == 'screen-256color'

local term_is_dark = true --assume dark if detection fails
local term_bg_changed = noop

local function wr(s)
	return stdout:write(s)
end

local function wrf(s, ...)
	stdout:write(s:format(...))
end

local function text(s)
	return tostring(s):gsub('\27', 'ESC'):gsub('\n', '\r\n')
end

local function textf(s, ...)
	return text(s:format(...))
end

local function warnfl(s, ...)
	wr(text(s:format(...))); wr'\r\n'
end

local dbgfl = DEBUG and warnfl or noop

local pr = function(...)
	local n = select('#',...)
	for i=1,n do
		local v = select(i,...)
		wr(text(v))
		if i < n then
			wr'\t'
		end
	end
	wr'\r\n'
end

function logging:tostderr(entry)
	warnfl('%s', entry)
end

local wr_bg; do
local bg_color, bg_bright
local function wr_bg(color, bright)
	if bg_color == color and bg_bright == bright then return end
	wrf(term_is_256_color and '\27[48;5;%dm' or '\27[%d%dm', bright and '10' or '4', color)
	bg_color, bg_bright = color, bright
end
end

local wr_fg; do
local fg_color, fg_bright
function wr_fg(color, bright)
	if fg_color == color and fg_bright == bright then return end
	wrf(term_is_256_color and '\27[38;5;%dm' or '\27[%d%dm', bright and '9' or '3', color)
	fg_color, fg_bright = color, bright
end
end

local function gotoxy(x, y)
	wrf('\27[%d;%dH', y, x)
end

-- hsl to ansi color conversion ----------------------------------------------

--hsl is in (0..360, 0..1, 0..1); rgb is (0..1, 0..1, 0..1)
local function h2rgb(m1, m2, h)
	if h<0 then h = h+1 end
	if h>1 then h = h-1 end
	if h*6<1 then
		return m1+(m2-m1)*h*6
	elseif h*2<1 then
		return m2
	elseif h*3<2 then
		return m1+(m2-m1)*(2/3-h)*6
	else
		return m1
	end
end
local function hsl_to_rgb(h, s, L)
	h = h / 360
	local m2 = L <= .5 and L*(s+1) or L+s-L*s
	local m1 = L*2-m2
	return
		h2rgb(m1, m2, h+1/3),
		h2rgb(m1, m2, h),
		h2rgb(m1, m2, h-1/3)
end
local function hue_to_ansi_color(h)
	if h >= 0 and h < 30 then
		return 1 --red
	elseif h >= 30 and h < 90 then
		return 3 --yellow
	elseif h >= 90 and h < 150 then
		return 2 --green
	elseif h >= 150 and h < 210 then
		return 6 --cyan
	elseif h >= 210 and h < 270 then
		return 4 --blue
	elseif h >= 270 and h < 330 then
		return 5 --magenta
	else
		return 1 --red (for hs from 330 to 360)
	end
end
local function hsl_to_ansi_color(h, s, L)
	if s > .5 then
		local c = hue_to_ansi_color(h)
		return c, l > .5
	elseif L > .5 then --grayscale
		return 7, L > .75 --white
	else
		return 0, L > .25 --black
	end
end
local function hsl_to_256_color(h, s, L)
	if s > 0 then --saturated, use the 6x6x6 color cube.
		local r, g, b = hsl_to_rgb(h, s, L)
		--scale the rgb values to the range of 0-5.
		r = floor(r * 5 + 0.5)
		g = floor(g * 5 + 0.5)
		b = floor(b * 5 + 0.5)
		return 16 + (r * 36) + (g * 6) + b
	elseif L == 0 then --grayscale (24 gray levels) + 0 (black) + 15 (white)
		return 0 --black
	elseif L == 1 then
		return 7, true -- white
	else --gray
		return floor(232 + (L / 255) * 23)
	end
end
local function hsl_to_color(h, s, L)
	if term_is_256_color then
		return hsl_to_256_color(h, s, L)
	else
		return hsl_to_ansi_color(h, s, L)
	end
end

-- reading and decoding terminal input ---------------------------------------

local b = new'char[128]'
local function rd()
	stdin:readn(b, 1)
	if DEBUG then dbgfl(' rd %s %s', b[0], char(b[0])) end
	return b[0]
end

local function rd_to(c1, c2, err)
	c1 = byte(c1)
	c2 = byte(c2)
	for i = 0,127 do
		stdin:readn(b+i, 1)
		if b[i] == c1 or b[i] == c2 then
			if DEBUG then dbgfl('  rd_to %s or %s: %d "%s" %s',
				char(c1), char(c2), i, str(b, i+1), err or '') end
			return str(b, i+1)
		end
	end
	assertf(false, '%s: "%s"', err or 'invalid sequence', text(s))
end

local function wait_rd(timeout)
	stdin:settimeout(timeout)
	local len, err = stdin:try_read(b, 1)
	stdin:settimeout(nil)
	if not len and err == 'timeout' then
		if DEBUG then dbgfl(' %s', 'timeout') end
		return nil
	else
		assert(len == 1, 'eof')
	end
	if DEBUG then dbgfl(' wait_rd %s %s', b[0], char(b[0])) end
	return b[0]
end

key = nil
scroll = nil
mx, my = nil
mstate, ldown, lup, rdown, rup, mdown, mup = nil

local function read_input() --read keyboard and mouse input in raw mode
	key = nil
	scroll = nil
	local c = rd()
	if c == 27 then --\033
		c = wait_rd(.01)
		if not c then
			key = 'esc'
		elseif c == 91 then --[
			c = rd()
			if     c == 65 then
				key = 'up'
			elseif c == 66 then
				key = 'down'
			elseif c == 67 then
				key = 'right'
			elseif c == 68 then
				key = 'left'
			elseif c == 49 then
				c = rd()
				if     c == 49 then if rd() == 126 then key = 'f1' end
				elseif c == 50 then if rd() == 126 then key = 'f2' end
				elseif c == 51 then if rd() == 126 then key = 'f3' end
				elseif c == 52 then if rd() == 126 then key = 'f4' end
				elseif c == 53 then if rd() == 126 then key = 'f5' end
				elseif c == 55 then if rd() == 126 then key = 'f6' end
				elseif c == 56 then if rd() == 126 then key = 'f7' end
				elseif c == 57 then if rd() == 126 then key = 'f8' end
				elseif c == 126 then key = 'home'
				end
			elseif c == 50 then
				c = rd()
				if     c == 48 then if rd() == 126 then key = 'f9' end
				elseif c == 49 then if rd() == 126 then key = 'f10' end
				elseif c == 51 then if rd() == 126 then key = 'f11' end
				elseif c == 52 then if rd() == 126 then key = 'f12' end
				elseif c == 126 then key = 'insert'
				end
			elseif c == 51 then if rd() == 126 then key = 'delete' end
			elseif c == 52 then if rd() == 126 then key = 'end' end
			elseif c == 53 then if rd() == 126 then key = 'pageup' end
			elseif c == 54 then if rd() == 126 then key = 'pagedown' end
			elseif c == 60 then --<
				local s = rd_to('M', 'm')
				local b, smx, smy, st = s:match'^(%d+);(%d+);(%d+)([Mm])$'
				if not b then
					assertf(false, 'invalid mouse event sequence: "%s"', text(s))
				end
				mx = num(smx)
				my = num(smy)
				if b == '0' then
					ldown = st == 'M'
					lup   = st == 'm'
					mstate = b..st
				elseif b == '2' then
					rdown = st == 'M'
					ldown = st == 'm'
					mstate = b..st
				elseif b == '1' then
					mdown = st == 'M'
					mup   = st == 'm'
					mstate = b..st
				elseif b == '64' then
					scroll = -1
				elseif b == '65' then
					scroll = 1
				end
				if DEBUG then dbgfl('mouse %d %d %s %s', mx, my, b, st) end
			end
		elseif c == 93 then --]
			local s = rd_to('\7', '\7') --report terminal bg color
			local r, g, b = s:match'^11;rgb:(.-)/(.-)/(.-)\7$'
			r = assert(tonumber(r, 16)) / 0xffff
			g = assert(tonumber(g, 16)) / 0xffff
			b = assert(tonumber(b, 16)) / 0xffff
			local L = 0.2126 * r + 0.7152 * g + 0.0722 * b
			term_is_dark = L < .5
			term_bg_changed()
		end
	elseif c == 127 then
		key = 'backspace'
	elseif c >= 32 and c <= 126 then
		key = char(c)
	elseif c == 13 then
		key = 'enter'
	else
		key = c
	end
	if DEBUG and key then dbgfl('key %s', key) end
end

-- imgui themes and colors ---------------------------------------------------

local themes = {}
ui.themes = themes

function theme_make(name, is_dark)
	themes[name] = {
		is_dark = is_dark,
		name    = name,
		fg      = {}, --{state->color_def}
		border  = {}, --{state->color_def}
		bg      = {}, --{state->color_def}
	}
end

theme_make('light', false)
theme_make('dark' , true)

local theme
function ui.get_theme() return theme.name end
function ui.dark() return theme.is_dark end
ui.default_theme = 'dark'

local parse_state_combis = memoize(function(s)
	return cat(sort(collect(words(trim(s)))), ' ') --normalize state combinations
end)
function parse_state(s)
	if not s then return 'normal' end
	if s == 'normal' then return 'normal' end
	if s == 'hover'  then return 'hover'  end
	if s == 'active' then return 'active' end
	return parse_state_combis(s)
end

--colors are specified by (theme, name, state) with 'normal' state as fallback.
function def_color_func(k)
	local function def_color(theme, name, state, h, s, L, is_dark)
		if theme == '*' then -- define color for all themes
			for theme_name in pairs(themes) do
				def_color(theme_name, name, state, h, s, L, is_dark)
			end
			return
		end
		local states = themes[theme][k]
		if state == '*' then -- copy all states of a color
			local src_name = h
			assert(isstr(h), 'expected color name to copy for all states')
			for state, colors in pairs(states) do
				colors[name] = colors[src_name]
			end
			return
		end
		local state = parse_state(state)
		if istab(h) then --color def to copy
			states[state][name] = h
		else
			local ansi_color, bright = hsl_to_color(h, s, L)
			attr(states, state)[name] = {ansi_color, bright, is_dark or L < .5}
		end
	end
	return def_color
end

function lookup_color_func(k)
	return function(name, state, theme1)
		state = parse_state(state)
		theme1 = theme1 and themes[theme1] or theme
		local c = theme1[k][state][name] or theme[k].normal[name]
		if not c then
			assert(false, 'no ' .. k .. ' for (' .. name .. ', ' ..
				state .. ', ' .. theme1.name .. ')')
		end
		return c
	end
end

-- text colors ---------------------------------------------------------------

ui.fg_style = def_color_func'fg'
ui.fg_color = lookup_color_func'fg'

--           theme    name     state       h     s     L
------------------------------------------------------------------------------
ui.fg_style('light', 'text'   , 'normal' ,   0, 0.00, 0.00)
ui.fg_style('light', 'text'   , 'hover'  ,   0, 0.00, 0.30)
ui.fg_style('light', 'text'   , 'active' ,   0, 0.00, 0.40)
ui.fg_style('light', 'label'  , 'normal' ,   0, 0.00, 0.00)
ui.fg_style('light', 'label'  , 'hover'  ,   0, 0.00, 0.00)
ui.fg_style('light', 'link'   , 'normal' , 222, 0.00, 0.50)
ui.fg_style('light', 'link'   , 'hover'  , 222, 1.00, 0.70)
ui.fg_style('light', 'link'   , 'active' , 222, 1.00, 0.80)

ui.fg_style('dark' , 'text'   , 'normal' ,   0, 0.00, 0.90)
ui.fg_style('dark' , 'text'   , 'hover'  ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'text'   , 'active' ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'label'  , 'normal' ,   0, 0.00, 0.95)
ui.fg_style('dark' , 'label'  , 'hover'  ,   0, 0.00, 0.90)
ui.fg_style('dark' , 'link'   , 'normal' ,  26, 0.88, 0.60)
ui.fg_style('dark' , 'link'   , 'hover'  ,  26, 0.99, 0.70)
ui.fg_style('dark' , 'link'   , 'active' ,  26, 0.99, 0.80)

ui.fg_style('light', 'marker' , 'normal' ,   0, 0.00, 0.5) -- TODO
ui.fg_style('light', 'marker' , 'hover'  ,   0, 0.00, 0.5) -- TODO
ui.fg_style('light', 'marker' , 'active' ,   0, 0.00, 0.5) -- TODO

ui.fg_style('dark' , 'marker' , 'normal' ,  61, 1.00, 0.57)
ui.fg_style('dark' , 'marker' , 'hover'  ,  61, 1.00, 0.57) -- TODO
ui.fg_style('dark' , 'marker' , 'active' ,  61, 1.00, 0.57) -- TODO

ui.fg_style('light', 'button-danger', 'normal', 0, 0.54, 0.43)
ui.fg_style('dark' , 'button-danger', 'normal', 0, 0.54, 0.43)

ui.fg_style('light', 'faint' , 'normal' ,  0, 0.00, 0.70)
ui.fg_style('dark' , 'faint' , 'normal' ,  0, 0.00, 0.30)

-- border colors -------------------------------------------------------------

ui.border_style = def_color_func'border'
ui.border_color = lookup_color_func'border'

--               theme    name        state       h     s     L
------------------------------------------------------------------------------
ui.border_style('light', 'light'   , 'normal' ,   0,    0,    0)
ui.border_style('light', 'light'   , 'hover'  ,   0,    0,    0)
ui.border_style('light', 'intense' , 'normal' ,   0,    0,    0)
ui.border_style('light', 'intense' , 'hover'  ,   0,    0,    0)
ui.border_style('light', 'max'     , 'normal' ,   0,    0,    0)
ui.border_style('light', 'marker'  , 'normal' ,  61, 1.00, 0.57) -- TODO

ui.border_style('dark' , 'light'   , 'normal' ,   0,    0,    1)
ui.border_style('dark' , 'light'   , 'hover'  ,   0,    0,    1)
ui.border_style('dark' , 'intense' , 'normal' ,   0,    0,    1)
ui.border_style('dark' , 'intense' , 'hover'  ,   0,    0,    1)
ui.border_style('dark' , 'max'     , 'normal' ,   0,    0,    1)
ui.border_style('dark' , 'marker'  , 'normal' ,  61, 1.00, 0.57)

-- background colors ---------------------------------------------------------

ui.bg_style = def_color_func'bg'
ui.bg_color = lookup_color_func'bg'

function set_bg_color(color, state)
	assert(isstr(color))
	local c = bg_color(color, state)
	local is_dark = c[3]
	theme = is_dark and themes.dark or themes.light
	wr_bg(c[1], c[2])
end

--           theme    name      state       h     s     L
------------------------------------------------------------------------------
ui.bg_style('light', 'bg0'   , 'normal' ,   0, 0.00, 0.98)
ui.bg_style('light', 'bg'    , 'normal' ,   0, 0.00, 1.00)
ui.bg_style('light', 'bg'    , 'hover'  ,   0, 0.00, 0.95)
ui.bg_style('light', 'bg'    , 'active' ,   0, 0.00, 0.93)
ui.bg_style('light', 'bg1'   , 'normal' ,   0, 0.00, 0.95)
ui.bg_style('light', 'bg1'   , 'hover'  ,   0, 0.00, 0.93)
ui.bg_style('light', 'bg1'   , 'active' ,   0, 0.00, 0.90)
ui.bg_style('light', 'bg2'   , 'normal' ,   0, 0.00, 0.85)
ui.bg_style('light', 'bg2'   , 'hover'  ,   0, 0.00, 0.82)
ui.bg_style('light', 'bg3'   , 'normal' ,   0, 0.00, 0.70)
ui.bg_style('light', 'bg3'   , 'hover'  ,   0, 0.00, 0.75)
ui.bg_style('light', 'bg3'   , 'active' ,   0, 0.00, 0.80)
ui.bg_style('light', 'alt'   , 'normal' ,   0, 0.00, 0.95) -- bg alternate for grid cells
ui.bg_style('light', 'smoke' , 'normal' ,   0, 0.00, 1.00, 0.80)
ui.bg_style('light', 'input' , 'normal' ,   0, 0.00, 0.98)
ui.bg_style('light', 'input' , 'hover'  ,   0, 0.00, 0.94)
ui.bg_style('light', 'input' , 'active' ,   0, 0.00, 0.90)

ui.bg_style('dark' , 'bg0'   , 'normal' , 216, 0.28, 0.08)
ui.bg_style('dark' , 'bg'    , 'normal' , 216, 0.28, 0.10)
ui.bg_style('dark' , 'bg'    , 'hover'  , 216, 0.28, 0.12)
ui.bg_style('dark' , 'bg'    , 'active' , 216, 0.28, 0.14)
ui.bg_style('dark' , 'bg1'   , 'normal' , 216, 0.28, 0.15)
ui.bg_style('dark' , 'bg1'   , 'hover'  , 216, 0.28, 0.19)
ui.bg_style('dark' , 'bg1'   , 'active' , 216, 0.28, 0.22)
ui.bg_style('dark' , 'bg2'   , 'normal' , 216, 0.28, 0.22)
ui.bg_style('dark' , 'bg2'   , 'hover'  , 216, 0.28, 0.25)
ui.bg_style('dark' , 'bg3'   , 'normal' , 216, 0.28, 0.29)
ui.bg_style('dark' , 'bg3'   , 'hover'  , 216, 0.28, 0.31)
ui.bg_style('dark' , 'bg3'   , 'active' , 216, 0.28, 0.33)
ui.bg_style('dark' , 'alt'   , 'normal' , 260, 0.28, 0.13)
ui.bg_style('dark' , 'smoke' , 'normal' ,   0, 0.00, 0.00)
ui.bg_style('dark' , 'input' , 'normal' , 216, 0.28, 0.17)
ui.bg_style('dark' , 'input' , 'hover'  , 216, 0.28, 0.21)
ui.bg_style('dark' , 'input' , 'active' , 216, 0.28, 0.25)

-- TODO: see if we can find a declarative way to copy fg colors to bg in bulk.
for _,theme in ipairs{'light', 'dark'} do
	for _,state in ipairs{'normal', 'hover', 'active'} do
		for _,fg in ipairs{'text', 'link', 'marker'} do
			ui.bg_style(theme, fg, state, ui.fg_color(fg, state, theme))
		end
	end
end

ui.bg_style('light', 'scrollbar', 'normal' ,   0, 0.00, 0.70, 0.5)
ui.bg_style('light', 'scrollbar', 'hover'  ,   0, 0.00, 0.75, 0.8)
ui.bg_style('light', 'scrollbar', 'active' ,   0, 0.00, 0.80, 0.8)

ui.bg_style('dark' , 'scrollbar', 'normal' , 216, 0.28, 0.37, 0.5)
ui.bg_style('dark' , 'scrollbar', 'hover'  , 216, 0.28, 0.39, 0.8)
ui.bg_style('dark' , 'scrollbar', 'active' , 216, 0.28, 0.41, 0.8)

ui.bg_style('*', 'button'        , '*' , 'bg')
ui.bg_style('*', 'button-primary', '*' , 'link')

ui.bg_style('*', 'search' , 'normal',  60,  1.00, 0.80) -- quicksearch text bg
ui.bg_style('*', 'info'   , 'normal', 200,  1.00, 0.30) -- info bubbles
ui.bg_style('*', 'warn'   , 'normal',  39,  1.00, 0.50) -- warning bubbles
ui.bg_style('*', 'error'  , 'normal',   0,  0.54, 0.43) -- error bubbles

-- input value states
ui.bg_style('light', 'item', 'new'           , 240, 1.00, 0.97)
ui.bg_style('light', 'item', 'modified'      , 120, 1.00, 0.93)
ui.bg_style('light', 'item', 'new modified'  , 180, 0.55, 0.87)

ui.bg_style('dark' , 'item', 'new'           , 240, 0.35, 0.27)
ui.bg_style('dark' , 'item', 'modified'      , 120, 0.59, 0.24)
ui.bg_style('dark' , 'item', 'new modified'  , 157, 0.18, 0.20)

-- grid cell & row states. these need to be opaque!
ui.bg_style('light', 'item', 'item-focused'                       ,   0, 0.00, 0.93)
ui.bg_style('light', 'item', 'item-selected'                      ,   0, 0.00, 0.91)
ui.bg_style('light', 'item', 'item-focused item-selected'         ,   0, 0.00, 0.87)
ui.bg_style('light', 'item', 'item-focused focused'               ,   0, 0.00, 0.87)
ui.bg_style('light', 'item', 'item-focused item-selected focused' , 139 / 239 * 360, 141 / 240, 206 / 240)
ui.bg_style('light', 'item', 'item-selected focused'              , 139 / 239 * 360, 150 / 240, 217 / 240)
ui.bg_style('light', 'item', 'item-error'                         ,   0, 0.54, 0.43)
ui.bg_style('light', 'item', 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.bg_style('light', 'row' , 'item-focused focused'               , 139 / 239 * 360, 150 / 240, 231 / 240)
ui.bg_style('light', 'row' , 'item-focused'                       , 139 / 239 * 360,   0 / 240, 231 / 240)
ui.bg_style('light', 'row' , 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.bg_style('dark' , 'item', 'item-focused'                       , 195, 0.06, 0.12)
ui.bg_style('dark' , 'item', 'item-selected'                      ,   0, 0.00, 0.20)
ui.bg_style('dark' , 'item', 'item-focused item-selected'         , 208, 0.11, 0.23)
ui.bg_style('dark' , 'item', 'item-focused focused'               ,   0, 0.00, 0.23)
ui.bg_style('dark' , 'item', 'item-focused item-selected focused' , 211, 0.62, 0.24)
ui.bg_style('dark' , 'item', 'item-selected focused'              , 211, 0.62, 0.19)
ui.bg_style('dark' , 'item', 'item-error'                         ,   0, 0.54, 0.43)
ui.bg_style('dark' , 'item', 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.bg_style('dark' , 'row' , 'item-focused focused'               , 212, 0.61, 0.13)
ui.bg_style('dark' , 'row' , 'item-focused'                       ,   0, 0.00, 0.13)
ui.bg_style('dark' , 'row' , 'item-error item-focused'            ,   0, 1.00, 0.60)

-- command state -------------------------------------------------------------

function reset_canvas()
	theme = themes[ui.default_theme]
	bg_color, bg_bright = hsl_to_color(0, 0, 0)
	fg_color, fg_bright = hsl_to_color(0, 0, 1)
	--scope_set('fg_color', fg_color)
	--scope_set('bg_color', bg_color)
	--scope_set('theme', theme)
end

-- current command recording -------------------------------------------------

local a --current recording

-- Format of a command recording array:
--
--  next_i, cmd, arg1..n, prev_i; next_i, cmd, arg1..n, prev_i; ...
--    |            ^        |                    ^
--    |            +--------+                    |
--    +------------------------------------------+
--
-- With next_i and prev_i we can walk back and forth between commands,
-- always landing at the command's arg#1. From the arg#1 index then we have
-- the command code at a[i-1], next command's arg#1 at i+a[i-2] and prev
-- command's arg#1 at i+a[i-3]. To walk the command array as a tree, we check
-- when a container starts with `a[i-1] & 1` (all containers have even codes)
-- and when it ends with `a[i-1] == 'end'` (all containers end with the same
-- "end" command). To skip all container's children and jump to the next
-- sibling we use cmd_next_ext_i(). To go back to the container's command
-- from its "end" command, we use i+a[i].
-- NOTE: Using relative indexes everywhere allows creating command recordings
-- that are relocatable, i.e. can be moved into other recordings without
-- having to reoffset the indexes.

local function cmd_next_i(a, i) return i+a[i-2] end --index of next cmd
local function cmd_prev_i(a, i) return i+a[i-3] end --index of prev cmd
local function cmd_last_i(a) return cmd_prev_i(a, #a+3) end --index of last command in a
local function cmd_arg_end_i(a, i) return cmd_next_i(a, i)-3 end --index after the last arg

function ui.cmd(cmd, ...)
	cmd = assertf(ui.cmds[cmd], 'unknown command: %s', cmd)
	local i = #a+3 -- abs index of this cmd's arg#1
	local argc = select('#', ...)
	local next_i = argc+3 -- rel index of next cmd's arg#1
	local prev_i = -next_i -- rel index of this cmd's arg#1, rel to next cmd's arg#1
	add(a, next_i)
	add(a, cmd)
	for i = 1, argc do
		add(a, (select(i, ...)))
	end
	add(a, prev_i)
	return i
end

local function C(a, i) return a[i-1].name end

-- print recording
ui.disas = function(a)
	local i = 3
	local tabs = 0
	while i < #a do
		local cmd = a[i-1]
		local i1 = cmd_arg_end_i(a, i)
		local args = slice(a, i, i1)
		if cmd.name == 'end' then
			tabs = tabs - 1
		end
		pr(('  '):rep(tabs) .. cmd.name)
		if cmd.is_ct then
			tabs = tabs + 1
		end
		i = cmd_next_i(a, i)
	end
end

-- command recordings --------------------------------------------------------

--local rec_freelist = array_freelist()

function rec()
	local a = {} --rec_freelist.alloc()
	return a
end

function free_rec(a)
	--a.length = 0
	--if (a.nohit_set)
	--	a.nohit_set.clear()
	--rec_freelist.free(a)
end

local rec_stack = {}

ui.start_recording = function()
	local a1 = rec()
	add(rec_stack, a)
	a = a1
end

ui.end_recording = function()
	local a1 = a
	a = del(rec_stack)
	return a1
end

ui.play_recording = function(a1)
	extend(a, a1)
	--free_rec(a1)
end

function rec_stack_check()
	assert(#rec_stack == 0, 'recordings left unplayed')
end

-- secondary command recordings ----------------------------------------------

local recs = {}
local rec_i

local function begin_rec()
	local a0 = a
	a = rec()
	ui.a = a
	rec_i = #recs
	add(recs, a)
	return a0
end

local function end_rec(a0)
	local a1 = a
	a = a0
	return a1
end

local function free_recs()
	--for _,a in ipairs(recs) do
	--	free_rec(a)
	--recs.length = 0
	recs = {}
end

-- z-layers ------------------------------------------------------------------

local layer_map = {} -- {name->layer}
local layer_arr = {} -- {layer1,...} in creation order

local layers = {} -- {layer1,...} in paint order

function ui.layer(name, index)
	if not name then
		return current_layer
	end
	local layer = layer_map[name]
	if not layer then
		layer = {}
		layer.name = assert(name)
		if index ~= null then
			insert(layers, index, layer)
		end
		layer_map[name] = layer
		add(layer_arr, layer)
		layer.i = layer_arr.length
		if not layer.indexes then
			layer.indexes = {} -- [rec1_i, ct1_i, z_index1, rec2_i, ct2_i, z_index2, ...]
		end
	end
	return layer
end

local function clear_layers()
	for _,layer in ipairs(layer_arr) do
		layer.indexes = {}
	end
end

local layer_base =
ui.layer('base'   , 0)
ui.layer('window' , 1) -- modals
-- all these below must be temporary to work with modals!
ui.layer('overlay', 2) -- temporary overlays that must show behind the dragged object.
ui.layer('tooltip', 3)
ui.layer('open'   , 4) -- dropdowns, must cover tooltips
ui.layer('handle' , 5) -- dragged object

local layer_stack = {} -- {layer1_i, ...}
local current_layer    -- set while building
local current_layer_i  -- set while drawing

function begin_layer(layer, ct_i, z_index)
	add(layer_stack, current_layer)
	-- NOTE: only adding the cmd to the layer if the current layer actually
	-- changes otherwise it will be drawn twice!
	-- TODO: because of the condition below, start_recording on a layer and
	-- play_recording on another layer is not supported: either support it
	-- or prevent it!
	if layer == current_layer then
		return
	end
	current_layer = layer
	ui.set_layer(layer, ct_i, z_index)
	return true
end

function end_layer()
	current_layer = del(layer_stack)
end

function layer_stack_check()
	if #layer_stack > 0 then
		for _,layer in ipairs(layer_stack) do
			warnfl('layer %s not closed', layer.name)
		end
		assert(false)
	end
end

-- container stack -----------------------------------------------------------

-- used in both frame creation and measuring stages.

local ct_stack = {} -- {ct_i1,...}
ui.ct_stack = ct_stack

function ui.ct_i() return assert(ct_stack[#ct_stack], 'no container') end
function ui.rel_ct_i() return ui.ct_i() - #a + 2 end

function ct_stack_check(a)
	if #ct_stack > 0 then
		for _,i in ipairs(ct_stack) do
			warnfl('%s not closed', C(a, i))
		end
		assert(false)
	end
end

-- measuring phase (per-axis) ------------------------------------------------

-- walk the element tree bottom-up and call the measure function for each
-- element that has it. uses ct_stack for recursion and containers'
-- measure_end callback to do the work.

function measure_rec(a, axis)
	ui.disas(a)
	local i, n = 3, #a
	while i < n do
		local cmd = a[i-1]
		local measure_f = cmd.measure
		if measure_f then
			measure_f(a, i, axis)
		end
		i = cmd_next_i(a, i)
	end
end

-- positioning phase (per-axis) ----------------------------------------------

-- walk the element tree top-down, and call the position function for each
-- element that has it. recursive, uses call stack to pass ct_i and ct_w.

function position_rec(a, axis, ct_w)
	local i, n = 3, #a
	while i < n do
		local cmd = a[i-1]
		local position_f = cmd.position
		if position_f then
			local min_w = a[i+2+axis]
			position_f(a, i, axis, 0, max(min_w, ct_w))
		end
		i = cmd_next_ext_i(a, i)
	end
end

-- translation phase ---------------------------------------------------------

-- do scrolling and popup positioning and offset all boxes (top-down, recursive).

function translate_rec(a, x, y)
	local i, n = 3, #a
	while i < n do
		local cmd = a[i-1]
		local translate_f = cmd.translate
		if translate_f then
			translate_f(a, i, x, y)
		end
		i = cmd_next_ext_i(a, i)
	end
end

-- drawing phase -------------------------------------------------------------

local theme_stack = {}

function draw_cmd(a, i, recs)
	local next_ext_i = cmd_next_ext_i(a, i)
	while i < next_ext_i do
		local cmd = a[i-1]
		if cmd.is_ct then
			add(theme_stack, theme)
		elseif cmd.is_end then
			theme = del(theme_stack)
		end
		local draw_f = cmd.draw
		if draw_f and draw_f(a, i, recs) then
			i = cmd_next_ext_i(a, i)
			if cmd.is_ct then
				theme = del(theme_stack)
			end
		else
			i = i + a[i-2] --next_i
		end
	end
end

function draw_layer(layer_i, indexes, recs)
	local prev_layer_i = current_layer_i
	--[[global]] current_layer_i = layer_i
	for k = 0, #indexes, 3 do
		reset_canvas()
		local rec_i = indexes[k]
		local i     = indexes[k+1]
		local a = recs[rec_i]
		draw_cmd(a, i, recs)
	end
	current_layer_i = prev_layer_i
end

function draw_layers(layers, recs)
	for _,layer in ipairs(layers) do
		draw_layer(layer.i, layer.indexes, recs)
	end
end

function draw_frame(recs, layers)
	local theme_stack_length0 = #theme_stack
	add(theme_stack, theme)
	theme = themes[ui.default_theme]

	draw_layers(layers, recs)
	assert(current_layer_i == nil)

	theme = del(theme_stack)
	assert(#theme_stack == theme_stack_length0)
end

-- hit-testing phase ---------------------------------------------------------

--local hit_state_map_freelist = map_freelist()
local hit_state_maps = {} -- {id->map}

ui._hit_state_maps = hit_state_maps

function hovers(id, k)
	if not id then return end
	local m = hit_state_maps[id]
	return k and m and m[k] or m
end
ui.hovers = hovers

function hit(id, k)
	if ui.captured_id then --unavailable while captured
		return
	end
	return hovers(id, k)
end
ui.hit = hit

--[[
function hit_match(prefix)
	for (local [id] of hit_state_maps)
		if (id.startsWith(prefix))
			return id.substring(prefix.length)
}
ui.hit_match = hit_match

function hover(id) {
	if (!id) return
	local m = hit_state_maps.get(id)
	if (!m) {
		m = hit_state_map_freelist.alloc()
		hit_state_maps.set(id, m)
	}
	return m
}
ui.hover = hover
]]

function hit_layer(layer, recs)
	--[[global]] current_layer = layer
	--iterate layer's cointainers in reverse order.
	local indexes = layer.indexes
	for k = #indexes-3, 1, -3 do
		reset_canvas()
		local rec_i = indexes[k]
		local i     = indexes[k+1]
		local a = recs[rec_i]
		local hit_f = hittest[a[i-1]]
		if hit_f and not a.nohit_set[i] and hit_f(a, i, recs) then
			return true
		end
	end
end

function hit_layers(layers, recs)
	--iterate layers in reverse order.
	for j = #layers, 1, -1 do
		local layer = layers[j]
		if layer.layers and #layer.layers > 0 then
			if hit_layers(layer.layers, recs) then
				return true
			end
		end
		if hit_layer(layer, recs) then
			return true
		end
	end
end

function hit_frame(recs, layers)

	hit_state_maps = {}

	if not ui.mx then
		return
	end

	hit_layers(layers, recs)
	current_layer = nil

end

--imgui loop -----------------------------------------------------------------

local want_relayout

ui.relayout = function()
	want_relayout = true
end

function layout_rec(a, x, y, w, h)
	reset_canvas()

	-- x-axis
	measure_rec(a, 0)
	ct_stack_check(a)
	position_rec(a, 0, w)

	-- y-axis
	measure_rec(a, 1)
	ct_stack_check(a)
	position_rec(a, 1, h)

	translate_rec(a, x, y)
end

function frame_end_check()
	ct_stack_check(a)
	layer_stack_check()
	--scope_stack_check()
	rec_stack_check()
end

ui.frame_changed = noop

ui.focusables = {}

local function redraw()

	wrf'\27[0m' --reset all styles

	local relayout_count = 0
	while 1 do

		want_relayout = false

		hit_frame(recs, layers)

		if key == 'tab' then
			local i = indexof(ui.focusables, ui.focused_id)
			if i then
				--TODO
				--local next_i = (i + (shift ? -1 : 1)) % ui.focusables.length
				local id = ui.focusables[next_i]
				ui.focus(id, true)
			end
		end
		ui.focusables = {}

		--measure_req_all()

		clear_layers()
		free_recs()

		t0 = clock()

		reset_canvas()

		begin_rec()
		local i = ui.stack()
			begin_layer(layer_base, i)
			assert(rec_i == 0)
			ui.main()
		ui.end_stack()
		end_layer()
		frame_end_check()

		local a = end_rec()
		layout_rec(a, 0, 0, screen_w, screen_h)

		id_state_gc()

		if not want_relayout then
			t0 = clock()

			wr'\27[2J' --clear screen

			draw_frame(recs, layers)

			ui.frame_changed()
		end

		reset_canvas()

		if ui.clickup then
			ui.captured_id = nil
			capture_state = {}
		end

		reset_pointer_state()

		key = nil
		focusing_id = nil

		if not want_relayout then
			break
		end
		relayout_count = relayout_count + 1
		if relayout_count > 2 then
			wr'relayout loop detected\r\n'
			break
		end
	end

end

-- widgets -------------------------------------------------------------------

ui.cmds = {} --{cmd_name->cmd_class}

ui.widget = function(cmd, t)
	local class = update({name = cmd}, t)
	ui.cmds[cmd] = class
	if t.is_ct then
		ui['end_'..cmd] = function()
			ui.end_cmd(cmd)
		end
	end
	local create = t.create
	if create then
		function wrapper(...)
			return create(cmd, ...)
		end
		ui[cmd] = wrapper
		local setstate = t.setstate
		if t.setstate then
			function wrapper(...)
				return create(cmd, ...)
			end
			ui[cmd+'_state'] = wrapper
		end
		return wrapper
	else
		return class
	end
end

-- set_layer command ---------------------------------------------------------

local SET_LAYER_Z_INDEX = 2

-- binsearch cmp func for finding last insert position by z_index in flattened
-- array of (rec_i, i, z_index) tuples.
local function cmp_z_index(a, i, v) return a[i*3+2] <= v end

ui.widget('set_layer', {

	-- puts a cmd on a layer. the reason for generating a set_layer command
	-- instead of just doing the work here is because we might be in a command
	-- recording and thus we don't know the final ct_i after the recording is played.
	create = function(_, layer, ct_i, z_index)
		ct_i = ct_i or ui.ct_i()
		local i = ui.cmd('set_layer', layer.i, ct_i, z_index or 0)
		a[i+1] = a[i+1] - i -- make ct_i relative
	end,

	-- doesn't have to happen on translate, any stage before drawing will do.
	translate = function(a, i)
		local layer_i = a[i+0]
		local ct_i  = i+a[i+1]
		local z_index = a[i+2]
		local layer = layer_arr[layer_i]
		if z_index == 0 and layer.indexes[#layer.indexes] == 0 then -- common path, z-index not used
			add(layer.indexes, rec_i)
			add(layer.indexes, ct_i)
			add(layer.indexes, z_index)
		else
			local insert_i = binsearch(layer.indexes, z_index, cmp_z_index, 0, layer.indexes.length / 3) * 3
			assert(false, 'NYI')
			--layer.indexes.splice(insert_i, 0, rec_i, ct_i, z_index)
		end
	end,

})

-- draw_layer command --------------------------------------------------------

ui.widget('draw_layer', {

	create = function(_, layer)
		layer = ui_layer(layer)
		ui.cmd('draw_layer', layer.i, layer.indexes)
	end,

	draw = function(a, i, recs)
		local layer_i = a[i+0]
		local indexes = a[i+1]
		draw_layer(layer_i, indexes, recs)
	end,

})

-- box widgets ---------------------------------------------------------------

local FR         =  5 -- all `is_flex_child` widgets: fraction from main-axis size.
local ALIGN      =  6 -- vert. align at ALIGN+1
local NEXT_EXT_I =  8 -- all container-boxes: next command after this one's 'end' command.
local S          =  9 -- first index after the ui.cmd_box_ct header.

function ui.cmd_box(cmd, fr, align, valign, min_w, min_h, ...)
	return ui.cmd(cmd,
		min_w or 0, -- min_w in measuring phase; x in positioning phase
		min_h or 0, -- min_h in measuring phase; y in positioning phase
		0, --children's min_w in measuring phase; w in positioning phase
		0, --children's min_h in measuring phase; h in positioning phase
		max(0, fr or 1),
		align or 's',
		valign or 's',
		...
	)
end

-- box measure phase

local function add_ct_min_wh(a, axis, w)
	local i = ct_stack[#ct_stack]
	if not i then -- root ct
		return
	end
	local cmd = a[i-1]
	local main_axis = is_main_axis(cmd, axis)
	local min_w = a[i+2+axis]
	if main_axis then
		local gap = a[i+FLEX_GAP]
		a[i+2+axis] = min_w + w + gap
	else
		a[i+2+axis] = max(min_w, w)
	end
end
ui.add_ct_min_wh = add_ct_min_wh

local function ct_stack_push(a, i)
	add(ct_stack, i)
end

-- calculate a[i+2]=min_w (for axis=0) or a[i+3]=min_h (for axis=1).
-- the minimum dimensions include margins and paddings.
local function box_measure(a, i, axis)
	a[i+2+axis] = max(a[i+2+axis], a[i+0+axis]) -- apply own min_w|h
	local min_w = a[i+2+axis]
	add_ct_min_wh(a, axis, min_w)
end

-- box position phase

function align_w(a, i, axis, sw)
	local align = a[i+ALIGN+axis]
	if align == 'stretch' then
		return sw
	end
	return a[i+2+axis] -- min_w
end

function align_x(a, i, axis, sx, sw)
	local align = a[i+ALIGN+axis]
	if align == 'end' then
		local min_w = a[i+2+axis]
		return sx + sw - min_w
	elseif align == ALIGN_CENTER then
		local min_w = a[i+2+axis]
		return sx + round((sw - min_w) / 2)
	else
		return sx
	end
end

-- outer-box (ct_x, ct_w) -> inner-box (x, w).
function inner_x(a, i, axis, ct_x)
	return ct_x + a[i+MX1+axis] + a[i+PX1+axis]
end
function inner_w(a, i, axis, ct_w)
	return ct_w - spacings(a, i, axis)
end

ui.align_x = align_x
ui.align_w = align_w
ui.inner_x = inner_x
ui.inner_w = inner_w

-- calculate a[i+0]=x, a[i+2]=w (for axis=0) or a[i+1]=y, a[i+3]=h (for axis=1).
-- the resulting box at a[i+0..3] is the inner box which excludes margins and paddings.
-- NOTE: scrolling and popup positioning is done in the translation phase.
function box_position(a, i, axis, sx, sw)
	a[i+0+axis] = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	a[i+2+axis] = inner_w(a, i, axis, align_w(a, i, axis, sw))
end

-- box translate phase

local function box_translate(a, i, dx, dy)
	a[i+0] = a[i+0] + dx
	a[i+1] = a[i+1] + dy
end

-- box hit phase

function hit_box(a, i)
	local px1 = a[i+PX1+0]
	local py1 = a[i+PX1+1]
	local px2 = a[i+PX2+0]
	local py2 = a[i+PX2+1]
	local x = a[i+0] - px1
	local y = a[i+1] - py1
	local w = a[i+2] + px1 + px2
	local h = a[i+3] + py1 + py2
	return hit_rect(x, y, w, h)
end
ui.hit_box = hit_box

ui.box_widget = function(cmd, t)
	local ID = t.ID
	function box_hit(a, i)
		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]
		local id = a[i+ID]
		if hit_rect(x, y, w, h) then
			hover(id)
			return true
		end
	end
	return ui.widget(cmd, {
		measure   = after(before(box_measure   , t.before_measure  ), t.after_measure  ),
		position  = after(before(box_position  , t.before_position ), t.after_position ),
		translate = after(before(box_translate , t.before_translate), t.after_translate),
		hit       = ID ~= null and box_hit,
		is_flex_child = true,
		unpack(t)
	})
end

-- container-box widgets -----------------------------------------------------

function cmd_next_ext_i(a, i)
	local cmd = a[i-1]
	if cmd.is_ct then --container
		return i+a[i+NEXT_EXT_I]
	end
	return cmd_next_i(a, i)
end

-- NOTE: `ct` is short for container, which must end with ui.end().
function ui.cmd_box_ct(cmd, fr, align, valign, min_w, min_h, ...)
	--begin_scope()
	local i = ui.cmd_box(cmd, fr, align, valign, min_w, min_h,
		0, --next_ext_i
		...
	)
	add(ct_stack, i)
	return i
end

function ui.box_ct_widget(cmd, t)
	return ui.box_widget(cmd, t, true)
end

ui.widget('end', {

	create = function(_, cmd)
		cmd = ui.cmds[cmd]
		--end_scope()
		local i = assert(del(ct_stack), 'end command outside container')
		if cmd and a[i-1] ~= cmd then
			assertf(false, 'closing %s instead of %s', cmd.name, C(a, i))
		end
		local end_i = ui.cmd('end', i)
		pr('end', end_i, i, a[i-1].name, #ct_stack)
		a[end_i+0] = a[end_i+0] - end_i -- make relative
		local next_i = cmd_next_i(a, end_i)
		a[i+NEXT_EXT_I] = next_i-i -- next_i but relative to the ct cmd at i
		if a[i-1] == 'popup' then --TOOD: make this non-specific
			end_layer()
		end
	end,

	measure = function(a, _, axis)
		local i = assert(del(ct_stack), 'end command outside a container')
		local cmd = a[i-1]
		pr('ME', i, cmd.name)
		local measure_end_f = cmd.measure_end
		if measure_end_f then
			measure_end_f(a, i, axis)
		else
			local main_axis = is_main_axis(cmd, axis)
			local own_min_w = a[i+0+axis]
			local min_w     = a[i+2+axis]
			if main_axis then
				min_w = max(0, min_w - a[i+FLEX_GAP]) --remove last element's gap
			end
			min_w = max(min_w, own_min_w)
			a[i+2+axis] = min_w
			add_ct_min_wh(a, axis, min_w)
		end
	end,

	draw = function(a, end_i)
		local i = end_i + a[end_i]
		local draw_end_f = draw_end[a[i-1]]
		if draw_end_f then
			draw_end_f(a, i)
		end
	end,

})
ui.end_cmd = ui['end']

-- position phase utils

local function position_children_stacked(a, ct_i, axis, sx, sw)

	local i = cmd_next_i(a, ct_i)
	while a[i-1] ~= 'end' do

		local cmd = a[i-1]
		local position_f = cmd.position
		if position_f then
			-- position item's children recursively.
			position_f(a, i, axis, sx, sw)
		end

		i = cmd_next_ext_i(a, i)
	end
end

-- translate phase utils

local function translate_children(a, i, dx, dy)
	local ct_i = i
	i = cmd_next_i(a, i)
	while a[i-1] ~= 'end' do
		local cmd = a[i-1]
		local next_ext_i = cmd_next_ext_i(a, i)
		local translate_f = translate[cmd]
		if translate_f then
			translate_f(a, i, dx, dy, ct_i)
		end
		i = next_ext_i
	end
end

local function translate_ct(a, i, dx, dy)
	a[i+0] = a[i+0] + dx
	a[i+1] = a[i+1] + dy
	translate_children(a, i, dx, dy)
end

-- hit phase utils

local function hit_children(a, i, recs)
	-- hit direct children in reverse paint order.
	local ct_i = i
	local next_ext_i = cmd_next_ext_i(a, i)
	local end_i = cmd_prev_i(a, next_ext_i)
	i = cmd_prev_i(a, end_i)
	while i > ct_i do
		if a[i-1] == 'end' then
			i = i+a[i+0] -- start_i
		end
		local hit_f = hittest[a[i-1]]
		if hit_f and (a.nohit_set and not a.nohit_set[i]) and hit_f(a, i, recs) then
			return true
		end
		i = cmd_prev_i(a, i)
	end
end

-- flex ----------------------------------------------------------------------

local FLEX_GAP = S+0

local function is_main_axis(cmd, axis)
	return (
		(cmd == 'v' and 1 or 2) == axis or
		(cmd == 'h' and 0 or 2) == axis
	)
end

local function position_flex(a, i, axis, sx, sw)

	sx = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	sw = inner_w(a, i, axis, align_w(a, i, axis, sw))

	a[i+0+axis] = sx
	a[i+2+axis] = sw

	local ct_i = i
	if is_main_axis(a[i-1], axis) then

		local i = ct_i

		local next_i = cmd_next_i(a, i)
		local gap    = a[i+FLEX_GAP]

		-- compute total gap and total fr.
		local total_fr = 0
		local gap_w = 0
		local n = 0
		i = next_i
		while a[i-1] ~= 'end' do
			if is_flex_child[a[i-1]] then
				total_fr = total_fr + a[i+FR]
				n = n + 1
			end
			i = cmd_next_ext_i(a, i)
		end
		gap_w = max(0, (n - 1) * gap)

		if total_fr == 0 then
			total_fr	= 1
		end

		local total_w = sw - gap_w

		-- compute total overflow width and total free width.
		local total_overflow_w = 0
		local total_free_w     = 0
		i = next_i
		while a[i-1] ~= 'end' do
			if is_flex_child[a[i-1]] then

				local min_w = a[i+2+axis]
				local fr    = a[i+FR]

				local flex_w = total_w * fr / total_fr
				local overflow_w = max(0, min_w - flex_w)
				local free_w = max(0, flex_w - min_w)
				total_overflow_w = total_overflow_w + overflow_w
				total_free_w     = total_free_w     + free_w

			end
			i = cmd_next_ext_i(a, i)
		end

		-- distribute the overflow to children which have free space to
		-- take it. each child shrinks to take in the percent of the overflow
		-- equal to the child's percent of free space.
		i = next_i
		local ct_sx = sx
		local ct_sw = sw
		while a[i-1] ~= 'end' do
			if is_flex_child[a[i-1]] then

				local min_w = a[i+2+axis]
				local fr    = a[i+FR]

				-- compute item's stretched width.
				local flex_w = total_w * fr / total_fr
				local sw
				if min_w > flex_w then -- overflow
					sw = min_w
				else
					local free_w = flex_w - min_w
					local free_p = free_w / total_free_w
					local shrink_w = total_overflow_w * free_p
					if shrink_w ~= shrink_w then -- total_free_w == 0
						shrink_w = 0
					end
					sw = floor(flex_w - shrink_w)
				end

				-- TODO: check if this is the last element and if it is,
				-- set `sw = total_w - sx` so that it eats up all rounding errors.

				-- position item's children recursively.
				local position_f = a[i-1].position
				position_f(a, i, axis, sx, sw)

				sx = sx + sw + gap

			else

				local position_f = a[i-1].position
				if position_f then
					position_f(a, i, axis, ct_sx, ct_sw)
				end
			end

			i = cmd_next_ext_i(a, i)
		end

	else

		position_children_stacked(a, i, axis, sx, sw)

	end

end

local function hit_flex(a, i, recs)
	if hit_children(a, i, recs) then
		return true
	end
	if hit_box(a, i) then
		hit_template(a, i)
	end
end

ui.widget('hv', {

	create = function(cmd, fr, gap, align, valign, min_w, min_h)
		local cmd = assert(hv == 'h' or hv == 'v')
		return ui.cmd_box_ct(cmd, fr, align, valign, min_w, min_h,
			gap or 0
		)
	end,

	measure = ct_stack_push,

	position = position_flex,

	is_flex_child = true,

	translate = translate_ct,

	hittest = hit_flex,

})
ui.h = function(...) return ui.hv('h', ...) end
ui.v = function(...) return ui.hv('v', ...) end
ui.end_h = function() ui.end_cmd('h') end
ui.end_v = function() ui.end_cmd('v') end

-- stack ---------------------------------------------------------------------

local STACK_ID = S+0

ui.widget('stack', {

	is_ct = true,
	is_flex_child = true,

	create = function(_, id, fr, align, valign, min_w, min_h)
		return ui.cmd_box_ct('stack', fr, align, valign, min_w, min_h,
			id or '')
	end,

	measure = ct_stack_push,

	position = function(a, i, axis, sx, sw)
		local x = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
		local w = inner_w(a, i, axis, align_w(a, i, axis, sw))
		a[i+0+axis] = x
		a[i+2+axis] = w
		position_children_stacked(a, i, axis, x, w)
	end,

	translate = translate_ct,

	hittest = function(a, i, recs)
		if hit_children(a, i, recs) then
			hover(a[i+STACK_ID])
			return true
		end
		if hit_box(a, i) then
			hover(a[i+STACK_ID])
			hit_template(a, i)
		end
	end,

})

--[==[

-- scrollbox -----------------------------------------------------------------

local SB_OVERFLOW = S+0 -- overflow x,y
local SB_CW       = S+2 -- content w,h
local SB_ID       = S+4
local SB_SX       = S+5 -- scroll x,y
local SB_STATE    = S+7

local SB_OVERFLOW_AUTO     = 0
local SB_OVERFLOW_HIDE     = 1
local SB_OVERFLOW_SCROLL   = 2
local SB_OVERFLOW_CONTAIN  = 3 -- expand to fit content, like a stack.
local SB_OVERFLOW_INFINITE = 4 -- special mode for the infinite calendar.

function parse_sb_overflow(s)
	if s == null   || s == 'auto'    ) return SB_OVERFLOW_AUTO
	if s === false || s == 'hide'    ) return SB_OVERFLOW_HIDE
	if s === true  || s == 'scroll'  ) return SB_OVERFLOW_SCROLL
	if                s == 'contain' ) return SB_OVERFLOW_CONTAIN
	if                s == 'infinite') return SB_OVERFLOW_INFINITE
	assert(false, 'invalid overflow ', s)
end

ui.scrollbox = function(id, fr, overflow_x, overflow_y, align, valign, min_w, min_h, sx, sy)

	overflow_x = parse_sb_overflow(overflow_x)
	overflow_y = parse_sb_overflow(overflow_y)

	assert(id, 'id required for scrollbox')

	keepalive(id)
	local ss = ui.state(id)
	sx ??= ss.get('scroll_x') ?? 0
	sy ??= ss.get('scroll_y') ?? 0

	local i = ui.cmd_box_ct(CMD_SCROLLBOX, fr, align, valign, min_w, min_h,
		overflow_x,
		overflow_y,
		0, 0, -- content w, h
		id,
		sx, -- scroll x
		sy, -- scroll y
		0, -- state
	)
	if sx) ss.set('scroll_x', sx)
	if sy) ss.set('scroll_y', sy)

	return i
end
ui.sb = ui.scrollbox

ui.scroll_xy = function(a, i, axis)
	return a[i+SB_SX+axis]
end

ui.end_scrollbox = function()  ui.end(CMD_SCROLLBOX) end
ui.end_sb = ui.end_scrollbox

measure[CMD_SCROLLBOX] = ct_stack_push

measure_end[CMD_SCROLLBOX] = function(a, i, axis)
	local own_min_w = a[i+0+axis]
	local co_min_w  = a[i+2+axis] -- content min_w
	local overflow = a[i+SB_OVERFLOW+axis]
	local contain = overflow == SB_OVERFLOW_CONTAIN
	local sb_min_w = max(contain ? co_min_w : 0, own_min_w) -- scrollbox min_w
	a[i+SB_CW+axis] = co_min_w
	a[i+2+axis] = sb_min_w
	add_ct_min_wh(a, axis, sb_min_w)
end

-- NOTE: scrolling is done later in the translation phase.
position[CMD_SCROLLBOX] = function(a, i, axis, sx, sw)
	local x = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	local w = inner_w(a, i, axis, align_w(a, i, axis, sw))
	a[i+0+axis] = x
	a[i+2+axis] = w
	local content_w = a[i+SB_CW+axis]
	local overflow = a[i+SB_OVERFLOW+axis]
	position_children_stacked(a, i, axis, x, max(content_w, w))
end
is_flex_child[CMD_SCROLLBOX] = true

-- box scroll-to-view box. from box2d.lua.
function scroll_to_view_rect(x, y, w, h, pw, ph, sx, sy)
	local min_sx = -x
	local min_sy = -y
	local max_sx = -(x + w - pw)
	local max_sy = -(y + h - ph)
	return [
		-clamp(-sx, min_sx, max_sx),
		-clamp(-sy, min_sy, max_sy)
	]
end

translate[CMD_SCROLLBOX] = function(a, i, dx, dy)

	local x  = a[i+0] + dx
	local y  = a[i+1] + dy
	local w  = a[i+2]
	local h  = a[i+3]
	local cw = a[i+SB_CW+0]
	local ch = a[i+SB_CW+1]
	local sx = a[i+SB_SX+0]
	local sy = a[i+SB_SX+1]

	local infinite_x = a[i+SB_OVERFLOW+0] == SB_OVERFLOW_INFINITE
	local infinite_y = a[i+SB_OVERFLOW+1] == SB_OVERFLOW_INFINITE

	if infinite_x)
		cw = w * 4
		a[i+SB_CW+0] = cw
	end
	if infinite_y)
		ch = h * 4
		a[i+SB_CW+1] = ch
	end

	a[i+0] = x
	a[i+1] = y

	if !infinite_x) sx = max(0, min(sx, cw - w))
	if !infinite_y) sy = max(0, min(sy, ch - h))

	local psx = sx / (cw - w)
	local psy = sy / (ch - h)

	local id = a[i+SB_ID]
	if id)
		local hit_state = 0
		for (local axis = 0; axis < 2; axis++)

			local [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis)
			if !visible)
				continue

			-- scroll to view an inner box
			local box = ui.state(id, 'scroll_to_view')
			if box)
				local [bx, by, bw, bh] = box
				;[sx, sy] = scroll_to_view_rect(bx, by, bw, bh, w, h, sx, sy)
				a[i+SB_SX+0] = sx
				a[i+SB_SX+1] = sy
				local s = ui.state(id)
				s.set('scroll_x', sx)
				s.set('scroll_y', sy)
				s.delete('scroll_to_view')
			end

			-- wheel scrolling
			if axis && ui.wheel_dy && hit(id))
				local sy0 = ui.state(id, 'scroll_y')
				sy = sy - ui.wheel_dy
				if !infinite_y)
					sy = clamp(sy, 0, ch - h)
				ui.state(id).set('scroll_y', sy)
				a[i+SB_SX+1] = sy
			end

			-- drag-scrolling
			local sbar_id = id+'.scrollbar'+axis
			local cs = captured(sbar_id)
			local hs
			if cs)
				if !axis)
					local psx0 = cs.get('psx0')
					local dpsx = (ui.mx - ui.mx0) / (w - tw)
					sx = round((psx0 + dpsx) * (cw - w))
					if !infinite_x)
						sx = clamp(sx, 0, cw - w)
					ui.state(id).set('scroll_x', sx)
					a[i+SB_SX+0] = sx
				end else
					local psy0 = cs.get('psy0')
					local dpsy = (ui.my - ui.my0) / (h - th)
					sy = round((psy0 + dpsy) * (ch - h))
					if !infinite_y)
						sy = clamp(sy, 0, ch - h)
					ui.state(id).set('scroll_y', sy)
					a[i+SB_SX+1] = sy
				end
			end else
				hs = hit(sbar_id)
				if !hs)
					continue
				local cs = ui.capture(sbar_id)
				if cs)
					if !axis)
						cs.set('psx0', psx)
					else
						cs.set('psy0', psy)
			end

			-- bits 0..1 = horiz state; bits 2..3 = vert. state.
			hit_state |= (cs ? 2 : hs ? 1 : 0) << (2 * axis)
		end
		a[i+SB_STATE] = hit_state
	end

	translate_children(a, i, dx - sx, dy - sy)

end

-- can be used inside the translate phase of a widget to re-scroll a scrollbox
-- that might have already been scrolled.
ui.force_scroll = function(a, i, sx, sy)

	assert(a[i-1] == CMD_SCROLLBOX)

	local w   = a[i+2]
	local h   = a[i+3]
	local cw  = a[i+SB_CW+0]
	local ch  = a[i+SB_CW+1]
	local sx0 = a[i+SB_SX+0]
	local sy0 = a[i+SB_SX+1]

	sx = max(0, min(sx, cw - w))
	sy = max(0, min(sy, ch - h))

	a[i+SB_SX+0] = sx
	a[i+SB_SX+1] = sy

	-- make it persistent
	local id = a[i+SB_ID]
	if id)
		local s = ui.state(id)
		s.set('scroll_x', sx)
		s.set('scroll_y', sy)
	end

	translate_children(a, i, sx0-sx, sy0-sy)
end

ui.scroll_to_view = function(id, x, y, w, h)
	ui.state(id).set('scroll_to_view', [x, y, w, h])
end

draw[CMD_SCROLLBOX] = function(a, i)

	local x = a[i+0]
	local y = a[i+1]
	local w = a[i+2]
	local h = a[i+3]

	cx.save()
	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.clip()
end

ui.scrollbar_thickness = 6
ui.scrollbar_thickness_active = 12

local scrollbar_rect;
local r = [false, 0, 0, 0, 0]
scrollbar_rect = function(a, i, axis, state)
	local x  = a[i+0]
	local y  = a[i+1]
	local w  = a[i+2]
	local h  = a[i+3]
	local cw = a[i+SB_CW+0]
	local ch = a[i+SB_CW+1]
	local sx = a[i+SB_SX+0]
	local sy = a[i+SB_SX+1]
	local overflow_x = a[i+SB_OVERFLOW+0]
	local overflow_y = a[i+SB_OVERFLOW+1]
	if overflow_x == SB_OVERFLOW_INFINITE) sx = (cw - w) / 2
	if overflow_y == SB_OVERFLOW_INFINITE) sy = (ch - h) / 2
	sx = max(0, min(sx, cw - w))
	sy = max(0, min(sy, ch - h))
	local psx = sx / (cw - w)
	local psy = sy / (ch - h)
	local pw = w / cw
	local ph = h / ch
	local thickness = ui.scrollbar_thickness
	local thickness_active = state ? ui.scrollbar_thickness_active : thickness
	local visible, tx, ty, tw, th
	local h_visible = overflow_x ~= SB_OVERFLOW_HIDE && pw < 1
	local v_visible = overflow_y ~= SB_OVERFLOW_HIDE && ph < 1
	local both_visible = h_visible && v_visible && 1 || 0
	local bar_min_len = round(2 * ui.font_size_normal)
	if !axis)
		visible = h_visible
		if visible)
			local bw = w - both_visible * thickness
			tw = max(min(bar_min_len, bw), pw * bw)
			th = thickness_active
			tx = psx * (bw - tw)
			ty = h - th
		end
	end else
		visible = v_visible
		if visible)
			local bh = h - both_visible * thickness
			th = max(min(bar_min_len, bh), ph * bh)
			tw = thickness_active
			ty = psy * (bh - th)
			tx = w - tw
		end
	end
	r[0] = visible
	r[1] = x + tx
	r[2] = y + ty
	r[3] = tw
	r[4] = th
	return r
end
end

draw_end[CMD_SCROLLBOX] = function(a, i)

	cx.restore()

	for (local axis = 0; axis < 2; axis++)

		local state = (a[i+SB_STATE] >> (2 * axis)) & 3
		state = state == 2 && 'active' || state && 'hover' || null

		local [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis, state)

		if !visible)
			continue

		cx.beginPath()
		cx.rect(tx, ty, tw, th)
		cx.fillStyle = bg_color('scrollbar', state)
		cx.fill()

	end
end

hittest[CMD_SCROLLBOX] = function(a, i, recs)
	local id = a[i+SB_ID]

	-- fast-test the outer box since we're clipping the contents.
	if !hit_box(a, i))
		return

	hover(id)

	hit_template(a, i)

	-- test the scrollbars
	for (local axis = 0; axis < 2; axis++)
		local [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis, 'hover')
		if !visible)
			continue
		if !hit_rect(tx, ty, tw, th))
			continue
		hover(id+'.scrollbar'+axis)
		return true
	end

	-- test the children
	hit_children(a, i, recs)

	return true
end

-- popup ---------------------------------------------------------------------

local POPUP_SIDE_CENTER       = 0 -- only POPUP_SIDE_INNER_CENTER is valid!
local POPUP_SIDE_LR           = 2
local POPUP_SIDE_TB           = 4
local POPUP_SIDE_INNER        = 8
local POPUP_SIDE_LEFT         = POPUP_SIDE_LR + 0
local POPUP_SIDE_RIGHT        = POPUP_SIDE_LR + 1
local POPUP_SIDE_TOP          = POPUP_SIDE_TB + 0
local POPUP_SIDE_BOTTOM       = POPUP_SIDE_TB + 1
local POPUP_SIDE_INNER_CENTER = POPUP_SIDE_INNER + POPUP_SIDE_CENTER
local POPUP_SIDE_INNER_LEFT   = POPUP_SIDE_INNER + POPUP_SIDE_LEFT
local POPUP_SIDE_INNER_RIGHT  = POPUP_SIDE_INNER + POPUP_SIDE_RIGHT
local POPUP_SIDE_INNER_TOP    = POPUP_SIDE_INNER + POPUP_SIDE_TOP
local POPUP_SIDE_INNER_BOTTOM = POPUP_SIDE_INNER + POPUP_SIDE_BOTTOM

local POPUP_ALIGN_CENTER  = 0
local POPUP_ALIGN_START   = 1
local POPUP_ALIGN_END     = 2
local POPUP_ALIGN_STRETCH = 3

function popup_parse_side(s)
	if s == '['           ) return POPUP_SIDE_LEFT
	if s == ']'           ) return POPUP_SIDE_RIGHT
	if s == 'l'           ) return POPUP_SIDE_LEFT
	if s == 'r'           ) return POPUP_SIDE_RIGHT
	if s == 't'           ) return POPUP_SIDE_TOP
	if s == 'b'           ) return POPUP_SIDE_BOTTOM
	if s == 'ic'          ) return POPUP_SIDE_INNER_CENTER
	if s == 'il'          ) return POPUP_SIDE_INNER_LEFT
	if s == 'ir'          ) return POPUP_SIDE_INNER_RIGHT
	if s == 'it'          ) return POPUP_SIDE_INNER_TOP
	if s == 'ib'          ) return POPUP_SIDE_INNER_BOTTOM
	if s == 'left'        ) return POPUP_SIDE_LEFT
	if s == 'right'       ) return POPUP_SIDE_RIGHT
	if s == 'top'         ) return POPUP_SIDE_TOP
	if s == 'bottom'      ) return POPUP_SIDE_BOTTOM
	if s == 'inner-center') return POPUP_SIDE_INNER_CENTER
	if s == 'inner-left'  ) return POPUP_SIDE_INNER_LEFT
	if s == 'inner-right' ) return POPUP_SIDE_INNER_RIGHT
	if s == 'inner-top'   ) return POPUP_SIDE_INNER_TOP
	if s == 'inner-bottom') return POPUP_SIDE_INNER_BOTTOM
	assert(false, 'invalid popup side ', s)
end

function popup_parse_align(s)
	if s == 'c'      ) return POPUP_ALIGN_CENTER
	if s == '['      ) return POPUP_ALIGN_START
	if s == ']'      ) return POPUP_ALIGN_END
	if s == '[]'     ) return POPUP_ALIGN_STRETCH
	if s == 's'      ) return POPUP_ALIGN_STRETCH
	if s == 'center' ) return POPUP_ALIGN_CENTER
	if s == 'start'  ) return POPUP_ALIGN_START
	if s == 'end'    ) return POPUP_ALIGN_END
	if s == 'stretch') return POPUP_ALIGN_STRETCH
	assert(false, 'invalid align ', s)
end

local POPUP_FIT_CHANGE_SIDE = 1
local POPUP_FIT_CONSTRAIN   = 2

function popup_parse_flags(s)
	return (
		(s.includes('change_side') ? POPUP_FIT_CHANGE_SIDE : 0) |
		(s.includes('constrain'  ) ? POPUP_FIT_CONSTRAIN   : 0)
	)
end

local POPUP_ID        = FR      -- because fr is not used
local POPUP_SIDE      = ALIGN   -- because align is not used
local POPUP_ALIGN     = ALIGN+1 -- because valign is not used
local POPUP_LAYER_I   = S+0
local POPUP_TARGET_I  = S+1
local POPUP_FLAGS     = S+2
local POPUP_SIDE_REAL = S+3

local CMD_POPUP = cmd_ct('popup')

ui.popup = function(id, layer, target, side, align, min_w, min_h, flags, z_index)
	layer = ui_layer(layer)
	local target_i = target == 'screen' ? 0
		: !target || target == 'container' ? ui.ct_i()
		: assert(num(target), 'invalid target ', target)
	side  = popup_parse_side  (side  ?? 't')
	align = popup_parse_align (align ?? 'c')
	flags = popup_parse_flags (flags ?? '')

	local i = ui.cmd_box_ct(CMD_POPUP,
		null, -- fr -> id
		null, -- align -> side
		null, -- valign -> align
		min_w, min_h,
		-- S+0
		layer.i, target_i, flags,
		side, -- side_real
	)
	if target_i)
		a[i+POPUP_TARGET_I] -= i -- make relative
	a[i+POPUP_ID   ] = id
	a[i+POPUP_SIDE ] = side
	a[i+POPUP_ALIGN] = align
	if begin_layer(layer, i, z_index))
		force_scope_vars()
	return i
end

ui.end_popup = function()  ui.end(CMD_POPUP) end

function set_z_index(a, i, z_index)
	assert(a[i-1] == CMD_POPUP)
	i = cmd_next_i(a, i)
	assert(a[i-1] == CMD_SET_LAYER)
	a[i+SET_LAYER_Z_INDEX] = z_index
end
ui.set_z_index = set_z_index

measure[CMD_POPUP] = ct_stack_push

measure_end[CMD_POPUP] = function(a, i, axis)
	a[i+2+axis] = max(a[i+2+axis], a[i+0+axis]) -- apply own min_w|h
	-- popups don't affect their target's layout so no add_ct_min_wh() call.
end

-- NOTE: popup positioning is done later in the translation phase.
-- NOTE: sw is always 0 because popups have fr=0, so we don't use it.
position[CMD_POPUP] = function(a, i, axis, sx, sw)

	-- stretched popups stretch to the dimensions of their target.
	local target_i = a[i+POPUP_TARGET_I]
	local side     = a[i+POPUP_SIDE]
	local align    = a[i+POPUP_ALIGN]
	if side && align == POPUP_ALIGN_STRETCH)
		if !target_i)
			a[i+2+axis] = (axis ? screen_h : screen_w) - 2*screen_margin
		end else
			-- TODO: align border rects here!
			target_i += i -- make absolute
			local ct_w = a[target_i+2+axis]
			a[i+2+axis] = max(a[i+2+axis], ct_w)
		end
	end

	local w = inner_w(a, i, axis, a[i+2+axis])
	a[i+2+axis] = w
	position_children_stacked(a, i, axis, 0, w)
end


local tx1, ty1, tx2, ty2
local screen_margin = 10

-- a popup's target rect is the target's border rect.
function get_popup_target_rect(a, i)

	local ct_i = a[i+POPUP_TARGET_I]

	if !ct_i)

		local d = screen_margin
		tx1 = d
		ty1 = d
		tx2 = screen_w - d
		ty2 = screen_h - d

	end else

		ct_i += i -- make absolute

		local px1 = a[ct_i+PX1+0]
		local py1 = a[ct_i+PX1+1]
		local px2 = a[ct_i+PX2+0]
		local py2 = a[ct_i+PX2+1]

		tx1 = a[ct_i+0] - px1
		ty1 = a[ct_i+1] - py1
		tx2 = a[ct_i+2] + tx1 + px1 + px2
		ty2 = a[ct_i+3] + ty1 + py1 + py2

	end

end

local x, y
function position_popup(w, h, side, align)

	local tw = tx2 - tx1
	local th = ty2 - ty1

	if side == POPUP_SIDE_RIGHT)
		x = tx2
		y = ty1
	end else if side == POPUP_SIDE_LEFT)
		x = tx1 - w
		y = ty1
	end else if side == POPUP_SIDE_TOP)
		x = tx1
		y = ty1 - h
	end else if side == POPUP_SIDE_BOTTOM)
		x = tx1
		y = ty2
	end else if side == POPUP_SIDE_INNER_RIGHT)
		x = tx2 - w
		y = ty1
	end else if side == POPUP_SIDE_INNER_LEFT)
		x = tx1
		y = ty1
	end else if side == POPUP_SIDE_INNER_TOP)
		x = tx1
		y = ty1
	end else if side == POPUP_SIDE_INNER_BOTTOM)
		x = tx1
		y = ty2 - h
	end else if side == POPUP_SIDE_INNER_CENTER)
		x = tx1 + round((tw - w) / 2)
		y = ty1 + round((th - h) / 2)
	end else
		assert(false)
	end

	local sdx = side & POPUP_SIDE_LR
	local sdy = side & POPUP_SIDE_TB

	if align == POPUP_ALIGN_CENTER && sdy)
		x += round((tw - w) / 2)
	else if align == POPUP_ALIGN_CENTER && sdx)
		y += round((th - h) / 2)
	else if align == POPUP_ALIGN_END && sdy)
		x += tw - w
	else if align == POPUP_ALIGN_END && sdx)
		y += th - h

end

translate[CMD_POPUP] = function(a, i)

	local bw = screen_w
	local bh = screen_h

	get_popup_target_rect(a, i)

	local w     = a[i+2+0]
	local h     = a[i+2+1]
	local side  = a[i+POPUP_SIDE]
	local align = a[i+POPUP_ALIGN]
	local flags = a[i+POPUP_FLAGS]

	position_popup(w, h, side, align)

	if flags & POPUP_FIT_CHANGE_SIDE)

		-- if popup doesn't fit the screen, first try to change its side
		-- or alignment and relayout, and if that doesn't work, its offset.

		local d = screen_margin
		local out_x1 = x < d
		local out_y1 = y < d
		local out_x2 = x + w > (bw - d)
		local out_y2 = y + h > (bh - d)

		local side0 = side
		if side == POPUP_SIDE_BOTTOM && out_y2)
			side = POPUP_SIDE_TOP
		 else if side == POPUP_SIDE_TOP && out_y1)
			side = POPUP_SIDE_BOTTOM
		 else if side == POPUP_SIDE_RIGHT && out_x2)
			side = POPUP_SIDE_LEFT
		 else if side == POPUP_SIDE_LEFT && out_x1)
			side = POPUP_SIDE_RIGHT

		if side ~= side0)
			position_popup(w, h, side, align)
			a[i+POPUP_SIDE_REAL] = side
		end

	end

	-- if nothing else works, adjust the offset to fit the screen.
	-- TODO: actually we should adjust the offset to fit the current viewport
	-- computed from all parent scrollboxes.
	if flags & POPUP_FIT_CONSTRAIN)
		local d = screen_margin
		local ox1 = min(0, x - d)
		local oy1 = min(0, y - d)
		local ox2 = max(0, x + w - (bw - d))
		local oy2 = max(0, y + h - (bh - d))
		x -= ox1 ? ox1 : ox2
		y -= oy1 ? oy1 : oy2
	end

	-- TODO: constrain should include these too (see toolbox constrain not working)!
	x += a[i+MX1+0] + a[i+PX1+0]
	y += a[i+MX1+1] + a[i+PX1+1]

	a[i+0] = x
	a[i+1] = y
	a[i+2] = w
	a[i+3] = h

	translate_children(a, i, x, y)

end

local out = [0, 0, 0, 0]
ui.popup_target_rect = function(a, i)
	get_popup_target_rect(a, i)
	out[0] = tx1
	out[1] = ty1
	out[2] = tx2
	out[3] = ty2
	return out
end

end

draw[CMD_POPUP] = function(a, i)
	local popup_layer_i = a[i+POPUP_LAYER_I]
	if popup_layer_i ~= current_layer_i)
		return true -- not our layer, skip
end

hittest[CMD_POPUP] = function(a, i, recs)
	local popup_layer_i = a[i+POPUP_LAYER_I]
	local popup_layer = layer_arr[popup_layer_i]
	if popup_layer ~= current_layer)
		return -- not our layer, skip
	if hit_children(a, i, recs))
		hover(a[i+POPUP_ID])
		return true
	end
end

]==]

--demo -----------------------------------------------------------------------

ui.main = function()

end

--main -----------------------------------------------------------------------

tc_set_raw_mode()
assert(tc_get_raw_mode(), 'could not put terminal in raw mode')

wr'\27]11;?\7' --get terminal background color
wr'\27[?1000h' --enable mouse tracking
wr'\27[?1003h' --enable mouse move tracking
wr'\27[?1006h' --enable SGR mouse tracking
wr'\27[?25l' --hide cursor

screen_w, screen_h = tc_get_window_size()

--signals thread to capture Ctrl+C and terminal window resize events.
resume(thread(function()
	signal_block'SIGWINCH SIGINT'
	local sigf = signal_file('SIGWINCH SIGINT', true)
	while 1 do
		local si = sigf:read_signal()
		if si.signo == SIGWINCH then
			screen_w, screen_h = tc_get_window_size()
			redraw()
		elseif si.signo == SIGINT then
			stop()
			break
		end
	end
end))

--input thread
resume(thread(function()
	while 1 do
		read_input()
		redraw()
		key = nil
		scroll = nil
	end
end))

start() --start the epoll loop (stopped by ctrl+C or a call to stop()).

wr'\27[?1006l' --stop SGR mouse events
wr'\27[?1003l' --stop mouse move events
wr'\27[?1000l' --stop mouse events
wr'\27[?25h' --show cursor

tc_reset() --reset terminal
