-- nocurses.h - Provides a basic 'VT100 ESC sequences' printing without
-- the need to use ncurses. This is inspired by Borland conio.h
--  Author     - Rahul M. Juliato
--  Original   - 25 jun 2005
--  Revision   -    oct 2019

require'glue'
require'fs'
require'sock'
require'signal'
require'termios'

assert(Linux, 'not on Linux')

function o(str) return tonumber(str, 8) end

--writing and encoding -------------------------------------------------------

local function ESC(s) return '\x1b'..s end

function wr(s)
	return stdout:write(s)
end

local function wrf(s, ...)
	return stdout:write(s:format(...))
end

--[[
local BLACK   = 0
local RED     = 1
local GREEN   = 2
local YELLOW  = 3
local BLUE    = 4
local MAGENTA = 5
local CYAN    = 6
local WHITE   = 7

local BLOCK_BLINK     = 1
local BLOCK           = 2
local UNDERLINE_BLINK = 3
local UNDERLINE       = 4
local BAR_BLINK       = 5
local BAR             = 6

local TRUE  = 1
local FALSE = 0

local bg_color   = BLACK
local font_color = WHITE
local font_bold  = FALSE

function clrscr()
	wrf(ESC'[2J'..ESC'[?6h')
end

function gotoxy(x, y)
	wrf(ESC'[%d%dH', y, x)
end

function setfontcolor(color)
	wrf(ESC'[3%dm', color)
	font_color = color
end

function setbgrcolor(color)
	wrf(ESC'[4%dm', color)
	bg_color = color
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

function resetcolors()
	wrf(ESC'001b'..ESC'[0m')
end

]]

local DEBUG = false
local dbgf = DEBUG and wrf or noop

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

--self-test ------------------------------------------------------------------

if 1 then
	local w, h = get_window_size()
	signal_block'SIGWINCH SIGINT'
	local sigf = signal_file('SIGWINCH SIGINT', true)
	resume(thread(function()
		while true do
			local si = sigf:read_signal()
			if si.signo == SIGWINCH then
				w, h = get_window_size()
				wrf('window size: %d,%d\r\n', w, h)
			elseif si.signo == SIGINT then
				stop()
				break
			end
		end
	end))
	set_raw_mode(0)
	assert(get_raw_mode(0))
	wr'\027[?1000h' --enable mouse tracking
	wr'\027[?1006h' --enable SGR mouse tracking
	wr'\27[31mHello\27[0m\r\n'
	resume(thread(function()
		while 1 do
			local key
			local mx, my, mstate, scroll, ldown, lup, rdown, rup, mdown, mup
			local c = getc()
			if c == 27 then --\033
				c = wait_getc(.1)
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
			--clrscr()
			--flush_terminal(0, 2)
			--flush_terminal(1, 2)
			--flush_terminal(2, 2)
			if key then
				wrf('key: %s\r\n', key)
			elseif mx then
				wrf('mouse: %d,%d %s\r\n', mx, my,
					scroll == -1 and 'scroll-up' or scroll == 1 and 'scroll-down'
					or mstate)
			end
			if key == 'esc' then --Esc
				stop()
				break
			end
		end
	end))
	start()
	wr'\027[?1006l' --stop SGR mouse events
	wr'\027[?1000l' --stop mouse events
	reset_terminal(0)
end
