--go@ ssh root@10.0.0.8 -ic:\users\cosmin\.ssh\id_rsa tail -f imtui.log
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

local function array_clear(a)
	while #a > 0 do del(a) end
end

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

local function esc_control_code(c)
	return '\\' .. format('%d', byte(c))
end
local function term_esc(s)
	return tostring(s):gsub('[%z-\031\127\155-\159]', esc_control_code)
end

local function sanitize(s)
	return tostring(s):gsub('[%z-\008\011\012\014-\031\127\155-\159]', '')
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
		return 15 --white
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
	assertf(false, '%s: "%s"', err or 'invalid sequence', term_esc(s))
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
	assert(id)
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
				local b, mx, my, st = s:match'^(%d+);(%d+);(%d+)([Mm])$'
				if not b then
					assertf(false, 'invalid mouse event sequence: "%s"', term_esc(s))
				end
				if DEBUG then dbgf('mouse %d %d %s %s', mx, my, b, st) end
				ui.mx = num(mx)-1
				ui.my = num(my)-1
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
					ui.wheel_dy = 1
				elseif b == '65' then
					ui.wheel_dy = -1
				end
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

-- cell screen double-buffer -------------------------------------------------

local cell_ct = ctype[[
union {
	uint64_t data;
	struct {
		union {
			uint32_t codepoint;
			uint8_t  text[4];
		};
		uint8_t text_len;
		uint8_t fg;
		uint8_t bg;
		uint8_t flags;
	};
}
]]
assert(sizeof(cell_ct) == 8)
local cell_arr_ct = ctype('$[?]', cell_ct)

local scr, scr2, scr2_dirty

local function scr_cell_i(x, y)
	local i = y * screen_w + x
	assert(i >= 0 and i < screen_h * screen_w)
	return i
end

screen_w = 0
screen_h = 0

local function scr_flush()
	for y = 0, screen_h-1 do
		local x1
		local x = 0
		while x < screen_w do
			local i = scr_cell_i(x, y)
			local cell1 = scr [i]
			local cell2 = scr2[i]
			local diff = scr2_dirty or cell1.data ~= cell2.data
			if not x1 and diff then x1 = x end
			if x1 then
				local x2 = not diff and x or x == screen_w-1 and x+1 or nil
				if x2 then
					gotoxy(x1, y)
					for x = x1, x2-1 do
						local i = scr_cell_i(x, y)
						local cell1 = scr[i]
						wr_set_bg(cell1.bg)
						wr_set_fg(cell1.fg)
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
	scr, scr2 = scr2, scr --swap the screen buffers
	scr2_dirty = false
end

local function scr_resize()
	screen_w, screen_h = tc_get_window_size()
	scr  = new(cell_arr_ct, screen_w * screen_h)
	scr2 = new(cell_arr_ct, screen_w * screen_h)
	scr2_dirty = true
end

-- variable stack ------------------------------------------------------------

local varstack = {}

local function varstack_push(varname, ...)
	append(varstack, varname, ...)
	push(varstack, select('#', ...))
end

local function _varstack_pop(want_varname, varname, ...)
	assertf(want_varname == varname, 'closing %s before %s', want_varname, varname)
	return ...
end
local function varstack_pop(varname)
	local argn = assertf(pop(varstack), 'closing %s when not open', varname)
	return _varstack_pop(varname, popn(varstack, argn+1))
end

local function varstack_check()
	local ok = #varstack == 0
	while #varstack > 0 do
		local argn = pop(varstack)
		local varname = popn(varstack, argn+1)
		warnf('%s not closed', varname)
	end
	return ok
end

-- screen clip rect and stack ------------------------------------------------

local scr_x1, scr_y1, scr_x2, scr_y2 --current clip rect (x2,y2 is outside!)

local function scr_rect_clip(x, y, w, h)
	return rect_clip(x, y, w, h,
		scr_x1,
		scr_y1,
		scr_x2 - scr_x1,
		scr_y2 - scr_y1
	)
end

local function scr_clip(x, y, w, h)
	varstack_push('clip_rect', scr_x1, scr_y1, scr_x2, scr_y2)
	local x, y, w, h = scr_rect_clip(x, y, w, h)
	scr_x1 = x
	scr_y1 = y
	scr_x2 = x+w
	scr_y2 = y+h
end

local function scr_clip_end()
	scr_x1, scr_y1, scr_x2, scr_y2 = varstack_pop'clip_rect'
end

local function scr_clip_reset()
	scr_x1 = 0
	scr_y1 = 0
	scr_x2 = screen_w
	scr_y2 = screen_h
end

-- writing into the cell screen ----------------------------------------------

local function scr_wr(x, y, s, fg, bg) --set text
	if y < scr_y1 or y >= scr_y2 then return end
	local i1 = max( 1, scr_x1 - x + 1)
	local i2 = min(#s, scr_x2 - x)
	--TODO: split text by codepoints.
	--TODO: splitting on graphemes would be even better.
	--TODO: support 2-cell-wide graphemes.
	for si = i1, i2 do
		local i = scr_cell_i(x + si - 1, y)
		local cell = scr[i]
		cell.codepoint = 0
		cell.text[0] = byte(s, si)
		cell.text_len = 1
		if fg then cell.fg = fg end
		if bg then cell.bg = bg end
	end
end

local function scr_wrc(x, y, c, fg, bg) --set single cell
	if x < scr_x1 or x >= scr_x2 then return end
	if y < scr_y1 or y >= scr_y2 then return end
	assert(#c <= 4)
	local i = scr_cell_i(x, y)
	local cell = scr[i]
	cell.codepoint = 0
	copy(cell.text, c, #c)
	cell.text_len = #c
	if fg then cell.fg = fg end
	if bg then cell.bg = bg end
end

local function scr_each_cell(x, y, w, h, f, ...)
	local x, y, w, h = scr_rect_clip(x, y, w, h)
	if w == 0 or h == 0 then return end
	--assert(x >= 0 and y >= 0 and x+w-1 < screen_w and y+h-1 < screen_h)
	for y = y, y+h-1 do
		for x = x, x+w-1 do
			local i = scr_cell_i(x, y)
			f(i, ...)
		end
	end
end

local cell = cell_ct()
local function scr_copy_cell(i, cell)
	scr[i] = cell
end
local function scr_set_cell(i, text, fg, bg)
	if text then
		assert(#text > 0 and #text <= 4)
		scr[i].codepoint = 0
		copy(scr[i].text, text, #text)
		scr[i].text_len = #text
	end
	if fg then scr[i].fg = fg end
	if bg then scr[i].bg = bg end
end
local function scr_fill(x, y, w, h, text, fg, bg) --fill a box of cells
	if text and fg and bg then
		assert(#text > 0 and #text <= 4)
		cell.data = 0
		copy(cell.text, text, #text)
		cell.text_len = #text
		cell.fg = fg
		cell.bg = bg
		scr_each_cell(x, y, w, h, scr_copy_cell, cell)
	else
		scr_each_cell(x, y, w, h, scr_set_cell, text, fg, bg)
	end
end

-- writing lines and boxes into the cell screen ------------------------------

local scr_set_line_style
local scr_draw_vline
local scr_draw_hline
local scr_fix_line_ends
do
	local LCS_H = {} --horizontal line chars
	local LCS_V = {} --vertical line chars
	LCS_H.solid  = '─'
	LCS_V.solid  = '│'
	LCS_H.dotted = '┈'
	LCS_V.dotted = '┊'
	LCS_H.dashed = '┄'
	LCS_V.dashed = '┆'
	LCS_H.double = '═'
	LCS_V.double = '║'

	local LC_H, LD_H, hs
	local function set_hs(s)
		if s == hs then return hs end
		LC_H = LCS_H[s]
		LD_H = s == 'double'
		local hs0 = hs; hs = s
		return hs0
	end

	local LC_V, LD_V, vs
	local function set_vs(s)
		if s == vs then return vs end
		LC_V = LCS_V[s]
		LD_V = s == 'double'
		local vs0 = vs; vs = s
		return vs0
	end

	function scr_set_line_style(hs1, vs1)
		return
			set_hs(hs1 or vs),
			set_vs(vs1 or hs)
	end

	--"T" connectors between perpendicular lines.
	--H=horiz, V=vert, L=left, R=right, T=top, B=bottom, s=single, d=double.

	local T_HL_ss = '├'
	local T_HL_ds = '╟'
	local T_HL_sd = '╞'
	local T_HL_dd = '╠'

	local T_HR_ss = '┤'
	local T_HR_ds = '╢'
	local T_HR_sd = '╡'
	local T_HR_dd = '╣'

	local T_VT_ss = '┬'
	local T_VT_ds = '╤'
	local T_VT_sd = '╥'
	local T_VT_dd = '╦'

	local T_VB_ss = '┴'
	local T_VB_ds = '╧'
	local T_VB_sd = '╨'
	local T_VB_dd = '╩'

	local T_XX_ss = '┼'
	local T_XX_ds = '╫'
	local T_XX_sd = '╪'
	local T_XX_dd = '╬'

	local scr_line_ends = {} --describe points on screen where perpendiculars can form.

	local function cell_cmp(x, y, s)
		local i = scr_cell_i(x, y)
		return str(scr[i].text, scr[i].text_len) == s
	end

	--bind perpendiculars with "T" connectors.
	function scr_fix_line_ends()
		for i = 1, #scr_line_ends, 7 do
			local x, y, s1, ox, oy, s2, tc = unpack(scr_line_ends, i, i+6)
			if cell_cmp(x, y, s1) and cell_cmp(x+ox, y+oy, s2) then
				scr_wrc(x, y, tc)
			end
		end
	end

	function scr_draw_hline(x, y, w, fg, bg)
		local x, y, w, h = scr_rect_clip(x, y, w, 1)
		if w == 0 or h == 0 then return end
		for x = x, x+w-1 do
			scr_wrc(x, y, LC_H, fg, bg)
		end
		if x > 0 then
			append(scr_line_ends, x-1, y, LCS_V.solid ,  1, 0, LC_H, LD_H and T_HL_sd or T_HL_ss)
			append(scr_line_ends, x-1, y, LCS_V.double,  1, 0, LC_H, LD_H and T_HL_dd or T_HL_ds)
		end
		if x+w < screen_w then
			append(scr_line_ends, x+w, y, LCS_V.solid , -1, 0, LC_H, LD_H and T_HR_sd or T_HR_ss)
			append(scr_line_ends, x+w, y, LCS_V.double, -1, 0, LC_H, LD_H and T_HR_dd or T_HR_ds)
		end
	end

	function scr_draw_vline(x, y, h, fg, bg)
		local x, y, w, h = scr_rect_clip(x, y, 1, h)
		if w == 0 or h == 0 then return end
		for y = y, y+h-1 do
			scr_wrc(x, y, LC_V, fg, bg)
		end
		if y > 0 then
			append(scr_line_ends, x, y-1, LCS_H.solid , 0,  1, LC_V, LD_V and T_VT_sd or T_VT_ss)
			append(scr_line_ends, x, y-1, LCS_H.double, 0,  1, LC_V, LD_V and T_VT_dd or T_VT_ds)
		end
		if y+h < screen_h then
			append(scr_line_ends, x, y+h, LCS_H.solid , 0, -1, LC_V, LD_V and T_VB_sd or T_VB_ss)
			append(scr_line_ends, x, y+h, LCS_H.double, 0, -1, LC_V, LD_V and T_VB_dd or T_VB_ds)
		end
	end
end

local scr_set_corner_style
local scr_draw_box
do
	local CCS_TL = {} --top-left corner chars
	local CCS_TR = {} --top-right corner chars
	local CCS_BL = {} --bottom-left corner chars
	local CCS_BR = {} --bottom-left corner chars
	CCS_TL.straight = '┌'
	CCS_TR.straight = '┐'
	CCS_BL.straight = '└'
	CCS_BR.straight = '┘'
	CCS_TL.round    = '╭'
	CCS_TR.round    = '╮'
	CCS_BL.round    = '╰'
	CCS_BR.round    = '╯'
	CCS_TL.double   = '╔'
	CCS_TR.double   = '╗'
	CCS_BL.double   = '╚'
	CCS_BR.double   = '╝'

	local CC_TL, CC_TR, CC_BL, CC_BR
	local scr_corner_style
	function scr_set_corner_style(s)
		local s0 = scr_corner_style
		if s == s0 then return s0 end
		CC_TL = CCS_TL[s]
		CC_TR = CCS_TR[s]
		CC_BL = CCS_BL[s]
		CC_BR = CCS_BR[s]
		scr_corner_style = s
		return s0
	end

	function scr_draw_box(x, y, w, h, fg, bg)
		scr_wrc(x    , y    , CC_TL, fg, bg)
		scr_wrc(x+w-1, y    , CC_TR, fg, bg)
		scr_wrc(x    , y+h-1, CC_BL, fg, bg)
		scr_wrc(x+w-1, y+h-1, CC_BR, fg, bg)
		scr_draw_hline(x+1  , y    , w-2, fg, bg)
		scr_draw_hline(x+1  , y+h-1, w-2, fg, bg)
		scr_draw_vline(x    , y+1  , h-2, fg, bg)
		scr_draw_vline(x+w-1, y+1  , h-2, fg, bg)
	end
end

-- themes and colors ---------------------------------------------------------

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

local function reset_theme()
	theme = themes[ui.app_theme or (term_is_dark and 'dark' or 'light')]
end

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
--when defining a color for `hover`, `active` gets the same color if not defined.
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
		if istab(L) then --color def to copy
			states[state][name] = L
		else
			local ansi_color = hsl_to_color(h, s, L)
			local color = {ansi_color, is_dark or L < .5}
			attr(states, state)[name] = color
			if state == 'hover' and not attr(states, 'active')[name] then
				states.active[name] = color
			end
		end
	end
	return def_color
end

local function lookup_color_func(k)
	return function(name, state, theme1)
		state = parse_state(state)
		theme1 = theme1 and themes[theme1] or theme
		local t = theme1[k]
		local tc = t[state]
		local c = tc and tc[name] or t.normal[name]
		if not c then
			assert(false, 'no ' .. k .. ' for (' .. name .. ', ' ..
				state .. ', ' .. theme1.name .. ')')
		end
		return c[1], c[2], c
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

ui.fg_style('dark' , 'title'  , 'normal' ,   0, 0.00, 0.90)
ui.fg_style('dark' , 'title'  , 'hover'  ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'title'  , 'active' ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'text'   , 'normal' ,   0, 0.00, 0.90)
ui.fg_style('dark' , 'text'   , 'hover'  ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'text'   , 'active' ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'label'  , 'normal' ,   0, 0.00, 0.80)
ui.fg_style('dark' , 'label'  , 'hover'  ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'label'  , 'active' ,   0, 0.00, 1.00)
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

ui.border_style('dark' , 'light'   , 'normal' ,   0,    0, 0.35)
ui.border_style('dark' , 'light'   , 'hover'  ,   0,    0, 0.55)
ui.border_style('dark' , 'light'   , 'active' ,   0,    0, 0.75)
ui.border_style('dark' , 'intense' , 'normal' ,   0,    0, 0.20)
ui.border_style('dark' , 'intense' , 'hover'  ,   0,    0, 0.40)
ui.border_style('dark' , 'max'     , 'normal' ,   0,    0, 1.00)
ui.border_style('dark' , 'marker'  , 'normal' ,  61, 1.00, 0.57)

-- background colors ---------------------------------------------------------

ui.bg_style = def_color_func'bg'
ui.bg_color = lookup_color_func'bg'

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
ui.bg_style('dark' , 'bg'    , 'normal' , 216, 0.00, 0.10)
ui.bg_style('dark' , 'bg'    , 'hover'  , 216, 0.00, 0.25)
ui.bg_style('dark' , 'bg'    , 'active' , 216, 0.00, 0.14)
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

--[[ widget state ------------------------------------------------------------

Persistence between frames is kept in per-id state maps. Widgets need to
call ui.keepalive(id) otherwise their state map is garbage-collected at the
end of the frame. Widgets can also register a `free` callback to be called if
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
	local s = ui.state(id)
	after(s, 'free', free1)
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

function rec()
	return {}
end

ui.start_recording = function()
	local a1 = rec()
	varstack_push('rec', a)
	a = a1
end

ui.end_recording = function()
	local a1 = a
	a = varstack_pop'rec'
	return a1
end

ui.play_recording = function(a1)
	extend(a, a1)
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

local function clear_recs()
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

local current_layer    -- set while building
local current_layer_i  -- set while drawing

local function begin_layer(layer, ct_i, z_index)
	varstack_push('layer', current_layer)
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
	current_layer = varstack_pop'layer'
end

-- container stack -----------------------------------------------------------

-- used in both frame creation and measuring stages.

local ct_stack = {} -- {ct_i1,...}
ui.ct_stack = ct_stack

function ui.ct_i() return assert(ct_stack[#ct_stack], 'no container') end
function ui.rel_ct_i() return ui.ct_i() - #a + 2 end

local function ct_stack_check()
	local ok = #ct_stack == 0
	while #ct_stack > 0 do
		local i = pop(ct_stack)
		warnf('%s not closed', a[i-1].name)
	end
	return ok
end

-- measuring phases (per-axis) -----------------------------------------------

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

-- positioning phases (per-axis) ---------------------------------------------

-- walk the element tree top-down, and call the position function for each
-- element that has it. recursive, uses call stack to pass ct_i and ct_w.

local function position_rec(a, axis, ct_wh)
	local i, n = 3, #a
	while i < n do
		local cmd = a[i-1]
		local position_f = cmd.position
		if position_f then
			local min_wh = a[i+2+axis]
			position_f(a, i, axis, 0, max(min_wh, ct_wh))
		end
		i = cmd_next_ext_i(a, i)
	end
end

-- translation phase ---------------------------------------------------------

-- do scrolling and popup positioning and offset all boxes (top-down, recursive).
-- this can't be done in the positioning phases which are per-axis for those
-- special widgets so we need a separate phase.

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

local function draw_cmd(a, i, recs)
	local next_ext_i = cmd_next_ext_i(a, i)
	while i < next_ext_i do
		local cmd = a[i-1]
		local draw_f = cmd.draw
		if draw_f and draw_f(a, i, recs) then
			i = cmd_next_ext_i(a, i)
		else
			i = i + a[i-2] --next_i
		end
	end
end

local function draw_layer(layer_i, indexes, recs)
	local prev_layer_i = current_layer_i
	--[[global]] current_layer_i = layer_i
	for k = 1, #indexes, 3 do
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
	return nil
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

-- measuring requests --------------------------------------------------------

local measure_req = {}

ui.measure = function(dest)
	local i = ui.ct_i()
	append(measure_req, dest, a, i)
end

function measure_req_all()
	for k = 1, #measure_req, 3 do
		local dest = measure_req[k+0]
		local a    = measure_req[k+1]
		local i    = measure_req[k+2]
		local s = isstr(dest) and ui.state(dest) or dest
		s.x = a[i+0]
		s.y = a[i+1]
		s.w = a[i+2]
		s.h = a[i+3]
	end
	array_clear(measure_req)
end

-- input-render loop ---------------------------------------------------------

local want_relayout

ui.relayout = function()
	want_relayout = true
end

local function layout_rec(a, x, y, w, h)

	-- x-axis
	measure_rec(a, 0)
	ct_stack_check()
	position_rec(a, 0, w)

	-- y-axis
	measure_rec(a, 1)
	ct_stack_check(a)
	position_rec(a, 1, h)

	translate_rec(a, x, y)
end

ui.focusables = {}

local function redraw()

	--term_reset_styles()

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

		measure_req_all()

		clear_layers()
		reset_theme()
		clear_recs()

		t0 = clock()

		begin_rec()
		ui.stack()
			local i = cmd_last_i(a)
			begin_layer(layer_base, i)
			assert(rec_i == 1)
			local ok, err = xpcall(ui.main, traceback)
			if not ok then
				warnf('%s', err)
				break
			end
		ui.end_stack()
		end_layer()
		varstack_check()
		ct_stack_check()

		local a = end_rec()
		layout_rec(a, 0, 0, screen_w, screen_h)

		id_state_gc()

		if not want_relayout then
			t0 = clock()

			scr_set_line_style('solid', 'solid')
			scr_set_corner_style'straight'

			local fg = ui.fg_color'text'
			local bg = ui.bg_color'bg'
			scr_fill(0, 0, screen_w, screen_h, ' ', fg, bg)

			draw_layers(layers, recs)
			assert(current_layer_i == nil)

			scr_fix_line_ends()

		end

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

-- state pseudo-widgets ------------------------------------------------------

--[[
ui.widget('set_corner_style', {
	create = function(cmd, s) return ui.cmd(cmd, s) end,
	draw = function(a, i) scr_set_corner_style(a[i+0]) end,
})

local corner_style = 'straight'
function ui.corner_style(s)
	assertf(CCS_TL[s], 'invalid corner style %s', s)
	varstack_push('corner_style', corner_style)
	ui.set_corner_style(s)
end
function ui.end_corner_style(s)
	corner_style = varstack_pop'corner_style'
end

ui.widget('set_line_style', {
	create = function(cmd, s) return ui.cmd(cmd, s) end,
	draw = function(a, i) scr_set_line_style(a[i+0]) end,
})

local line_style = 'solid'
function ui.line_style(s)
	assertf(LCS_H[s], 'invalid line style %s', s)
	varstack_push('line_style', line_style)
	line_style = s
	ui.set_line_style(s)
end
function ui.end_line_style()
	line_style = varstack_pop'line_style'
end
]]

-- set_layer command ---------------------------------------------------------

local SET_LAYER_Z_INDEX = 2

-- binsearch cmp func for finding last insert position by z_index in flattened
-- array of (rec_i, i, z_index) tuples.
local function cmp_z_index(a, i, v) return a[i*3+2] <= v end

ui.widget('set_layer', {

	-- puts a cmd on a layer. the reason for generating a set_layer command
	-- instead of just doing the work here is because we might be in a command
	-- recording and thus we don't know the final ct_i after the recording is played.
	create = function(cmd, layer, ct_i, z_index)
		ct_i = ct_i or ui.ct_i()
		local i = ui.cmd(cmd, layer.i, ct_i, z_index or 0)
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

local FR    = 4 -- all widgets with a fr() method: fraction from main-axis size.
local ALIGN = 5 -- vert. align at ALIGN+1
local BOX_S = 7 -- first index after the ui.cmd_box header.

function ui.cmd_box(cmd, fr, halign, valign, min_w, min_h, ...)
	halign = repl(repl(halign, ']', 'r'), '[', 'l')
	assert(not halign or halign == 'c' or halign == 'l' or halign == 'r' or halign == 's')
	assert(not valign or valign == 'c' or valign == 't' or valign == 'b' or valign == 's')
	return ui.cmd(cmd,
		min_w or 0, -- user min_w in measuring phase; x in positioning phase
		min_h or 0, -- user min_h in measuring phase; y in positioning phase
		0, --children's min_w -> min_w in measuring phase; w in positioning phase
		0, --children's min_h -> min_h in measuring phase; h in positioning phase
		max(0, fr or 1),
		halign or 's',
		valign or 's',
		...
	)
end

-- box measure phase

local function add_ct_min_wh(a, axis, child_min_wh)
	local ct_i = ct_stack[#ct_stack]
	if not ct_i then return end -- root ct
	local cmd = a[ct_i-1]
	local main_axis = cmd.main_axis == axis
	local ct_min_wh = a[ct_i+2+axis]
	if main_axis then
		a[ct_i+2+axis] = ct_min_wh + child_min_wh
	else
		a[ct_i+2+axis] = max(ct_min_wh, child_min_wh)
	end
end
ui.add_ct_min_wh = add_ct_min_wh

local function ct_stack_push(a, i)
	add(ct_stack, i)
end

-- calculate a[i+2]=min_w (for axis=0) or a[i+3]=min_h (for axis=1).
local function box_measure(a, i, axis)
	local user_min_wh = a[i+0+axis]
	local computed_min_wh = a[i+2+axis]
	local min_wh = max(computed_min_wh, user_min_wh)
	a[i+2+axis] = min_wh
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
	if align == 'r' or align == 'b' then
		local min_w = a[i+2+axis]
		return sx + sw - min_w
	elseif align == 'c' then
		local min_w = a[i+2+axis]
		return sx + max(0, round((sw - min_w) / 2))
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

function hit_box(a, i)
	local x = a[i+0]
	local y = a[i+1]
	local w = a[i+2]
	local h = a[i+3]
	return rect_hit(ui.mx, ui.my, x, y, w, h)
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
		is_box = true,
		hittest = box_hit,
		measure = box_measure,
		position = box_position,
	}, t))
end

-- box container widgets -----------------------------------------------------

local BOX_CT_NEXT_EXT_I = BOX_S+0 -- all box containers: next command after this one's 'end' command.
local BOX_CT_S          = BOX_S+1 -- first index after the ui.cmd_box_ct header.

--[[local]] function cmd_next_ext_i(a, i)
	local cmd = a[i-1]
	if cmd.is_ct then --box container
		return i+a[i+BOX_CT_NEXT_EXT_I]
	end
	return cmd_next_i(a, i)
end

-- NOTE: `ct` is short for container, which must end with ui.end_CMD().
function ui.cmd_box_ct(cmd, fr, halign, valign, min_w, min_h, ...)
	--begin_scope()
	local i = ui.cmd_box(cmd, fr, halign, valign, min_w, min_h,
		0, --next_ext_i
		...
	)
	add(ct_stack, i)
	return i
end

local function box_ct_end_measure(a, _, axis)
	local i = assert(del(ct_stack), 'end command outside a container')
	local cmd = a[i-1]
	local measure_end_f = cmd.measure_end
	if measure_end_f then
		measure_end_f(a, i, axis)
	else
		local user_min_w = a[i+0+axis]
		local min_w      = a[i+2+axis]
		min_w = max(min_w, user_min_w)
		a[i+2+axis] = min_w
		add_ct_min_wh(a, axis, min_w)
	end
end

local function box_ct_end_draw(a, i)
	local ct_i = i+a[i+0]
	local draw_end_f = a[ct_i-1].draw_end
	if draw_end_f then
		draw_end_f(a, ct_i)
	end
end

local function box_ct_widget_end(cmd, t)
	return ui.widget('end_'..cmd, {

		is_end = true,

		create = function(end_cmd)
			--end_scope()
			local ct_i = assert(del(ct_stack), 'end command outside container')
			local end_i = ui.cmd(end_cmd, ct_i)
			a[end_i+0] = a[end_i+0] - end_i -- make relative
			local next_i = cmd_next_i(a, end_i)
			a[ct_i+BOX_CT_NEXT_EXT_I] = next_i - ct_i -- next_i but relative to the ct cmd at ct_i
			if a[ct_i-1].name == 'popup' then --TOOD: make this non-specific
				end_layer()
			end
		end,

		measure = box_ct_end_measure,

		draw = box_ct_end_draw,

	})
end

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
	i = cmd_next_i(a, i)
	while 1 do
		local cmd = a[i-1]
		if cmd.is_end then break end
		local translate_f = cmd.translate
		if translate_f then
			translate_f(a, i, dx, dy)
		end
		i = cmd_next_ext_i(a, i)
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
	box_ct_widget_end(cmd)
	return ui.box_widget(cmd, update({
		is_ct = true,
		measure = ct_stack_push,
		translate = box_ct_translate,
	}, t))
end

-- flex ----------------------------------------------------------------------

local function is_last_flex_child(a, i)
	while 1 do
		i = cmd_next_ext_i(a, i)
		if a[i-1].is_box then return false end
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
		while 1 do
			local cmd = a[i-1]
			if cmd.is_end then break end
			if cmd.is_box then
				total_fr = total_fr + a[i+FR]
				n = n + 1
			end
			i = cmd_next_ext_i(a, i)
		end

		if total_fr == 0 then
			total_fr	= 1
		end

		-- compute total overflow width and total free width.
		local total_w = sw
		local total_overflow_w = 0
		local total_free_w     = 0
		i = next_i
		while 1 do
			local cmd = a[i-1]
			if cmd.is_end then break end
			if cmd.is_box then

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
		while 1 do
			local cmd = a[i-1]
			if cmd.is_end then break end
			if cmd.is_box then

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
					sw = ct_sw - (sx - ct_sx)
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

local function flex(hv)
	return ui.box_ct_widget(hv, {
		main_axis = hv == 'h' and 0 or 1,
		create = function(cmd, fr, halign, valign, min_w, min_h)
			return ui.cmd_box_ct(cmd, fr, halign, valign, min_w, min_h)
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
	create = function(cmd, id, fr, halign, valign, min_w, min_h, bg)
		return ui.cmd_box_ct(cmd, fr, halign, valign, min_w, min_h,
			id or '', bg or false)
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
	draw = function(a, i)
		local bg = a[i+BOX_CT_S+1]
		if bg then
			local x  = a[i+0]
			local y  = a[i+1]
			local w  = a[i+2]
			local h  = a[i+3]
			scr_fill(x, y, w, h, nil, nil, bg)
		end
	end,
})

-- box -----------------------------------------------------------------------

ui.box_ct_widget('box', {

	create = function(cmd, title, fr, halign, valign, min_w, min_h, fg, bg, title_fg, title_bg)
		return ui.cmd_box_ct(cmd, fr or 1, halign, valign, min_w, min_h,
			title or '',
			fg or ui.border_color'light',
			bg or false,
			title_fg or ui.fg_color'title',
			title_bg or false
		)
	end,

	measure_end = function(a, i, axis)
		local user_min_wh     = a[i+0+axis]
		local children_min_wh = a[i+2+axis]
		local min_wh = max(user_min_wh, children_min_wh) + 2
		add_ct_min_wh(a, axis, min_wh)
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
			return true
		end
		if hit_box(a, i) then
			return true
		end
	end,

	draw = function(a, i)
		local x  = a[i+0]
		local y  = a[i+1]
		local w  = a[i+2]
		local h  = a[i+3]
		local title, fg, bg, title_fg, title_bg = unpack(a, i+BOX_CT_S+0, i+BOX_CT_S+2)
		scr_draw_box(x, y, w, h, fg, bg)
		if title ~= '' then
			scr_wr(x, y, title, title_fg, title_bg)
		end
	end,
})

--text box -------------------------------------------------------------------

local function measure_text(s)
	--TODO: break by graphemes
	return #s
end

local function word_wrapper()

	local s
	local words  = {} -- [word1,...]
	local widths = {} -- [w1,...]
	local lines  = {} -- [line1_i,line1_w,...]
	local ww = {lines = lines, words = words, widths = widths}
	local last_ct_w

	ww.set_text = function(s1)
		if s1 == s then return end
		array_clear(words )
		array_clear(widths)
		array_clear(lines )
		last_ct_w = nil
		s = sanitize(s1):trim()
	end

	-- skip spaces, advancing i1 to the first non-space char and i2
	-- to first space char after that, or to 1/0 if no space char was found.
	local i1
	local function skip_spaces(s)
		::again::
		local i3 = s:find(' ' , i1, true); if i3 == i1 then i1 = i1+1; goto again end
		local i4 = s:find('\n', i1, true); if i4 == i1 then i1 = i1+1; goto again end
		local i5 = s:find('\r', i1, true); if i5 == i1 then i1 = i1+1; goto again end
		local i6 = s:find('\t', i1, true); if i6 == i1 then i1 = i1+1; goto again end
		return repl(min(
			(i3 or 1/0)-1,
			(i4 or 1/0)-1,
			(i5 or 1/0)-1,
			(i6 or 1/0)-1
		), 1/0)
	end
	ww.measure = function()
		if not s then
			ww.w = 0
			ww.h = 1
			return
		end
		i1 = 1
		while 1 do
			local i2 = skip_spaces(s)
			local word = s:sub(i1, i2)
			add(words, word)
			if not i2 then break end
			i1 = i2 + 1
		end
		ww.min_w = 0
		for _,s in ipairs(words) do
			local w = measure_text(s)
			add(widths, w)
			ww.min_w = max(ww.min_w, w)
		end
	end

	ww.wrap = function(ct_w, align)
		if not s then return end
		if ct_w == last_ct_w then return end
		last_ct_w = ct_w
		array_clear(lines)
		local line_w = 0
		local max_line_w = 0
		local line_i = 1
		local sep_w = 0
		local n = #widths
		for i = 1, n+1 do
			local w = i <= n and widths[i] or 0
			if i == n+1 or ceil(line_w + sep_w + w) > ct_w then
				line_w = ceil(line_w)
				max_line_w = max(max_line_w, line_w)
				add(lines, line_i)
				add(lines, line_w)
				line_w = 0
				sep_w = 0
				line_i = i
			end
			line_w = line_w + sep_w + w
			sep_w = 1
		end
		local line_count = #lines / 2
		ww.w = ceil(max_line_w)
		ww.h = line_count
	end

	return ww
end

local TEXT_X        = BOX_S+0
local TEXT_W        = BOX_S+1 --input MAX_MIN_W, output TEXT_W
local TEXT_H        = BOX_S+2
local TEXT_ID       = BOX_S+3
local TEXT_S        = BOX_S+4
local TEXT_WRAP     = BOX_S+5
local TEXT_EDITABLE = BOX_S+6
local TEXT_FG       = BOX_S+7
local TEXT_BG       = BOX_S+8

ui.box_widget('text', {
	ID = TEXT_ID,
	create = function(cmd, id, s, fr, halign, valign, max_min_w, min_w, min_h, wrap, editable, fg, bg)
		-- NOTE: min_w and min_h are by default measured, not given.
		s = s or ''
		wrap = wrap or 'none'
		if wrap == 'line' then
			s = sanitize(s)
			if s:has'\n' or s:has'\r' then
				local text = s
				s = {}
				for line in text:lines'*l' do
					add(s, line)
				end
			end
		elseif wrap == 'word' then
			ui.keepalive(id)
			local t = ui.state(id)
			t.ww = t.ww or word_wrapper()
			t.ww.set_text(s)
			s = t.ww
		else
			s = sanitize(s):gsub('[\n\r\t ]+', ' '):trim()
			assert(wrap == 'none')
		end
		if editable then
			ui.keepalive(id)
			s = ui.state(id).text or s
		end
		return ui.cmd_box(cmd, fr or 1, halign or 'l', valign or 'c',
			min_w or -1, -- -1=auto
			min_h or -1, -- -1=auto
			0, --text_x
			max_min_w or 1/0,
			0, --text_h
			id or '',
			s or '',
			wrap,
			editable or false,
			fg or ui.fg_color'text',
			bg or false
		)
	end,
	measure = function(a, i, axis)
		local wrap = a[i+TEXT_WRAP]
		if wrap == 'word' then
			-- word-wrapping is the reason for splitting the layouting algorithm
			-- into interlaced per-axis measuring and positioning phases.
			local id = a[i+TEXT_ID]
			local ww = a[i+TEXT_S]
			if axis == 0 then
				ww.measure()
				local min_w = a[i+0]
				local max_min_w = a[i+TEXT_W]
				if min_w == -1 then
					min_w = ww.min_w
				end
				min_w = min(max_min_w, min_w)
				a[i+2] = min_w
			else
				local min_h = a[i+1]
				if min_h == -1 then
					min_h = ww.h
				end
				a[i+3] = min_h
				a[i+TEXT_H] = ww.h
			end
		elseif axis == 0 then
			-- measure everything once on the x-axis phase.
			local s = a[i+TEXT_S]
			local text_w
			local text_h
			if isstr(s) then -- single-line
				text_w = measure_text( s)
				text_h = 1
			else -- multi-line, pre-wrapped
				text_w = 0
				text_h = 0
				for _,ss in ipairs(s) do
					local w = measure_text(ss)
					text_w = max(text_w, w)
					text_h = text_h + 1
				end
			end
			local min_w = a[i+0]
			local min_h = a[i+1]
			local max_min_w = a[i+TEXT_W]
			if min_h == -1 then min_h = text_h end
			if min_w == -1 then min_w = text_w end
			min_w = min(max_min_w, min_w)
			a[i+2] = min_w
			a[i+3] = min_h
			a[i+TEXT_W] = text_w
			a[i+TEXT_H] = text_h
		end
		local min_wh = a[i+2+axis]
		add_ct_min_wh(a, axis, min_wh)
	end,
	position = function(a, i, axis, sx, sw)
		if axis == 0 then
			local wrap = a[i+TEXT_WRAP]
			if wrap == 'word' then
				local ww = a[i+TEXT_S]
				ww.wrap(sw)
				a[i+2] = ww.w
			else
				a[i+2] = a[i+TEXT_W] -- we're positioning text_w, not min_w!
			end
			-- store the segment we might have to clip the text to.
			a[i+TEXT_X] = sx
			a[i+TEXT_W] = sw
		else
			a[i+3] = a[i+TEXT_H] --we're positioning text_h, not min_h!
		end
		a[i+0+axis] = align_x(a, i, axis, sx, sw)
		a[i+2+axis] = align_w(a, i, axis, sw)
	end,
	translate = function(a, i, dx, dy)
		a[i+TEXT_X] = a[i+TEXT_X] + dx
		box_translate(a, i, dx, dy)
	end,
	hittest = function(a, i, recs)
		if hit_box(a, i) then
			ui.hover(a[i+TEXT_ID])
		end
	end,
	draw = function(a, i)
		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local s  = a[i+TEXT_S]
		local sx = a[i+TEXT_X]
		local sw = a[i+TEXT_W]
		local id = a[i+TEXT_ID]
		local wrap = a[i+TEXT_WRAP]
		local editable = a[i+TEXT_EDITABLE]
		local fg = a[i+TEXT_FG]
		local bg = a[i+TEXT_BG]
		if editable then
			local input = ui.state(id).input
			input.value = s
		end

		local clip = w > sw

		if clip then
			local h = a[i+3]
			scr_clip(sx, y, sw, h)
		end

		--TODO: cx.textAlign = 'left'

		if isstr(s) then

			scr_wr(x, y, s, fg, bg)

		elseif wrap == 'line' then

			for _,ss in ipairs(s) do
				scr_wr(x, y, ss, fg, bg)
				y = y + 1
			end

		elseif wrap == 'word' then

			local halign = a[i+ALIGN]
			local x0 = x
			local ww = s

			for k = 1, #ww.lines, 2 do

				local i1     = ww.lines[k]
				local line_w = ww.lines[k+1]
				local i2     = ww.lines[k+2] or #ww.words+1

				local x
				if halign == 'r' then
					x = x0 + w - line_w
				elseif halign == 'c' then
					x = x0 + round((w - line_w) / 2)
				else
					x = x0
				end

				for i = i1, i2-1 do
					local s1 = ww.words [i]
					local w1 = ww.widths[i]
					scr_wr(x, y, s1, fg, bg)
					x = x + w1 + 1
				end
				y = y + 1
			end
		end

		if clip then
			scr_clip_end()
		end
	end,
})

ui.input = function(id, s, fr, halign, valign, max_min_w, min_w, min_h, fg, bg)
	return ui.text(id, s, fr, halign, valign, max_min_w, min_w, min_h, nil, true, fg, bg)
end
ui.text_lines = function(id, s, fr, halign, valign, max_min_w, min_w, min_h, editable, fg, bg)
	return ui.text(id, s, fr, halign, valign, max_min_w, min_w, min_h, 'line', editable, fg, bg)
end
ui.text_wrapped = function(id, s, fr, halign, valign, max_min_w, min_w, min_h, editable, fg, bg)
	return ui.text(id, s, fr, halign, valign, max_min_w, min_w, min_h, 'word', editable, fg, bg)
end

-- scrollbox -----------------------------------------------------------------

local SB_TITLE      = BOX_CT_S+0
local SB_OVERFLOW   = BOX_CT_S+1 -- overflow x,y
local SB_CW         = BOX_CT_S+3 -- content w,h
local SB_ID         = BOX_CT_S+5
local SB_SX         = BOX_CT_S+6 -- scroll x,y
local SB_STATE      = BOX_CT_S+8 -- hit state x,y
local SB_BOX_FG     = BOX_CT_S+9
local SB_BOX_BG     = BOX_CT_S+10
local SB_TITLE_FG   = BOX_CT_S+11
local SB_TITLE_BG   = BOX_CT_S+12

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

local function scrollbox_geometry(a, i)
	local x  = a[i+0]
	local y  = a[i+1]
	local w  = a[i+2]
	local h  = a[i+3]
	local cw = a[i+SB_CW+0]
	local ch = a[i+SB_CW+1]
	local sx = a[i+SB_SX+0]
	local sy = a[i+SB_SX+1]
	local boxed = a[i+SB_TITLE]
	local overflow_x = a[i+SB_OVERFLOW+0]
	local overflow_y = a[i+SB_OVERFLOW+1]
	if overflow_x == 'infinite' then
		cw = w * 4
		a[i+SB_CW+0] = cw
		overflow_x = 'scroll'
	end
	if overflow_y == 'infinite' then
		ch = h * 4
		a[i+SB_CW+1] = ch
		overflow_y = 'scroll'
	end

	--compute scrollbar visibility and resulting view (clip) rect
	local h_visible, v_visible
	if boxed then
		h_visible = overflow_x == 'scroll' or overflow_x == 'auto' and ((w - 2) / cw) < 1
		v_visible = overflow_y == 'scroll' or overflow_y == 'auto' and ((h - 2) / ch) < 1
		x = x + 1
		y = y + 1
		w = w - 2
		h = h - 2
	else
		h_visible = overflow_x == 'scroll' or overflow_x == 'auto' and (w / cw) < 1
		v_visible = overflow_y == 'scroll' or overflow_y == 'auto' and (h / ch) < 1
		if h_visible and not v_visible and overflow_y == 'auto' then
			--if h-scrollbar needs shown, it alone can make the v-scrollbar appear
			--because the view height shrinks by 1 to accomodate the h-scrollbar.
			v_visible = (h - 1) / ch < 1
		elseif v_visible and not h_visible and overflow_x == 'auto' then
			--same here with the v-scrollbar
			h_visible = (w - 1) / cw < 1
		end
		if h_visible then h = h - 1 end
		if v_visible then w = w - 1 end
	end

	if overflow_x == 'infinite' then sx = max(0, min(sx, cw - w)) end
	if overflow_y == 'infinite' then sy = max(0, min(sy, ch - h)) end

	--compute scroll bar thumb rectangles based also on sx,sy
	local h_tx, h_ty, h_tw, h_th
	if h_visible then
		local pw = w / cw
		local psx = clamp(sx / (cw - w), 0, 1)
		local bar_min_len = 2
		h_tw = max(min(bar_min_len, w), round(pw * w))
		h_th = 1
		h_tx = x + round(psx * (w - h_tw))
		h_ty = y + h
	end

	local v_tx, v_ty, v_tw, v_th
	if v_visible then
		local ph = h / ch
		local psy = clamp(sy / (ch - h), 0, 1)
		local bar_min_len = 1
		v_th = max(min(bar_min_len, h), round(ph * h))
		v_tw = 1
		v_ty = y + round(psy * (h - v_th))
		v_tx = x + w
	end

	return x, y, w, h, --view (clip) rect
		h_visible, h_tx, h_ty, h_tw, h_th, --h scroll bar thumb rect
		v_visible, v_tx, v_ty, v_tw, v_th  --v scroll bar thumb rect
end

function scrollbar_rect(a, i, axis)
	local x, y, w, h,
		h_visible, h_tx, h_ty, h_tw, h_th,
		v_visible, v_tx, v_ty, v_tw, v_th = scrollbox_geometry(a, i)
	if axis == 0 then
		return h_visible, h_tx, h_ty, h_tw, h_th
	else
		return v_visible, v_tx, v_ty, v_tw, v_th
	end
end

ui.box_ct_widget('scrollboxorstack', {

	create = function(cmd, id, title, fr,
		overflow_x, overflow_y,
		halign, valign, min_w, min_h,
		sx, sy,
		box_fg, box_bg,
		title_fg, title_bg)

		overflow_x = parse_sb_overflow(overflow_x)
		overflow_y = parse_sb_overflow(overflow_y)

		assert(id and id ~= '', 'id required for scrollbox')

		ui.keepalive(id)
		local ss = ui.state(id)
		sx = sx or ss.scroll_x or 0
		sy = sy or ss.scroll_y or 0

		local i = ui.cmd_box_ct(cmd, fr, halign, valign, min_w, min_h,
			title or false,
			overflow_x,
			overflow_y,
			0, 0, -- content w, h
			id,
			sx, -- scroll x
			sy, -- scroll y
			0, -- state
			box_fg or ui.border_color'light',
			box_bg or false,
			title_fg or ui.fg_color'title',
			fitle_bg or false
		)
		if sx ~= 0 then ss.scroll_x = sx end
		if sy ~= 0 then ss.scroll_y = sy end

		return i
	end,

	measure_end = function(a, i, axis)
		local user_min_w = a[i+0+axis]
		local co_min_w   = a[i+2+axis] -- measured content min_w
		local overflow = a[i+SB_OVERFLOW+axis]
		local contain = overflow == 'contain'
		local sb_min_w = max(contain and co_min_w or 0, user_min_w) -- scrollbox min_w
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

		local x, y, w, h = scrollbox_geometry(a, i)
		x = axis == 0 and x or y
		w = axis == 0 and w or h
		position_children_stacked(a, i, axis, x, max(content_w, w))
	end,

	translate = function(a, i, dx, dy)

		a[i+0] = a[i+0] + dx
		a[i+1] = a[i+1] + dy

		local x, y, w, h,
			h_visible, h_tx, h_ty, h_tw, h_th,
			v_visible, v_tx, v_ty, v_tw, v_th = scrollbox_geometry(a, i)

		local cw = a[i+SB_CW+0]
		local ch = a[i+SB_CW+1]
		local sx = a[i+SB_SX+0]
		local sy = a[i+SB_SX+1]
		local overflow_x = a[i+SB_OVERFLOW+0]
		local overflow_y = a[i+SB_OVERFLOW+1]

		local infinite_x = overflow_x == 'infinite'
		local infinite_y = overflow_y == 'infinite'

		if infinite_x then sx = max(0, min(sx, cw - w)) end
		if infinite_y then sy = max(0, min(sy, ch - h)) end

		local psx = sx / (cw - w)
		local psy = sy / (ch - h)

		local id = a[i+SB_ID]

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
		if ui.wheel_dy ~= 0 and ui.hit(id) then
			local sy0 = ui.state(id).scroll_y
			sy = sy - ui.wheel_dy * 3
			if not infinite_y then
				sy = clamp(sy, 0, max(0, ch - h))
			end
			ui.state(id).scroll_y = sy
			a[i+SB_SX+1] = sy
		end

		-- drag-scrolling
		local hit_state = 0
		if h_visible then
			local sbar_id = id..'.hscrollbar'
			local cs = ui.captured(sbar_id)
			local hs
			if cs then
				local psx0 = cs.psx0
				local dpsx = (ui.mx - ui.mx0) / (w - h_tw)
				sx = round((psx0 + dpsx) * (cw - w))
				if not infinite_x then
					sx = clamp(sx, 0, cw - w)
				end
				ui.state(id).scroll_x = sx
				a[i+SB_SX+0] = sx
			else
				hs = ui.hit(sbar_id)
				if hs then
					cs = ui.capture(sbar_id)
					if cs then
						cs.psx0 = psx
					end
				end
			end
			hit_state = bor(hit_state, shl((cs and 2 or (hs and 1 or 0)), 2 * 0))
		end
		if v_visible then
			local sbar_id = id..'.vscrollbar'
			local cs = ui.captured(sbar_id)
			local hs
			if cs then
				local psy0 = cs.psy0
				local dpsy = (ui.my - ui.my0) / (h - v_th)
				sy = round((psy0 + dpsy) * (ch - h))
				if not infinite_y then
					sy = clamp(sy, 0, max(0, ch - h))
				end
				ui.state(id).scroll_y = sy
				a[i+SB_SX+1] = sy
			else
				hs = ui.hit(sbar_id)
				if hs then
					cs = ui.capture(sbar_id)
					if cs then
						cs.psy0 = psy
					end
				end
			end
			hit_state = bor(hit_state, shl((cs and 2 or (hs and 1 or 0)), 2 * 1))
		end

		-- bits 0..1 = horiz state; bits 2..3 = vert. state.
		a[i+SB_STATE] = hit_state

		translate_children(a, i, dx - sx, dy - sy)

	end,

	draw = function(a, i)

		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]
		local title = a[i+SB_TITLE]
		if title then
			local fg = a[i+SB_BOX_FG]
			local bg = a[i+SB_BOX_BG]
			scr_draw_box(x, y, w, h, fg, bg)

			local fg = a[i+SB_TITLE_FG]
			local bg = a[i+SB_TITLE_BG]
			scr_wr(x + 2, y, title, fg, bg)
		end

		local x, y, w, h = scrollbox_geometry(a, i)

		scr_clip(x, y, w, h)

	end,

	draw_end = function(a, i)

		scr_clip_end()

		for axis = 0,1 do

			local state = band(shr(a[i+SB_STATE], (2 * axis)), 3)
			state = state == 2 and 'active' or state ~= 0 and 'hover' or nil

			local visible, tx, ty, tw, th = scrollbar_rect(a, i, axis)
			if visible then
				if axis == 0 then
					local fg = ui.bg_color('scrollbar', state)
					scr_fill(tx, ty, tw, th, '\u{2587}', fg)
				else
					local fg = ui.bg_color('scrollbar')
					local bg = ui.bg_color('scrollbar', state)
					scr_fill(tx, ty, tw, th, ' ', fg, bg)
				end
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
			if visible and rect_hit(ui.mx, ui.my, tx, ty, tw, th) then
				ui.hover(id..'.'..(axis == 0 and 'h' or 'v')..'scrollbar')
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

ui.scrollbox = ui.scrollboxorstack
function ui.scrollstack(id, ...)
	return ui.scrollboxorstack(id, false, ...)
end
ui.end_scrollbox   = ui.end_scrollboxorstack
ui.end_scrollstack = ui.end_scrollboxorstack
ui.sb = ui.scrollbox
ui.end_sb = ui.end_scrollbox

ui.end_scrollstack = ui.end_sb

-- line ----------------------------------------------------------------------

ui.box_widget('line', {
	create = function(cmd, fg, bg)
		return ui.cmd_box(cmd, 0, 's', 's', 1, 1,
			fg or ui.border_color'light',
			bg or false
			)
	end,
	draw = function(a, i)
		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]
		local fg = a[i+BOX_S+0]
		local bg = a[i+BOX_S+1]
		if w > h then
			scr_draw_hline(x, y, w, fg, bg)
		else
			scr_draw_vline(x, y, h, fg, bg)
		end
	end,
})

-- split ---------------------------------------------------------------------

local split_stack = {}

local function hvsplit(hv, id, size, unit, fixed_side,
	split_fr, halign, valign, min_w, min_h
)

	local snap_px = 5
	local splitbar_w = 1

	local horiz = hv == 'h'
	local W = horiz and 'w' or 'h'
	local state, dx, dy = ui.drag(id)
	ui.keepalive(id)
	local s = ui.state(id)
	local cs = ui.captured(id)
	local max_size = (cs and cs[W] or s[W] or 1/0) - splitbar_w
	assert(not unit or unit == 'px' or unit == '%')
	local fixed = unit == 'px'
	size = s.size or size
	local fr = fixed and 0 or (size or 0.5)
	local min_size = fixed and size or 0
	if state and state ~= 'hover' then
		if state == 'drag' then
			cs[W] = s[W]
		end
		local size_px = fixed and min_size or round(fr * max_size)
		size_px = size_px + (horiz and dx or dy)
		if size_px < snap_px then
			size_px = 0
		elseif size_px > max_size - snap_px then
			size_px = max_size
		end
		size_px = min(size_px, max_size)
		if fixed then
			min_size = size_px
		else
			fr = size_px / max_size
		end
		if state == 'drop' then
			s.size = fixed and min_size or fr
		end
	end

	ui[hv](split_fr, halign, valign, min_w, min_h)

	if state then
		ui.measure(id)
	end

	-- TODO: because max_size is not available on the first frame,
	-- the `collapsed` state can be wrong on the first frame! find a way...
	local collapsed
	if fixed then
		collapsed = min_size == 0 or (max_size and min_size == max_size)
	else
		collapsed = fr == 0 or fr == 1
	end

	append(split_stack, hv, id, collapsed, fixed and 1 or 1 - fr)

	ui.scrollstack(id..'.scrollbox1', fr, nil, nil, nil, nil, nil, min_size)

	return size
end
ui.hsplit = function(...) return hvsplit('h', ...) end
ui.vsplit = function(...) return hvsplit('v', ...) end

ui.box_widget('splitbar_bar', {

	ID = BOX_S+1,

	create = function(cmd, hv, id, collapsed, fr2)
		local st = ui.hit(id) and 'hover' or nil
		return ui.cmd_box(cmd, 0, 's', 's', 1, 1, hv, id)
	end,

	measure = function(a, i, axis)
		local min_wh = 1
		a[i+2+axis] = min_wh
		add_ct_min_wh(a, axis, min_wh)
	end,

	draw = function(a, i)
		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]
		local hv = a[i+BOX_S+0]
		local id = a[i+BOX_S+1]
		local fg0 = fg_color
		local state = ui.hit(id) and 'hover' or ui.captured(id) and 'active' or nil
		local fg = ui.border_color('light', state)
		if hv == 'h' then
			scr_draw_hline(x, y, w, fg)
			--draw handle
			local hls0, vls0 = scr_set_line_style'double'
			scr_draw_hline(x + 10, y, w - 20, fg)
			scr_set_line_style(hls0, vls0)
		else
			scr_draw_vline(x, y, h, fg)
			--draw handle
			local hls0, vls0 = scr_set_line_style'double'
			local hh = min(h, 2)
			local y = y + round((h - hh) / 2)
			scr_draw_vline(x, y, hh, fg)
			scr_set_line_style(hls0, vls0)
		end
		fg_color = fg0
	end,

})

ui.splitter = function()
	ui.end_scrollstack()
	local hv, id, collapsed, fr2 = unpack(split_stack, #split_stack-3)
	ui.splitbar_bar(hv == 'v' and 'h' or 'v', id, collapsed, fr2)
	ui.scrollstack(id..'.scrollbox2', fr2)
end

local function end_hvsplit(hv)
	ui.end_scrollstack()
	if hv == 'h' then
		ui.end_h()
	else
		ui.end_v()
	end
	popn(split_stack, 4)
end
ui.end_hsplit = function() end_hvsplit('h') end
ui.end_vsplit = function() end_hvsplit('v') end

-- popup ---------------------------------------------------------------------

local POPUP_ID        = FR      -- because fr is not used
local POPUP_SIDE      = ALIGN   -- because align is not used
local POPUP_ALIGN     = ALIGN+1 -- because valign is not used
local POPUP_LAYER_I   = BOX_CT_S+0
local POPUP_TARGET_I  = BOX_CT_S+1
local POPUP_FLAGS     = BOX_CT_S+2
local POPUP_SIDE_REAL = BOX_CT_S+3

function set_z_index(a, i, z_index)
	assert(a[i-1] == CMD_POPUP)
	i = cmd_next_i(a, i)
	assert(a[i-1] == CMD_SET_LAYER)
	a[i+SET_LAYER_Z_INDEX] = z_index
end
ui.set_z_index = set_z_index

-- a popup's target rect is the target's border rect.
local screen_margin = 10
function ui.popup_target_rect(a, i)

	local tx1, ty1, tx2, ty2
	local ct_i = a[i+POPUP_TARGET_I]

	if not ct_i then

		local d = screen_margin
		tx1 = d
		ty1 = d
		tx2 = screen_w - d
		ty2 = screen_h - d

	else

		ct_i = ct_i + i -- make absolute

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

function position_popup(w, h, side, align)

	local x, y
	local tw = tx2 - tx1
	local th = ty2 - ty1

	if side == 'r' then
		x = tx2
		y = ty1
	elseif side == 'l' then
		x = tx1 - w
		y = ty1
	elseif side == 't' then
		x = tx1
		y = ty1 - h
	elseif side == 'b' then
		x = tx1
		y = ty2
	elseif side == 'ir' then
		x = tx2 - w
		y = ty1
	elseif side == 'il' then
		x = tx1
		y = ty1
	elseif side == 'it' then
		x = tx1
		y = ty1
	elseif side == 'ib' then
		x = tx1
		y = ty2 - h
	elseif side == 'ic' then
		x = tx1 + round((tw - w) / 2)
		y = ty1 + round((th - h) / 2)
	else
		assert(false)
	end

	local sdx = side == 'l' or side == 'r'
	local sdy = side == 't' or side == 'b'

	if align == 'c' and sdy ~= 0 then
		x = x + round((tw - w) / 2)
	elseif align == 'c' and sdx then
		y = y + round((th - h) / 2)
	elseif align == ']' and sdy then
		x = x + tw - w
	elseif align == ']' and sdx then
		y = y + th - h
	end

	return x, y
end

ui.box_ct_widget('popup', {

	create = function(cmd, id, layer, target, side, align, min_w, min_h, flags, z_index)
		layer = ui_layer(layer)
		local target_i = target == 'screen' and 0
			or (not target or target == 'container' and ui.ct_i())
			or assert(num(target), 'invalid target ', target)
		side  = side or 't'
		align = align or 'c'
		flags = flags or ''

		local i = ui.cmd_box_ct(CMD_POPUP,
			nil, -- fr -> id
			nil, -- halign -> side
			nil, -- valign -> align
			min_w, min_h,
			-- BOX_CT_S+0
			layer.i,
			target_i,
			flags,
			side -- side_real
		)
		if target_i then
			a[i+POPUP_TARGET_I] = a[i+POPUP_TARGET_I] - i -- make relative
		end
		a[i+POPUP_ID   ] = id
		a[i+POPUP_SIDE ] = side
		a[i+POPUP_ALIGN] = align
		begin_layer(layer, i, z_index)
		return i
	end,

	measure_end = function(a, i, axis)
		a[i+2+axis] = max(a[i+2+axis], a[i+0+axis]) -- apply own min_w|h
		-- popups don't affect their target's layout so no add_ct_min_wh() call.
	end,

	-- NOTE: popup positioning is done later in the translation phase.
	-- NOTE: sw is always 0 because popups have fr=0, so we don't use it.
	position = function(a, i, axis, sx, sw)

		-- stretched popups stretch to the dimensions of their target.
		local target_i = a[i+POPUP_TARGET_I]
		local side     = a[i+POPUP_SIDE]
		local align    = a[i+POPUP_ALIGN]
		if side ~= 'c' and align == 's' then
			if not target_i then
				a[i+2+axis] = (axis == 0 and screen_w or screen_h) - 2*screen_margin
			else
				-- TODO: align border rects here!
				target_i = target_i + i -- make absolute
				local ct_w = a[target_i+2+axis]
				a[i+2+axis] = max(a[i+2+axis], ct_w)
			end
		end

		local w = inner_w(a, i, axis, a[i+2+axis])
		a[i+2+axis] = w
		position_children_stacked(a, i, axis, 0, w)
	end,

	translate = function(a, i)

		local bw = screen_w
		local bh = screen_h

		get_popup_target_rect(a, i)

		local w     = a[i+2+0]
		local h     = a[i+2+1]
		local side  = a[i+POPUP_SIDE]
		local align = a[i+POPUP_ALIGN]
		local flags = a[i+POPUP_FLAGS]

		local x, y = position_popup(w, h, side, align)

		if flags:has'change_side' then

			-- if popup doesn't fit the screen, first try to change its side
			-- or alignment and relayout, and if that doesn't work, its offset.

			local d = screen_margin
			local out_x1 = x < d
			local out_y1 = y < d
			local out_x2 = x + w > (bw - d)
			local out_y2 = y + h > (bh - d)

			local side0 = side
			if side == 'b' and out_y2 then
				side = 't'
			 elseif side == 't' and out_y1 then
				side = 'b'
			 elseif side == 'r' and out_x2 then
				side = 'l'
			 elseif side == 'l' and out_x1 then
				side = 'r'
			end

			if side ~= side0 then
				x, y = position_popup(w, h, side, align)
				a[i+POPUP_SIDE_REAL] = side
			end

		end

		-- if nothing else works, adjust the offset to fit the screen.
		-- TODO: actually we should adjust the offset to fit the current viewport
		-- computed from all parent scrollboxes.
		if flags:has'constrain' then
			local d = screen_margin
			local ox1 = min(0, x - d)
			local oy1 = min(0, y - d)
			local ox2 = max(0, x + w - (bw - d))
			local oy2 = max(0, y + h - (bh - d))
			x = x - (ox1 ~= 0 and ox1 or ox2)
			y = y - (oy1 ~= 0 and oy1 or oy2)
		end

		a[i+0] = x
		a[i+1] = y
		a[i+2] = w
		a[i+3] = h

		translate_children(a, i, x, y)

	end,

	draw = function(a, i)
		local popup_layer_i = a[i+POPUP_LAYER_I]
		if popup_layer_i ~= current_layer_i then
			return true -- not our layer, skip
		end
	end,

	hittest = function(a, i, recs)
		local popup_layer_i = a[i+POPUP_LAYER_I]
		local popup_layer = layer_arr[popup_layer_i]
		if popup_layer ~= current_layer then
			return -- not our layer, skip
		end
		if hit_children(a, i, recs) then
			ui.hover(a[i+POPUP_ID])
			return true
		end
	end,

})

-- frame widget --------------------------------------------------------------

local FRAME_ON_MEASURE = BOX_S+0
local FRAME_ON_FRAME   = BOX_S+1
local FRAME_CT_I       = BOX_S+2
local FRAME_REC_I      = BOX_S+3
local FRAME_LAYER_I    = BOX_S+4
local FRAME_ARGS_I     = BOX_S+5

ui.FRAME_ARGS_I = FRAME_ARGS_I

ui.box_widget('frame', {

	create = function(cmd, on_measure, on_frame,
		fr, align, valign, min_w, min_h, ...)

		local ct_i = ui.ct_i()
		local rel_ct_i = ui.rel_ct_i()
		assert(a[ct_i-1].name == 'scrollbox', 'frame is not inside a scrollbox')

		return ui.cmd_box(cmd, fr, align, valign, min_w, min_h,
			on_measure, on_frame,
			rel_ct_i,
			0, --rec_i
			current_layer.i,
			...
		)
	end,

	measure = function(a, i, axis)
		local on_measure = a[i+FRAME_ON_MEASURE]
		local min_w = on_measure(axis)
		if min_w ~= nil then
			add_ct_min_wh(a, axis, min_w)
		end
		box_measure(a, i, axis)
	end,

	translate = function(a, i, dx, dy)

		box_translate(a, i, dx, dy)

		local x = a[i+0]
		local y = a[i+1]
		local w = a[i+2]
		local h = a[i+3]

		local ct_i = i+a[i+FRAME_CT_I]
		local cx = a[ct_i+0]
		local cy = a[ct_i+1]
		local cw = a[ct_i+2]
		local ch = a[ct_i+3]

		local on_frame = a[i+FRAME_ON_FRAME]
		local a0 = begin_rec()
			a[i+FRAME_REC_I] = rec_i
			local prev_layer = current_layer
			local layer_i = a[i+FRAME_LAYER_I]
			current_layer = layer_arr[layer_i]
			ui.stack()
				on_frame(a, i, x, y, w, h, cx, cy, cw, ch)
			ui.end_stack()
			current_layer = prev_layer
			ct_stack_check()
		local a1 = end_rec(a0)
		layout_rec(a1, x, y, w, h)
	end,

	draw = function(a, i, recs)
		local layer_i = a[i+FRAME_LAYER_I]
		--[[global]] current_layer_i = layer_i
		local rec_i = a[i+FRAME_REC_I]
		local a1 = recs[rec_i]
		draw_cmd(a1, 2, recs)
	end,

	hit = function(a, i, recs)
		local layer_i = a[i+FRAME_LAYER_I]
		--[[global]] current_layer = layer_arr[layer_i]
		local rec_i = a[i+FRAME_REC_I]
		local a1 = recs[rec_i]
		local hit_f = hittest[a1[1]]
		return hit_f and not (a.nohit_set and a.nohit_set[i]) and hit_f(a1, 2, recs)
	end,

})

--list widget ----------------------------------------------------------------

function ui.list(id, items, fr, halign, valign, min_w, min_h)
	ui.v(fr or 0, halign or 'l', valign or 't', min_w, min_h)
	local hit_i = num(ui.hit_match(id..'.item'))
	local sel_i = ui.state(id).selected_i
	if hit_i and ui.click then
		sel_i = hit_i
		ui.state(id).selected_i = hit_i
	end
	for i,s in ipairs(items) do
		local item_id = id..'.item'..i
		local hit = hit_i == i
		local sel = sel_i == i
		local fg
		local bg =
			sel and ui.bg_color('item', 'item-focused item-selected focused')
			or ui.bg_color('bg', hit and 'hover' or nil)
		ui.stack(item_id, 0, 's', 't', 0, 0, bg)
			ui.text('', s)
		ui.end_stack()
	end
	ui.end_v()
end

--main -----------------------------------------------------------------------

function ui.start()

	tc_set_raw_mode()
	assert(tc_get_raw_mode(), 'could not put terminal in raw mode')

	wr'\27[?1049h' --enter alternate screen
	wr'\27[?7l'    --disable line wrapping
	wr'\27[?1004l' --enable window focus events
	wr'\27[?1000h' --enable mouse tracking
	wr'\27[?1003h' --enable mouse move tracking
	wr'\27[?1006h' --enable SGR mouse tracking
	wr'\27[?25l'   --hide cursor
	wr'\27]11;?\7' --get terminal background color
	wr_flush()

	scr_resize()
	scr_clip_reset()

	--signals thread to capture Ctrl+C and terminal window resize events.
	resume(thread(function()
		signal_block'SIGWINCH SIGINT'
		local sigf = signal_file('SIGWINCH SIGINT', true)
		while 1 do
			local si = sigf:read_signal()
			if si.signo == SIGWINCH then
				scr_resize()
				scr_clip_reset()
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

	wr'\27[?1004l' --stop window focus events
	wr'\27[?1000l' --stop mouse events
	wr'\27[?1003l' --stop mouse move events
	wr'\27[?1006l' --stop SGR mouse events
	wr'\27[?25h'   --show cursor
	wr'\27[?7h'    --enable line wrapping
	wr'\27[?1049l' --exit alternate screen
	wr_flush()

	tc_reset() --reset terminal

end
