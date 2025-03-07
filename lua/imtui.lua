--[[

	Immediate Mode Text User Interface library for Linux terminals.
	Written by Cosmin Apreutesei. Public Domain.

]]

require'glue'
require'fs'
require'sock'
require'signal'
require'termios'

assert(Linux, 'not on Linux')

function o(str) return tonumber(str, 8) end

local DEBUG = false

--writing and encoding -------------------------------------------------------

local function ESC(s) return '\x1b'..s end

local TERM = env'TERM'
local is_256_color =
	TERM == 'xterm-256color' or
	TERM == 'screen-256color'

function wr(s)
	return stdout:write(s)
end

local function wrf(s, ...)
	return stdout:write(s:format(...))
end

local dbgf = DEBUG and wrf or noop

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
local function hsl_to_ansi_color(h, s, l)
	if s > .5 then
		return hue_to_ansi_color(h)
	elseif l > .75 then --grayscale: 0, 8, 7, 15
		return 15 -- bright white
	elseif l > .5 then
		return 7 --white
	elseif l > .25 then
		return 8 --bright black (gray)
	else
		return 0 --black
	end
end
local function hsl_to_256_color(h, s, l)
	if s > 0 then --saturated, use the 6x6x6 color cube.
		local r, g, b = hsl_to_rgb(h, s, l)
		--scale the rgb values to the range of 0-5.
		r = floor(r * 5 + 0.5)
		g = floor(g * 5 + 0.5)
		b = floor(b * 5 + 0.5)
		return 16 + (r * 36) + (g * 6) + b
	elseif l == 0 then --grayscale (24 gray levels) + 0 (black) + 15 (white)
		return 0 --black
	elseif l == 1 then
		return 15 -- white
	else --gray
		return floor(232 + (intensity / 255) * 23)
	end
end
local function hsl_to_color(h, s, l)
	if is_256_color then
		return hsl_to_256_color(h, s, l)
	else
		return hsl_to_ansi_color(h, s, l)
	end
end

local bg_color = hsl_to_color(0, 0, 0)
local fg_color = hsl_to_color(0, 0, 1)

local function bg(h, s, l)
	local color = hsl_to_color(h, s, l)
	if bg_color == color then return end
	wrf(ESC(is_256_color and '[48;5;%dm' or '[4%dm', color))
	bg_color = color
end

local function fg(h, s, l)
	local color = hsl_to_color(h, s, l)
	if fg_color == color then return end
	wrf(ESC(is_256_color and '[38;5;%dm' or '[3%dm', color))
	fg_color = color
end

local function gotoxy(x, y)
	wrf(ESC'[%d%dH', y, x)
end

local function resetcolors()
	wrf(ESC'001b'..ESC'[0m')
end

function redraw()
	resetcolors()
	--clrscr()
	--flush_terminal(0, 2)
	--flush_terminal(1, 2)
	--flush_terminal(2, 2)
	if key then
		wrf('key: %s\r\n', key)
	elseif scroll or mstate then
		wrf('mouse: %d,%d %s\r\n', mx, my,
			scroll == -1 and 'scroll-up' or scroll == 1 and 'scroll-down'
			or mstate)
	end
end

--[[

local font_bold = FALSE

local BLOCK_BLINK     = 1
local BLOCK           = 2
local UNDERLINE_BLINK = 3
local UNDERLINE       = 4
local BAR_BLINK       = 5
local BAR             = 6

local TRUE  = 1
local FALSE = 0

function clrscr()
	wrf(ESC'[2J'..ESC'[?6h')
end

function setfontbold(status)
	wrf(ESC'[%dm', status)
	font_bold = status
	setfontcolor(font_color)
	setbgrcolor(bg_color)
end

function setunderline(status)
	if status then status = 4 end
	wrf(ESC'[%dm', status)
	setfontcolor(font_color)
	setbgrcolor(bg_color)
	setfontbold(font_bold)
end

function setblink(status)
	if status then status = 5 end
	wrf(ESC'[%dm', status)
	setfontcolor(font_color)
	setbgrcolor(bg_color)
	setfontbold(font_bold)
end

function settitle(title)
	wrf(ESC']0%s\x07', title)
end

function setcurshape(shape)
	-- vt520/xterm-style linux terminal uses ESC[?123c, not implemented
	wrf(ESC'[%d q', shape)
end

function clrline()
	wrf(ESC'[2K'..ESC'E')
end

]]

--reading and decoding -------------------------------------------------------

local b = new'char[128]'
local function getc()
	stdin:readn(b, 1)
	if DEBUG then dbgf(' getc %s %s\r\n', b[0], char(b[0])) end
	return b[0]
end

local function readto(c1, c2)
	c1 = byte(c1)
	c2 = byte(c2)
	local z = 128
	local b0 = b
	local n = 0
	while z > 0 do
		local len, err = stdin:read(b, z)
		if DEBUG then dbgf('  readto %s or %s: %d "%s" %s\r\n', char(c1), char(c2), len, str(b, len), err or '') end
		assert(len, err)
		assert(len > 0, 'eof')
		n = n + len
		for i = 0,len-1 do
			if b[i] == c1 or b[i] == c2 then
				return str(b0, n)
			end
		end
		b = b + len
		z = z - len
	end
	assert(false)
end

local function wait_getc(timeout)
	stdin:settimeout(timeout)
	local len, err = stdin:try_read(b, 1)
	stdin:settimeout(nil)
	if not len and err == 'timeout' then
		if DEBUG then dbgf(' %s\r\n', 'timeout') end
		return nil
	else
		assert(len == 1)
	end
	if DEBUG then dbgf(' wait_getc %s %s\r\n', b[0], char(b[0])) end
	return b[0]
end

--main -----------------------------------------------------------------------

tc_set_raw_mode()
assert(tc_get_raw_mode(), 'could not put terminal in raw mode')

wr'\027[?1000h' --enable mouse tracking
wr'\027[?1006h' --enable SGR mouse tracking

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

key = nil
scroll = nil
mx, my = nil
mstate, ldown, lup, rdown, rup, mdown, mup = nil

--input thread
resume(thread(function()
	while 1 do
		key = nil
		scroll = nil
		local c = getc()
		if c == 27 then --\033
			c = wait_getc(.01)
			if not c then
				key = 'esc'
			elseif c == 91 then --[
				c = getc()
				if     c == 65 then
					key = 'up'
				elseif c == 66 then
					key = 'down'
				elseif c == 67 then
					key = 'right'
				elseif c == 68 then
					key = 'left'
				elseif c == 49 then
					c = getc()
					if     c == 49 then if getc() == 126 then key = 'f1' end
					elseif c == 50 then if getc() == 126 then key = 'f2' end
					elseif c == 51 then if getc() == 126 then key = 'f3' end
					elseif c == 52 then if getc() == 126 then key = 'f4' end
					elseif c == 53 then if getc() == 126 then key = 'f5' end
					elseif c == 55 then if getc() == 126 then key = 'f6' end
					elseif c == 56 then if getc() == 126 then key = 'f7' end
					elseif c == 57 then if getc() == 126 then key = 'f8' end
					elseif c == 126 then key = 'home'
					end
				elseif c == 50 then
					c = getc()
					if     c == 48 then if getc() == 126 then key = 'f9' end
					elseif c == 49 then if getc() == 126 then key = 'f10' end
					elseif c == 51 then if getc() == 126 then key = 'f11' end
					elseif c == 52 then if getc() == 126 then key = 'f12' end
					elseif c == 126 then key = 'insert'
					end
				elseif c == 51 then if getc() == 126 then key = 'delete' end
				elseif c == 52 then if getc() == 126 then key = 'end' end
				elseif c == 53 then if getc() == 126 then key = 'pageup' end
				elseif c == 54 then if getc() == 126 then key = 'pagedown' end
				elseif c == 60 then --<
					local s = readto('M', 'm')
					if DEBUG then dbgf('   "%s"\r\n', s) end
					local b, smx, smy, st = assert(s:match'^(%d+);(%d+);(%d+)([Mm])$')
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
					if DEBUG then dbgf('%d %d %s %s\r\n', mx, my, b, st) end
				end
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
		redraw()
		key = nil
		scroll = nil
	end
end))

start() --start the epoll loop (stopped by ctrl+C or a call to stop()).

wr'\027[?1006l' --stop SGR mouse events
wr'\027[?1000l' --stop mouse events

tc_reset() --reset terminal
