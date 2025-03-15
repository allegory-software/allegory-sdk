--[[

	Immediate Mode Text User Interface library for Linux terminals.
	Written by Cosmin Apreutesei. Public Domain.

	TODO:
		- scrollbox
		- popup
		- box: sides, style, title, color
		- bg
		- shadow
		- split
		- text
			- word-wrapped
			- multi-line
			- editable
			- highlighted
		- list
		- tree
		- menu-bar
		- menu
		- tab-list
		- checkbox
		- checklist
		- radio-group
		- dropdown
		- button
		- slider
		- grid
		- chart
		- progress-bar
		- modal

]]

require'glue'
assert(Linux, 'not on Linux')
require'fs'
require'sock'
require'signal'
require'termios'
require'rect'

ui = {}

--print debugging via `tail -f imtui.log` ------------------------------------

local DEBUG = false
local imtui_log
local function warnn(s)
	imtui_log = imtui_log or open('imtui.log', 'w')
	s = s:gsub('\27', '\\ESC')
	imtui_log:write(s)
end
local function warnf(s, ...)
	warnn(s:format(...)..'\n')
end
local dbgf = DEBUG and warnf or noop

local pr = print_function(warnn, text)

-- encoding and writing terminal output --------------------------------------

local TERM = env'TERM'
local term_is_256_color =
	TERM == 'xterm-256color' or
	TERM == 'screen-256color'

local term_is_dark = true --assume dark if detection fails
local term_bg_changed = noop --defined below in the tui section

--buffered, async write to stdout
local wr, wr_flush; do
	local write, collect, reset = dynarray_pump()
	wr = write
	function wr_flush()
		local buf, len = collect()
		stdout:write(buf, len)
		reset()
	end
end

local function wr_err(s) --unbuffered async write to stderr
	return stderr:write(s)
end

local function wrf(s, ...)
	wr(s:format(...))
end

local function text(s)
	return tostring(s):gsub('\27', '\\ESC'):gsub('\n', '\r\n')
end

local function textf(s, ...)
	return text(s:format(...))
end

function logging:logtostderr(line)
	pr(line)
end

local term_bg
local wr_set_bg
if term_is_256_color then
	function wr_set_bg(color)
		if term_bg == color then return end
		--dbgf('bg', color)
		wrf('\27[48;5;%dm', color)
		term_bg = color
	end
else
	error'NYI'
	--'\27[%d%dm', bright and '10' or '4', color
end

local term_fg
local wr_set_fg
if term_is_256_color then
	function wr_set_fg(color)
		if term_fg == color then return end
		--dbgf('fg', color)
		wrf('\27[38;5;%dm', color)
		term_fg = color
	end
else
	error'NYI'
	--'\27[%d%dm', bright and '9' or '3', color
end

local function gotoxy(x, y)
	wrf('\27[%d;%dH', y+1, x+1)
end

local function term_reset_styles()
	wrf'\27[0m'
	term_bg = nil
	term_fg = nil
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
		return 7, L > .75 --white   97 107
	else
		return 0, L > .25 --black   30 40
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
		return floor(232 + L * 23)
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
	if DEBUG then dbgf(' rd %s %s', b[0], char(b[0])) end
	return b[0]
end

local function rd_to(c1, c2, err)
	c1 = byte(c1)
	c2 = byte(c2)
	for i = 0,127 do
		stdin:readn(b+i, 1)
		if b[i] == c1 or b[i] == c2 then
			if DEBUG then dbgf('  rd_to %s or %s: %d "%s" %s',
				char(c1), char(c2), i, str(b, i+1), err or '') end
			return str(b, i+1)
		end
	end
	assertf(false, '%s: "%s"', err or 'invalid sequence', text(s))
end

local function rd_wait(timeout)
	stdin:settimeout(timeout)
	local len, err = stdin:try_read(b, 1)
	stdin:settimeout(nil)
	if not len and err == 'timeout' then
		if DEBUG then dbgf(' %s', 'timeout') end
		return nil
	else
		assert(len == 1, 'eof')
	end
	if DEBUG then dbgf(' rd_wait %s %s', b[0], char(b[0])) end
	return b[0]
end

-- updating mouse, keyboard and screen state ---------------------------------

local capture_state = {}
function ui.captured(id)
	return id ~= '' and ui.captured_id == id and capture_state or nil
end

ui.capture = function(id)
	if id == '' then return end
	if ui.captured_id then
		return ui.captured_id == id and capture_state or nil
	end
	if not ui.click then return end
	local hs = ui.hovers(id)
	if not hs then return end
	ui.captured_id = id
	update(capture_state, hs)
	ui.mx0 = ui.mx
	ui.my0 = ui.my
	return capture_state
end

function ui.drag(id, axis)
	local move_x = not axis or axis == 'x' or axis == 'xy'
	local move_y = not axis or axis == 'y' or axis == 'xy'
	local cs = ui.captured(id)
	local state = nil
	local dx = 0
	local dy = 0
	if cs then
		if move_x then dx = ui.mx - ui.mx0 end
		if move_y then dy = ui.my - ui.my0 end
		state = ui.clickup and 'drop' or 'dragging'
		cs.drag_state = state
	else
		cs = ui.hit(id)
		if cs then
			if ui.click then
				cs = ui.capture(id)
				if cs then
					state = 'drag'
				end
			else
				state = 'hover'
			end
		end
	end
	return state, dx, dy, cs
end

ui.pressed = false
ui.term_focused = true --TODO: asume focused?

local function reset_input_state()
	if ui.clickup then
		ui.captured_id = nil
		capture_state = {}
	end
	ui.key = nil
	ui.focusing_id = nil
	ui.click = false
	ui.clickup = false
	ui.right_click = false
	ui.right_clickup = false
	ui.middle_click = false
	ui.middle_clickup = false
	ui.dblclick = false --TODO: detect with delay and suppress click
	ui.right_dblclick = false
	ui.middle_dblclick = false
	ui.wheel_dy = 0
	ui.term_focus_changed = false
end
reset_input_state()

local function rd_input() --read keyboard and mouse input in raw mode
	local c = rd()
	if c == 27 then --\033
		c = rd_wait(.01)
		if not c then
			ui.key = 'esc'
		elseif c == 91 then --[
			c = rd()
			if     c == 65 then
				ui.key = 'up'
			elseif c == 66 then
				ui.key = 'down'
			elseif c == 67 then
				ui.key = 'right'
			elseif c == 68 then
				ui.key = 'left'
			elseif c == 49 then
				c = rd()
				if     c == 49 then if rd() == 126 then ui.key = 'f1' end
				elseif c == 50 then if rd() == 126 then ui.key = 'f2' end
				elseif c == 51 then if rd() == 126 then ui.key = 'f3' end
				elseif c == 52 then if rd() == 126 then ui.key = 'f4' end
				elseif c == 53 then if rd() == 126 then ui.key = 'f5' end
				elseif c == 55 then if rd() == 126 then ui.key = 'f6' end
				elseif c == 56 then if rd() == 126 then ui.key = 'f7' end
				elseif c == 57 then if rd() == 126 then ui.key = 'f8' end
				elseif c == 126 then ui.key = 'home'
				end
			elseif c == 50 then
				c = rd()
				if     c == 48 then if rd() == 126 then ui.key = 'f9' end
				elseif c == 49 then if rd() == 126 then ui.key = 'f10' end
				elseif c == 51 then if rd() == 126 then ui.key = 'f11' end
				elseif c == 52 then if rd() == 126 then ui.key = 'f12' end
				elseif c == 126 then ui.key = 'insert'
				end
			elseif c == 51 then if rd() == 126 then ui.key = 'delete' end
			elseif c == 52 then if rd() == 126 then ui.key = 'end' end
			elseif c == 53 then if rd() == 126 then ui.key = 'pageup' end
			elseif c == 54 then if rd() == 126 then ui.key = 'pagedown' end
			elseif c == 60 then --<
				local s = rd_to('M', 'm')
				local b, smx, smy, st = s:match'^(%d+);(%d+);(%d+)([Mm])$'
				if not b then
					assertf(false, 'invalid mouse event sequence: "%s"', text(s))
				end
				ui.mx = num(smx)
				ui.my = num(smy)
				if b == '0' then --left button
					if st == 'M' then
						ui.click = true
						ui.pressed = true
					elseif st == 'm' then
						ui.clickup = true
						ui.pressed = false
					end
				elseif b == '2' then --right button
					if st == 'M' then
						ui.right_click = true
						ui.right_pressed = true
					elseif st == 'm' then
						ui.right_clickup = true
						ui.right_pressed = false
					end
				elseif b == '1' then --middle button
					if st == 'M' then
						ui.middle_click = true
						ui.middle_pressed = true
					elseif st == 'm' then
						ui.middle_clickup = true
						ui.middle_pressed = false
					end
				elseif b == '64' then
					ui.wheel_dy = -1
				elseif b == '65' then
					ui.wheel_dy = 1
				end
				if DEBUG then dbgf('mouse %d %d %s %s', mx, my, b, st) end
			elseif c == 73 then --I
				ui.term_focus_changed = true
				ui.term_focused = true
			elseif c == 79 then --O
				ui.term_focus_changed = true
				ui.term_focused = false
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
		ui.key = 'backspace'
	elseif c >= 32 and c <= 126 then
		ui.key = char(c)
	elseif c == 13 then
		ui.key = 'enter'
	else
		ui.key = c
	end
	if DEBUG and ui.key then dbgf('ui.key %s', ui.key) end
end

-- screen cell double-buffer -------------------------------------------------

--screen clip rect and stack

local scr_x1, scr_y1, scr_x2, scr_y2 --current clip rect (x2,y2 is outside!)
local scr_clip_rect_stack = {} --{x1, y1, x2, y2; ...}

local function scr_clip(x, y, w, h)
	append(scr_clip_rect_stack, scr_x1, scr_y1, scr_x2, scr_y2)
	local x, y, w, h = rect_clip(x, y, w, h,
		scr_x1,
		scr_y1,
		scr_x2 - scr_x1,
		scr_y2 - scr_y1
	)
	scr_x1 = x
	scr_y1 = y
	scr_x2 = x+w
	scr_y2 = y+h
end

local function scr_clip_end()
	assert(#scr_clip_rect_stack >= 4)
	scr_y2 = pop(scr_clip_rect_stack)
	scr_x2 = pop(scr_clip_rect_stack)
	scr_y1 = pop(scr_clip_rect_stack)
	scr_x1 = pop(scr_clip_rect_stack)
end

local function scr_reset_clip_rect()
	while #scr_clip_rect_stack > 0 do
		pop(scr_clip_rect_stack)
	end
	scr_x1 = 0
	scr_y1 = 0
	scr_x2 = screen_w
	scr_y2 = screen_h
end

--screen cell buffers

local cell_ct = ctype[[
union {
	uint64_t data;
	struct {
		union {
			uint32_t codepoint;
			uint8_t  text[4];
		};
		uint8_t text_len;
		uint8_t fg_color;
		uint8_t bg_color;
		uint8_t flags;
	};
}
]]
assert(sizeof(cell_ct) == 8)
local cell_arr_ct = ctype('$[?]', cell_ct)

local scr1, scr2, scr2_dirty

screen_w = 0
screen_h = 0

local function scr_wr(x, y, s)
	if not (y >= scr_y1 and y < scr_y2) then return end
	local i1 = max( 1, scr_x1 - x + 1)
	local i2 = min(#s, scr_x2 - x)
	--TODO: split text by codepoints.
	--TODO: splitting on graphemes would be even better.
	--TODO: support 2-cell-wide graphemes.
	for si = i1, i2 do
		local i = y * screen_w + x + si - 1
		assert(i >= 0 and i < screen_w * screen_h)
		local cell = scr1[i]
		cell.codepoint = 0
		cell.text[0] = byte(s, si)
		cell.text_len = 1
	end
end

local function scr_wrc(x, y, c) --set single cell
	if x < scr_x1 or x >= scr_x2 then return end
	if y < scr_y1 or y >= scr_y2 then return end
	assert(#c <= 4)
	local i = y * screen_w + x
	assert(i >= 0 and i < screen_w * screen_h)
	local cell = scr1[i]
	cell.codepoint = 0
	copy(cell.text, c, #c)
	cell.text_len = #c
end

local function scr_each_cell(x, y, w, h, f, ...)
	local x, y, w, h = rect_clip(x, y, w, h,
		scr_x1,
		scr_y1,
		scr_x2 - scr_x1,
		scr_y2 - scr_y1
	)
	for y = y, y+h-1 do
		for x = x, x+w-1 do
			f(y * screen_w + x, ...)
		end
	end
end

local cell = cell_ct()

local function scr_copy_cell(i, scr, cell)
	assert(i >= 0 and i < screen_w * screen_h)
	scr[i] = cell
end
local function scr_fill(x, y, w, h, bg_color, fg_color, text, scr)
	assert(#text > 0 and #text <= 4)
	cell.data = 0
	cell.bg_color = bg_color
	cell.fg_color = fg_color
	copy(cell.text, text, #text)
	cell.text_len = #text
	scr_each_cell(x, y, w, h, scr_copy_cell, scr or scr1, cell)
end

local function scr_set_bg_color_cell(i, bg_color)
	assert(i >= 0 and i < screen_w * screen_h)
	scr1[i].bg_color = bg_color
end
local function scr_set_bg_color(bg_color, x, y, w, h)
	scr_each_cell(x, y, w, h, scr_set_bg_color_cell, bg_color)
end

local B_TL = '\u{250C}'  -- ┌
local B_TR = '\u{2510}'  -- ┐
local B_BL = '\u{2514}'  -- └
local B_BR = '\u{2518}'  -- ┘
local B_H  = '\u{2500}'  -- ─
local B_V  = '\u{2502}'  -- │

local function scr_draw_hline(x, y, w)
	for i=0,w-1 do
		scr_wrc(x+i, y, B_H)
	end
end

local function scr_draw_vline(x, y, h)
	for i=0,h-1 do
		scr_wrc(x, y+i, B_V)
	end
end

local function scr_draw_box(x, y, w, h)
	scr_wrc(x    , y    , B_TL)
	scr_wrc(x+w-1, y    , B_TR)
	scr_wrc(x    , y+h-1, B_BL)
	scr_wrc(x+w-1, y+h-1, B_BR)
	scr_draw_hline(x+1  , y    , w-2)
	scr_draw_hline(x+1  , y+h-1, w-2)
	scr_draw_vline(x    , y+1  , h-2)
	scr_draw_vline(x+w-1, y+1  , h-2)
end

local function scr_flush()
	for y = 0, screen_h-1 do
		local x1
		local x = 0
		while x < screen_w do
			local i = y * screen_w + x
			assert(i >= 0 and i < screen_w * screen_h)
			local cell1 = scr1[i]
			local cell2 = scr2[i]
			local diff = true --scr2_dirty or cell1.data ~= cell2.data
			if not x1 and diff then x1 = x end
			if x1 then
				local x2 = not diff and x or x == screen_w-1 and x+1 or nil
				if x2 then
					gotoxy(x1, y)
					for x = x1, x2-1 do
						local i = y * screen_w + x
						assert(i >= 0 and i < screen_w * screen_h)
						local cell1 = scr1[i]
						wr_set_bg(cell1.bg_color)
						wr_set_fg(cell1.fg_color)
						assert(cell1.text_len > 0)
						wr(cell1.text, cell1.text_len)
					end
					x1 = nil
				end
			end
			x = x + 1
		end
	end
	wr_flush()
	scr1, scr2 = scr2, scr1 --swap the screen buffers
	scr2_dirty = false
end

local function scr_resize()
	screen_w, screen_h = tc_get_window_size()
	scr1 = new(cell_arr_ct, screen_w * screen_h)
	scr2 = new(cell_arr_ct, screen_w * screen_h)
	scr2_dirty = true
end

-- imgui themes and colors ---------------------------------------------------

local themes = {}

local function theme_make(name, is_dark)
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

local theme --current theme, dynamic, part of command state, based on set_bg().
ui.app_theme = nil --app theme, set by the user.

local parse_state_combis = memoize(function(s)
	return cat(sort(collect(words(trim(s)))), ' ') --normalize state combinations
end)
local function parse_state(s)
	if not s then return 'normal' end
	if s == 'normal' then return 'normal' end
	if s == 'hover'  then return 'hover'  end
	if s == 'active' then return 'active' end
	return parse_state_combis(s)
end

--colors are specified by (theme, name, state) with 'normal' state as fallback.
local function def_color_func(k)
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
			local ansi_color = hsl_to_color(h, s, L)
			attr(states, state)[name] = {ansi_color, is_dark or L < .5}
		end
	end
	return def_color
end

local function lookup_color_func(k)
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

local function set_bg(color, state)
	assert(isstr(color))
	local c = ui.bg_color(color, state)
	local is_dark = c[2]
	theme = is_dark and themes.dark or themes.light
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
ui.bg_style('light', 'smoke' , 'normal' ,   0, 0.00, 1.00)
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
ui.bg_style('dark' , 'scrollbar', 'hover'  , 216, 0.28, 0.41, 0.8)
ui.bg_style('dark' , 'scrollbar', 'active' , 216, 0.28, 0.45, 0.8)

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

--[[ state maps --------------------------------------------------------------

Persistence between frames is kept in per-id state maps. Widgets need to
call keepalive(id) otherwise their state map is garbage-collected at the end
of the frame. Widgets can also register a `free` callback to be called if
the widget doesn't appear again on a future frame. State updates should be
done inside an update callback registered with keepalive() so that the widget
state can be updated in advance of the widget appearing in the frame in case
the widget state is queried from outside before the widget appears in the frame.
The update callback will be called once per frame, either due to a state access
or when the widget is created in the frame.

]]

local id_state_maps  = {} -- {id->map}
local id_current_set = {} -- {id->true}
local id_remove_set  = {} -- {id->true}

ui.id_state_maps = id_state_maps

function ui.keepalive(id, update_f)
	assert(id and id ~= '', 'id required')
	id_current_set[id] = true
	id_remove_set[id] = nil
	if update_f then
		ui.state(id).update = update_f
	end
end

ui.state = function(id)
	if id == '' then return end
	local m = attr(id_state_maps, id)
	if m.update then
		m.update(id, m)
		m.update = nil
	end
	return m
end

ui.state_init = function(id, k, v)
	local s = ui.state(id)
	if s[k] ~= nil then return end
	s[k] = v
end

local function id_state_gc()
	for id in pairs(id_remove_set) do
		local m = id_state_maps[id]
		if m then
			assert(ui.captured_id ~= id, 'id removed while captured')
			if m.free then
				m.free(m, id)
			end
			id_state_maps[id] = nil
		end
		id_remove_set[id] = nil
	end
	id_remove_set, id_current_set = id_current_set, id_remove_set
end

ui.on_free = function(id, free1)
	ui.state(id).free = after(s.free, free1)
end

-- command state -------------------------------------------------------------

local function reset_cmd_state()
	theme = themes[ui.app_theme or (term_is_dark and 'dark' or 'light')]
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
local cmd_next_ext_i --fwd. decl.

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

-- print recording
ui.disas = function(a)
	local i = 3
	local tabs = 0
	while i < #a do
		local cmd = a[i-1]
		local i1 = cmd_arg_end_i(a, i)
		local args = slice(a, i, i1)
		if cmd.is_end then
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
	add(recs, a)
	rec_i = #recs
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
		if index ~= nil then
			insert(layers, index, layer)
		end
		layer_map[name] = layer
		add(layer_arr, layer)
		layer.i = #layer_arr
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
ui.layer('base'   , 1)
ui.layer('window' , 2) -- modals
-- all these below must be temporary to work with modals!
ui.layer('overlay', 3) -- temporary overlays that must show behind the dragged object.
ui.layer('tooltip', 4)
ui.layer('open'   , 5) -- dropdowns, must cover tooltips
ui.layer('handle' , 6) -- dragged object

local layer_stack = {} -- {layer1_i, ...}
local current_layer    -- set while building
local current_layer_i  -- set while drawing

local function begin_layer(layer, ct_i, z_index)
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

local function end_layer()
	current_layer = del(layer_stack)
end

local function layer_stack_check()
	if #layer_stack > 0 then
		for _,layer in ipairs(layer_stack) do
			warnf('layer %s not closed', layer.name)
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

local function ct_stack_check(a)
	if #ct_stack > 0 then
		for _,i in ipairs(ct_stack) do
			warnf('%s not closed', a[i-1].name)
		end
		assert(false)
	end
end

-- measuring phase (per-axis) ------------------------------------------------

-- walk the element tree bottom-up and call the measure function for each
-- element that has it. uses ct_stack for recursion and containers'
-- measure_end callback to do the work.

local function measure_rec(a, axis)
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

local function position_rec(a, axis, ct_w)
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

local function translate_rec(a, x, y)
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

local function draw_cmd(a, i, recs)
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

local function draw_layer(layer_i, indexes, recs)
	local prev_layer_i = current_layer_i
	--[[global]] current_layer_i = layer_i
	for k = 1, #indexes, 3 do
		reset_cmd_state()
		local rec_i = indexes[k]
		local i     = indexes[k+1]
		local a = recs[rec_i]
		draw_cmd(a, i, recs)
	end
	current_layer_i = prev_layer_i
end

local function draw_layers(layers, recs)
	for _,layer in ipairs(layers) do
		draw_layer(layer.i, layer.indexes, recs)
	end
end

local function draw_frame(recs, layers)
	local theme_stack_length0 = #theme_stack
	add(theme_stack, theme)

	draw_layers(layers, recs)
	assert(current_layer_i == nil)

	theme = del(theme_stack)
	assertf(#theme_stack == theme_stack_length0, 'theme stack not empty: %d', #theme_stack)
end

-- hit-testing phase ---------------------------------------------------------

--local hit_state_map_freelist = map_freelist()
local hit_state_maps = {} -- {id->map}

ui._hit_state_maps = hit_state_maps

function ui.hovers(id, k)
	if id == '' then return end
	local m = hit_state_maps[id]
	return k and m and m[k] or m
end

function ui.hit(id, k)
	if ui.captured_id then --unavailable while captured
		return
	end
	return ui.hovers(id, k)
end

function ui.hit_match(prefix)
	for id in pairs(hit_state_maps) do
		if id:starts(prefix) then
			return id:sub(#prefix+1)
		end
	end
end

function ui.hover(id)
	if id == '' then return end
	return attr(hit_state_maps, id)
end

local function hit_layer(layer, recs)
	--[[global]] current_layer = layer
	--iterate layer's cointainers in reverse order.
	local indexes = layer.indexes
	for k = #indexes-2, 1, -3 do
		reset_cmd_state()
		local rec_i = indexes[k]
		local i     = indexes[k+1]
		local a = recs[rec_i]
		local hit_f = a[i-1].hittest
		if hit_f and not (a.nohit_set and a.nohit_set[i]) and hit_f(a, i, recs) then
			return true
		end
	end
end

local function hit_layers(layers, recs)
	--iterate layers in reverse order.
	for j = #layers, 1, -1 do
		local layer = layers[j]
		if hit_layer(layer, recs) then
			return true
		end
	end
end

local function hit_frame(recs, layers)

	hit_state_maps = {}

	if not ui.mx then return end

	hit_layers(layers, recs)
	current_layer = nil

end

--imgui loop -----------------------------------------------------------------

local want_relayout

ui.relayout = function()
	want_relayout = true
end

local function layout_rec(a, x, y, w, h)
	reset_cmd_state()

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

local function frame_end_check()
	ct_stack_check(a)
	layer_stack_check()
	--scope_stack_check()
	rec_stack_check()
end

ui.frame_changed = noop

ui.focusables = {}

local function redraw()

	--term_reset_styles()
	scr_reset_clip_rect()

	reset_cmd_state()
	local bg_color = ui.bg_color('bg'  )[1]
	local fg_color = ui.fg_color('text')[1]
	scr_fill(0, 0, screen_w, screen_h, bg_color, fg_color, ' ')

	local relayout_count = 0
	while 1 do

		want_relayout = false

		hit_frame(recs, layers)

		if ui.key == 'tab' then
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

		reset_cmd_state()

		begin_rec()
		ui.stack()
			local i = cmd_last_i(a)
			begin_layer(layer_base, i)
			assert(rec_i == 1)
			ui.main()
		ui.end_stack()
		end_layer()
		frame_end_check()

		local a = end_rec()
		layout_rec(a, 0, 0, screen_w, screen_h)

		id_state_gc()

		if not want_relayout then
			t0 = clock()

			--wr'\27[2J' --clear screen

			draw_frame(recs, layers)

			ui.frame_changed()
		end

		reset_cmd_state()
		reset_input_state()

		if not want_relayout then
			break
		end
		relayout_count = relayout_count + 1
		if relayout_count > 2 then
			wr'relayout loop detected\r\n'
			break
		end
	end
	scr_flush()

end

function term_bg_changed()
	redraw()
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
		assertf(not ui[cmd], 'command %s already defined', cmd)
		ui[cmd] = wrapper
		local setstate = t.setstate
		if t.setstate then
			function wrapper(...)
				return create(cmd, ...)
			end
			ui[cmd..'_state'] = wrapper
		end
	end
	return class
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
		local za = layer.indexes
		if z_index == 0 and (#za == 0 or za[#za] == 0) then -- common path, z-index not used
			add(layer.indexes, rec_i)
			add(layer.indexes, ct_i)
			add(layer.indexes, z_index)
		else
			local insert_i = binsearch(layer.indexes, z_index, cmp_z_index, 1, #layer.indexes / 3) * 3
			assert(false, 'NYI')
			--layer.indexes.splice(insert_i, 0, rec_i, ct_i, z_index)
		end
	end,

})

-- draw_layer command --------------------------------------------------------

ui.widget('draw_layer', {

	create = function(_, layer)
		layer = ui.layer(layer)
		ui.cmd('draw_layer', layer.i, layer.indexes)
	end,

	draw = function(a, i, recs)
		local layer_i = a[i+0]
		local indexes = a[i+1]
		draw_layer(layer_i, indexes, recs)
	end,

})

-- box widgets ---------------------------------------------------------------

local FR    = 4 -- all `is_flex_child` widgets: fraction from main-axis size.
local ALIGN = 5 -- vert. align at ALIGN+1
local BOX_S = 7 -- first index after the ui.cmd_box header.

function ui.cmd_box(cmd, fr, halign, valign, min_w, min_h, ...)
	assert(not halign or halign == 'c' or halign == 'l' or halign == 'r' or halign == 's' or halign == ']' or halign == '[')
	assert(not valign or valign == 'c' or valign == 't' or valign == 'b' or valign == 's' or valign == ']' or halign == '[')
	return ui.cmd(cmd,
		min_w or 0, -- min_w in measuring phase; x in positioning phase
		min_h or 0, -- min_h in measuring phase; y in positioning phase
		0, --children's min_w in measuring phase; w in positioning phase
		0, --children's min_h in measuring phase; h in positioning phase
		max(0, fr or 1),
		halign or 's',
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
	local main_axis = cmd.main_axis == axis
	local min_w = a[i+2+axis]
	if main_axis then
		a[i+2+axis] = min_w + w
	else
		a[i+2+axis] = max(min_w, w)
	end
end
ui.add_ct_min_wh = add_ct_min_wh

local function ct_stack_push(a, i)
	add(ct_stack, i)
end

-- calculate a[i+2]=min_w (for axis=0) or a[i+3]=min_h (for axis=1).
local function box_measure(a, i, axis)
	a[i+2+axis] = max(a[i+2+axis], a[i+0+axis]) -- apply own min_w|h
	local min_wh = a[i+2+axis]
	add_ct_min_wh(a, axis, min_wh)
end

-- box position phase

function align_w(a, i, axis, sw)
	local align = a[i+ALIGN+axis]
	if align == 's' then
		return sw
	end
	return a[i+2+axis] -- min_w
end

function align_x(a, i, axis, sx, sw)
	local align = a[i+ALIGN+axis]
	if align == 'r' or align == ']' or align == 'b' then
		local min_w = a[i+2+axis]
		return sx + sw - min_w
	elseif align == 'c' then
		local min_w = a[i+2+axis]
		return sx + round((sw - min_w) / 2)
	else
		return sx
	end
end

ui.align_x = align_x
ui.align_w = align_w

-- calculate a[i+0]=x, a[i+2]=w (for axis=0) or a[i+1]=y, a[i+3]=h (for axis=1).
-- the resulting box at a[i+0..3] is the inner box which excludes margins and paddings.
-- NOTE: scrolling and popup positioning is done in the translation phase.
function box_position(a, i, axis, sx, sw)
	a[i+0+axis] = align_x(a, i, axis, sx, sw)
	a[i+2+axis] = align_w(a, i, axis, sw)
end

-- box translate phase

local function box_translate(a, i, dx, dy)
	a[i+0] = a[i+0] + dx
	a[i+1] = a[i+1] + dy
end

-- box hit phase

local function hit_rect(x, y, w, h)
	return rect_hit(ui.mx, ui.my, x, y, w, h)
end

function hit_box(a, i)
	local x = a[i+0]
	local y = a[i+1]
	local w = a[i+2]
	local h = a[i+3]
	return hit_rect(x, y, w, h)
end
ui.hit_box = hit_box

ui.box_widget = function(cmd, t)
	local ID = t.ID
	local box_hit = t.hit or ID and function(a, i)
		local id = a[i+ID]
		if hit_box(a, i) then
			if id ~= '' then ui.hover(id) end
			return true
		end
	end
	return ui.widget(cmd, update({
		measure   = t.measure   or do_after(do_before(box_measure   , t.before_measure  ), t.after_measure  ),
		position  = t.position  or do_after(do_before(box_position  , t.before_position ), t.after_position ),
		translate = t.translate or do_after(do_before(box_translate , t.before_translate), t.after_translate),
		hit       = box_hit,
		is_flex_child = true,
	}, t))
end

-- box container widgets -----------------------------------------------------

local BOX_CT_NEXT_EXT_I = BOX_S+0 -- all box containers: next command after this one's 'end' command.
local BOX_CT_S          = BOX_S+1 -- first index after the ui.cmd_box_ct header.

local CT_NEXT_EXT_I --fwd. decl.

--[[local]] function cmd_next_ext_i(a, i)
	local cmd = a[i-1]
	if cmd.is_box_ct then --box container
		return i+a[i+BOX_CT_NEXT_EXT_I]
	elseif cmd.is_ct then --non-box container
		return i+a[i+CT_NEXT_EXT_I]
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

ui.widget('end', {

	is_end = true,

	create = function(_, cmd)
		cmd = ui.cmds[cmd]
		--end_scope()
		local i = assert(del(ct_stack), 'end command outside container')
		if cmd and a[i-1] ~= cmd then
			assertf(false, 'closing %s instead of %s', cmd.name, a[i-1].name)
		end
		local end_i = ui.cmd('end', i)
		a[end_i+0] = a[end_i+0] - end_i -- make relative
		local next_i = cmd_next_i(a, end_i)
		a[i+BOX_CT_NEXT_EXT_I] = next_i-i -- next_i but relative to the ct cmd at i
		if a[i-1].name == 'popup' then --TOOD: make this non-specific
			end_layer()
		end
	end,

	measure = function(a, _, axis)
		local i = assert(del(ct_stack), 'end command outside a container')
		local cmd = a[i-1]
		local measure_end_f = cmd.measure_end
		if measure_end_f then
			measure_end_f(a, i, axis)
		else
			local own_min_w = a[i+0+axis]
			local min_w     = a[i+2+axis]
			min_w = max(min_w, own_min_w)
			a[i+2+axis] = min_w
			add_ct_min_wh(a, axis, min_w)
		end
	end,

	draw = function(a, end_i)
		local i = end_i + a[end_i]
		local draw_end_f = a[i-1].draw_end
		if draw_end_f then
			draw_end_f(a, i)
		end
	end,

})
ui.end_cmd = ui['end'] --we can't use ui.end() in Lua.

-- position phase utils

local function position_children_stacked(a, ct_i, axis, sx, sw)

	local i = cmd_next_i(a, ct_i)
	while 1 do
		local cmd = a[i-1]
		if cmd.is_end then break end
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
	while 1 do
		local cmd = a[i-1]
		if cmd.is_end then break end
		local next_ext_i = cmd_next_ext_i(a, i)
		local translate_f = cmd.translate
		if translate_f then
			translate_f(a, i, dx, dy, ct_i)
		end
		i = next_ext_i
	end
end

local function box_ct_translate(a, i, dx, dy)
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
	local i = cmd_prev_i(a, end_i)
	while i > ct_i do
		if a[i-1].is_end then
			i = i+a[i+0] -- start_i
		end
		local hit_f = a[i-1].hittest
		if hit_f and not (a.nohit_set and a.nohit_set[i]) and hit_f(a, i, recs) then
			return true
		end
		i = cmd_prev_i(a, i)
	end
end

ui.box_ct_widget = function(cmd, t)
	return ui.box_widget(cmd, update({
		is_ct = true,
		is_box_ct = true,
		measure = ct_stack_push,
		translate = box_ct_translate,
	}, t))
end

-- non-box container widgets -------------------------------------------------

--[[local]] CT_NEXT_EXT_I = 1

-- NOTE: `ct` is short for container, which must end with ui.end().
function ui.cmd_ct(cmd, ...)
	local i = ui.cmd(cmd,
		0, --next_ext_i
		...
	)
	add(ct_stack, i)
	return i
end

function ct_translate(a, i, dx, dy)

end

ui.ct_widget = function(cmd, t)
	return ui.widget(cmd, update({
		is_ct = true,
		measure = ct_stack_push,
		translate = ct_translate,
	}, t))
end

-- flex ----------------------------------------------------------------------

local function is_last_flex_child(a, i)
	while 1 do
		i = cmd_next_ext_i(a, i)
		if a[i-1].is_flex_child then return false end
		if a[i-1].is_end then return true end
	end
end

local function position_flex(a, i, axis, sx, sw)

	sx = align_x(a, i, axis, sx, sw)
	sw = align_w(a, i, axis, sw)

	a[i+0+axis] = sx
	a[i+2+axis] = sw

	local ct_i = i
	if a[i-1].main_axis == axis then

		local i = ct_i

		local next_i = cmd_next_i(a, i)

		-- compute total fr.
		local total_fr = 0
		local n = 0
		i = next_i
		while not a[i-1].is_end do
			if a[i-1].is_flex_child then
				total_fr = total_fr + a[i+FR]
				n = n + 1
			end
			i = cmd_next_ext_i(a, i)
		end

		if total_fr == 0 then
			total_fr	= 1
		end

		local total_w = sw

		-- compute total overflow width and total free width.
		local total_overflow_w = 0
		local total_free_w     = 0
		i = next_i
		while not a[i-1].is_end do
			if a[i-1].is_flex_child then

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
		while not a[i-1].is_end do
			if a[i-1].is_flex_child then

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

				-- let the last child eat up any rounding errors.
				if is_last_flex_child(a, i) then
					sw = total_w - sx
				end

				-- position item's children recursively.
				local position_f = a[i-1].position
				position_f(a, i, axis, sx, sw)

				sx = sx + sw

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

function flex(hv)
	return ui.box_ct_widget(hv, {
		main_axis = hv == 'h' and 0 or 1,
		create = function(cmd, fr, align, valign, min_w, min_h)
			return ui.cmd_box_ct(cmd, fr, align, valign, min_w, min_h)
		end,
		position = position_flex,
		hittest = function(a, i, recs)
			if hit_children(a, i, recs) then
				return true
			end
		end
	})
end
flex'h'
flex'v'

-- stack ---------------------------------------------------------------------

local STACK_ID = BOX_CT_S+0

ui.box_ct_widget('stack', {
	ID = STACK_ID,
	create = function(cmd, id, fr, align, valign, min_w, min_h)
		return ui.cmd_box_ct(cmd, fr, align, valign, min_w, min_h,
			id or '')
	end,
	position = function(a, i, axis, sx, sw)
		local x = align_x(a, i, axis, sx, sw)
		local w = align_w(a, i, axis, sw)
		a[i+0+axis] = x
		a[i+2+axis] = w
		position_children_stacked(a, i, axis, x, w)
	end,
	hittest = function(a, i, recs)
		if hit_children(a, i, recs) then
			ui.hover(a[i+STACK_ID])
			return true
		end
		if hit_box(a, i) then
			ui.hover(a[i+STACK_ID])
		end
	end,
})

-- box -----------------------------------------------------------------------

local BOX_ID    = BOX_CT_S+0
local BOX_TITLE = BOX_CT_S+1

ui.box_ct_widget('box', {

	ID = BOX_ID,

	create = function(cmd, id, title, align, valign, min_w, min_h)
		return ui.cmd_box_ct(cmd, fr or 1, align, valign, min_w, min_h,
			id or '',
			title or ''
		)
	end,

	measure_end = function(a, i, axis)
		a[i+2+axis] = max(a[i+2+axis], a[i+0+axis], 2) -- apply own min_w|h
	end,

	position = function(a, i, axis, sx, sw)

		local x = align_x(a, i, axis, sx, sw)
		local w = align_w(a, i, axis, sw)
		a[i+0+axis] = x
		a[i+2+axis] = w

		position_children_stacked(a, i, axis, x + 1, w - 2)
	end,

	hittest = function(a, i, recs)
		if hit_children(a, i, recs) then
			ui.hover(a[i+BOX_ID])
			return true
		end
		if hit_box(a, i) then
			ui.hover(a[i+BOX_ID])
		end
	end,

	draw = function(a, i)
		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]
		scr_draw_box(x, y, w, h)
	end,
})

--text -----------------------------------------------------------------------

local TEXT_ID = BOX_S+0
local TEXT_S  = BOX_S+1

ui.box_widget('text', {
	ID = TEXT_ID,
	create = function(cmd, id, s, fr, align, valign, max_min_w, min_w, min_h)
		return ui.cmd_box(cmd, fr, align or 's', valign or 's', min_w, min_h,
			id or '',
			s or ''
		)
	end,
	measure = function(a, i, axis)
		local min_wh = a[i+0+axis]
		if axis == 0 then
			local s = a[i+TEXT_S]
			min_wh = max(min_wh, #s)
		else
			min_wh = max(min_wh, 1)
		end
		a[i+0+axis] = min_wh
		box_measure(a, i, axis)
	end,
	--position
	hittest = function(a, i, recs)
		if hit_box(a, i) then
			ui.hover(a[i+TEXT_ID])
		end
	end,
	draw = function(a, i)
		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]
		local s = a[i+TEXT_S]
		scr_wr(x, y, s)
	end,
})

-- scrollbox -----------------------------------------------------------------

local SB_BOXED    = BOX_CT_S+0
local SB_OVERFLOW = BOX_CT_S+1 -- overflow x,y
local SB_CW       = BOX_CT_S+3 -- content w,h
local SB_ID       = BOX_CT_S+5
local SB_SX       = BOX_CT_S+6 -- scroll x,y
local SB_STATE    = BOX_CT_S+8 -- hit state x,y

function parse_sb_overflow(s)
	if s == nil    or s == 'auto'   then return 'auto'   end
	if s == false  or s == 'hide'   then return 'hide'   end
	if s == true   or s == 'scroll' then return 'scroll' end
	if s == 'contain'  then return 'contain' end -- expand to fit content, like a stack.
	if s == 'infinite' then return 'infinte' end -- special mode for the infinite calendar.
	assert(false, 'invalid overflow ', s)
end

function ui.scroll_xy(a, i, axis)
	return a[i+SB_SX+axis]
end

-- box scroll-to-view box.
--TODO: replace with the one from rect.lua
local function scroll_to_view_rect(x, y, w, h, pw, ph, sx, sy)
	local min_sx = -x
	local min_sy = -y
	local max_sx = -(x + w - pw)
	local max_sy = -(y + h - ph)
	return
		-clamp(-sx, min_sx, max_sx),
		-clamp(-sy, min_sy, max_sy)
end

local function scrollbox_view_rect(a, i) --returns h_visible, v_visible, ...clip_rect
	local x  = a[i+0]
	local y  = a[i+1]
	local w  = a[i+2]
	local h  = a[i+3]
	local cw = a[i+SB_CW+0]
	local ch = a[i+SB_CW+1]
	local boxed = a[i+SB_BOXED]
	local overflow_x = repl(a[i+SB_OVERFLOW+0], 'infinite', 'scroll')
	local overflow_y = repl(a[i+SB_OVERFLOW+1], 'infinite', 'scroll')
	if boxed then
		local h_visible = overflow_x == 'scroll' or overflow_x == 'auto' and ((w - 2) / cw) < 1
		local v_visible = overflow_y == 'scroll' or overflow_y == 'auto' and ((h - 2) / ch) < 1
		return h_visible, v_visible, x+1, y+1, w-2, h-2
	end
	local h_visible = overflow_x == 'scroll' or overflow_x == 'auto' and (w / cw) < 1
	local v_visible = overflow_y == 'scroll' or overflow_y == 'auto' and (h / ch) < 1
	if h_visible and not v_visible and overflow_y == 'auto' then
		--if h-scrollbar needs shown, it alone can make the v-scrollbar appear
		--because the view height shrinks by 1 to accomodate the h-scrollbar.
		v_visible = (h - 1) / ch < 1
	elseif v_visible and not h_visible and overflow_x == 'auto' then --same here
		h_visible = (w - 1) / cw < 1
	end
	if h_visible then h = h - 1 end
	if v_visible then w = w - 1 end
	return h_visible, v_visible, x, y, w, h
end

local function scrollbar_rect(a, i, axis)
	local cw = a[i+SB_CW+0]
	local ch = a[i+SB_CW+1]
	local sx = a[i+SB_SX+0]
	local sy = a[i+SB_SX+1]
	local boxed = a[i+SB_BOXED]
	local h_visible, v_visible, x, y, w, h = scrollbox_view_rect(a, i)
	if axis == 0 then
		if h_visible then
			local pw = w / cw
			local psx = clamp(sx / (cw - w), 0, 1)
			local bar_min_len = 2
			local tw = max(min(bar_min_len, w), round(pw * w))
			local th = 1
			local tx = x + round(psx * (w - tw))
			local ty = y + h
			return true, tx, ty, tw, th, x, y, w, h
		end
	else
		if v_visible then
			local ph = h / ch
			local psy = clamp(sy / (ch - h), 0, 1)
			local bar_min_len = 1
			local th = max(min(bar_min_len, h), round(ph * h))
			local tw = 1
			local ty = y + round(psy * (h - th))
			local tx = x + w
			return true, tx, ty, tw, th, x, y, w, h
		end
	end
end

ui.box_ct_widget('scrollbox', {

	create = function(cmd, id, fr, overflow_x, overflow_y, boxed, align, valign, min_w, min_h, sx, sy)

		overflow_x = parse_sb_overflow(overflow_x)
		overflow_y = parse_sb_overflow(overflow_y)

		assert(id and id ~= '', 'id required for scrollbox')

		ui.keepalive(id)
		local ss = ui.state(id)
		sx = sx or ss.scroll_x or 0
		sy = sy or ss.scroll_y or 0

		local i = ui.cmd_box_ct(cmd, fr, align, valign, min_w, min_h,
			boxed and true or false,
			overflow_x,
			overflow_y,
			0, 0, -- content w, h
			id,
			sx, -- scroll x
			sy, -- scroll y
			0 -- state
		)
		if sx ~= 0 then ss.scroll_x = sx end
		if sy ~= 0 then ss.scroll_y = sy end

		return i
	end,

	measure_end = function(a, i, axis)
		local own_min_w = a[i+0+axis]
		local co_min_w  = a[i+2+axis] -- content min_w
		local overflow = a[i+SB_OVERFLOW+axis]
		local contain = overflow == 'contain'
		local sb_min_w = max(contain and co_min_w or 0, own_min_w) -- scrollbox min_w
		a[i+SB_CW+axis] = co_min_w
		a[i+2+axis] = sb_min_w
		add_ct_min_wh(a, axis, sb_min_w)
	end,

	-- NOTE: scrolling is done later in the translation phase.
	position = function(a, i, axis, sx, sw)
		local x = align_x(a, i, axis, sx, sw)
		local w = align_w(a, i, axis, sw)
		a[i+0+axis] = x
		a[i+2+axis] = w
		local content_w = a[i+SB_CW+axis]
		local overflow = a[i+SB_OVERFLOW+axis]
		position_children_stacked(a, i, axis, x, max(content_w, w))
	end,

	translate = function(a, i, dx, dy)

		local x  = a[i+0] + dx
		local y  = a[i+1] + dy
		local w  = a[i+2]
		local h  = a[i+3]
		local cw = a[i+SB_CW+0]
		local ch = a[i+SB_CW+1]
		local sx = a[i+SB_SX+0]
		local sy = a[i+SB_SX+1]

		local infinite_x = a[i+SB_OVERFLOW+0] == 'infinite'
		local infinite_y = a[i+SB_OVERFLOW+1] == 'infinite'

		if infinite_x then
			cw = w * 4
			a[i+SB_CW+0] = cw
		end
		if infinite_y then
			ch = h * 4
			a[i+SB_CW+1] = ch
		end

		a[i+0] = x
		a[i+1] = y

		if infinite_x then sx = max(0, min(sx, cw - w)) end
		if infinite_y then sy = max(0, min(sy, ch - h)) end

		local psx = sx / (cw - w)
		local psy = sy / (ch - h)

		local id = a[i+SB_ID]
		if id ~= '' then
			local hit_state = 0
			for axis = 0,1 do

				local visible, tx, ty, tw, th, x, y, w, h = scrollbar_rect(a, i, axis)
				if not visible then goto continue end

				-- scroll to view an inner box
				local box = ui.state(id).scroll_to_view
				if box then
					local bx, by, bw, bh = unpack(box)
					sx, sy = scroll_to_view_rect(bx, by, bw, bh, w, h, sx, sy)
					a[i+SB_SX+0] = sx
					a[i+SB_SX+1] = sy
					local s = ui.state(id)
					s.scroll_x = sx
					s.scroll_y = sy
					s.scroll_to_view = nil
				end

				-- wheel scrolling
				if axis == 1 and ui.wheel_dy ~= 0 and ui.hit(id) then
					local sy0 = ui.state(id).scroll_y
					sy = sy - ui.wheel_dy
					if not infinite_y then
						sy = clamp(sy, 0, ch - h)
					end
					ui.state(id).scroll_y = sy
					a[i+SB_SX+1] = sy
				end

				-- drag-scrolling
				local sbar_id = id..'.scrollbar'..axis
				local cs = ui.captured(sbar_id)
				local hs
				if cs then
					if axis == 0 then
						local psx0 = cs.psx0
						local dpsx = (ui.mx - ui.mx0) / (w - tw)
						sx = round((psx0 + dpsx) * (cw - w))
						if not infinite_x then
							sx = clamp(sx, 0, cw - w)
						end
						ui.state(id).scroll_x = sx
						a[i+SB_SX+0] = sx
					else
						local psy0 = cs.psy0
						local dpsy = (ui.my - ui.my0) / (h - th)
						sy = round((psy0 + dpsy) * (ch - h))
						if not infinite_y then
							sy = clamp(sy, 0, ch - h)
						end
						ui.state(id).scroll_y = sy
						a[i+SB_SX+1] = sy
					end
				else
					hs = ui.hit(sbar_id)
					if not hs then
						goto continue
					end
					cs = ui.capture(sbar_id)
					if cs then
						if axis == 0 then
							cs.psx0 = psx
						else
							cs.psy0 = psy
						end
					end
				end

				-- bits 0..1 = horiz state; bits 2..3 = vert. state.
				hit_state = bor(hit_state, shl((cs and 2 or (hs and 1 or 0)), 2 * axis))

				::continue::
			end
			a[i+SB_STATE] = hit_state
		end

		translate_children(a, i, dx - sx, dy - sy)

	end,

	draw = function(a, i)

		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]

		if a[i+SB_BOXED] then
			scr_draw_box(x, y, w, h)
		end

		local _, _, x, y, w, h = scrollbox_view_rect(a, i)

		scr_clip(x, y, w, h)

	end,

	draw_end = function(a, i)

		scr_clip_end()

		for axis = 0,1 do

			local state = band(shr(a[i+SB_STATE], (2 * axis)), 3)
			state = state == 2 and 'active' or state ~= 0 and 'hover' or nil

			local visible, tx, ty, tw, th = scrollbar_rect(a, i, axis)
			if visible then
				local bg = ui.bg_color('scrollbar', state)
				scr_fill(tx, ty, tw, th, bg[1], 0, axis == 0 and ' ' or ' ')
			end
		end
	end,

	hittest = function(a, i, recs)
		local id = a[i+SB_ID]

		-- fast-test the outer box since we're clipping the contents.
		if not hit_box(a, i) then
			return
		end

		ui.hover(id)

		-- test the scrollbars
		for axis = 0,1 do
			local visible, tx, ty, tw, th = scrollbar_rect(a, i, axis)
			if visible and hit_rect(tx, ty, tw, th) then
				ui.hover(id..'.scrollbar'..axis)
				return true
			end
		end

		-- test the children
		hit_children(a, i, recs)

		return true
	end,

})

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
	if id ~= '' then
		local s = ui.state(id)
		s.scroll_x = sx
		s.scroll_y = sy
	end

	translate_children(a, i, sx0-sx, sy0-sy)
end

ui.scroll_to_view = function(id, x, y, w, h)
	ui.state(id).scroll_to_view = {x, y, w, h}
end

--[==[
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
local POPUP_LAYER_I   = BOX_CT_S+0
local POPUP_TARGET_I  = BOX_CT_S+1
local POPUP_FLAGS     = BOX_CT_S+2
local POPUP_SIDE_REAL = BOX_CT_S+3

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
		nil, -- fr -> id
		nil, -- align -> side
		nil, -- valign -> align
		min_w, min_h,
		-- BOX_CT_S+0
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
		ui.hover(a[i+POPUP_ID])
		return true
	end
end

]==]

--demo -----------------------------------------------------------------------

ui.main = function()
	ui.v()
		ui.box()
			ui.text('', 'Hello, world!', 0, 'c', 'c')
		ui.end_box()
		ui.h(2)
			ui.stack('', 2)
				ui.scrollbox('sb1', 1, 'auto', 'auto', true)
					ui.stack('', 0, 'l', 't', 120, 50)
						ui.text('', 'Goodbye, cruel world!', 0, 'c', 'c') --, nil, 100, 100)
					ui.end_stack()
				ui.end_scrollbox()
			ui.end_stack()
			ui.box()
				ui.text('', 'Goodbye, again!', 0, 'c', 'c')
			ui.end_box()
		ui.end_h()
	ui.end_v()
end

--main -----------------------------------------------------------------------

tc_set_raw_mode()
assert(tc_get_raw_mode(), 'could not put terminal in raw mode')

wr'\27[?1049h' --enter alternate screen
wr'\27[?1004l'  --enable window focus events
wr'\27[?1000h' --enable mouse tracking
wr'\27[?1003h' --enable mouse move tracking
wr'\27[?1006h' --enable SGR mouse tracking
wr'\27[?25l'   --hide cursor
wr'\27]11;?\7' --get terminal background color
wr_flush()

scr_resize()

--signals thread to capture Ctrl+C and terminal window resize events.
resume(thread(function()
	signal_block'SIGWINCH SIGINT'
	local sigf = signal_file('SIGWINCH SIGINT', true)
	while 1 do
		local si = sigf:read_signal()
		if si.signo == SIGWINCH then
			scr_resize()
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
		redraw()
		rd_input()
	end
end))

dbgf'starting'

start() --start the epoll loop (stopped by ctrl+C or a call to stop()).

wr'\27[?1004l'  --stop window focus events
wr'\27[?1000l' --stop mouse events
wr'\27[?1003l' --stop mouse move events
wr'\27[?1006l' --stop SGR mouse events
wr'\27[?25h'   --show cursor
wr'\27[?1049l' --exit alternate screen
wr_flush()

tc_reset() --reset terminal
