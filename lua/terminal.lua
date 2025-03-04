-- nocurses.h - Provides a basic 'VT100 ESC sequences' printing without
-- the need to use ncurses. This is inspired by Borland conio.h
--  Author     - Rahul M. Juliato
--  Original   - 25 jun 2005
--  Revision   -    oct 2019

require'glue'

local function ESC(s) return '\x1b'..s end

local function printf(s, ...)
	return io.write(s:format(...))
end

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

--struct termsize {
--    int cols
--    int rows
--end

local bg_color   = BLACK
local font_color = WHITE
local font_bold  = FALSE

function wait()
	while fgetc(stdin) ~= '\n' do end
end

function clrscr()
	printf(ESC"[2J"..ESC"[?6h")
end

function gotoxy(x, y)
	printf(ESC"[%d%dH", y, x)
end

function setfontcolor(color)
	printf(ESC"[3%dm", color)
	font_color = color
end

function setbgrcolor(color)
	printf(ESC"[4%dm", color)
	bg_color = color
end


function setfontbold(status)
	printf(ESC"[%dm", status)
	font_bold = status
	setfontcolor(font_color)
	setbgrcolor(bg_color)
end

function setunderline(status)
	if status then status = 4 end
	printf(ESC"[%dm", status)
	setfontcolor(font_color)
	setbgrcolor(bg_color)
	setfontbold(font_bold)
end

function setblink(status)
	if status then status = 5 end
	printf(ESC"[%dm", status)
	setfontcolor(font_color)
	setbgrcolor(bg_color)
	setfontbold(font_bold)
end

function settitle(title)
	printf(ESC"]0%s\x07", title)
end

function setcurshape(shape)
	-- vt520/xterm-style linux terminal uses ESC[?123c, not implemented
	printf(ESC"[%d q", shape)
end

function gettermsize()
	local size
	if Windows then
		--CONSOLE_SCREEN_BUFFER_INFO csbi
		--GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &csbi)
		--size.cols = csbi.srWindow.Right - csbi.srWindow.Left + 1
		--size.rows = csbi.srWindow.Bottom - csbi.srWindow.Top + 1
	elseif Linux then
		--struct winsize win
		--ioctl(STDOUT_FILENO, TIOCGWINSZ, &win)
		--size.cols = win.ws_col
		--size.rows = win.ws_row
	else
		size.cols = 0
		size.rows = 0
	end
	return size
end

function getch()
	if Windows then
		--HANDLE input = GetStdHandle(STD_INPUT_HANDLE)
		--if (h == NULL) return EOF

		--DWORD oldmode
		--GetConsoleMode(input, &oldmode)
		--DWORD newmode = oldmode & ~(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT)
		--SetConsoleMode(input, newmode)
	elseif Linux then
		--struct termios oldattr, newattr
		--tcgetattr(STDIN_FILENO, &oldattr)
		--
		--newattr = oldattr
		--newattr.c_lflag &= ~(ICANON | ECHO)
		--tcsetattr(STDIN_FILENO, TCSANOW, &newattr)
	end
	local ch = getc(stdin)
	if Windows then
		--SetConsoleMode(input, oldmode)
	elseif Linux then
		tcsetattr(STDIN_FILENO, TCSANOW, oldattr)
	end
	return ch
end

function getche()
	if Windows then
		--HANDLE input = GetStdHandle(STD_INPUT_HANDLE)
		--if (h == NULL) return EOF
		--
		--DWORD oldmode
		--GetConsoleMode(input, &oldmode)
		--DWORD newmode = oldmode & ~ENABLE_LINE_INPUT
		--SetConsoleMode(input, newmode)
	elseif Linux then
		--struct termios oldattr, newattr
		--tcgetattr(STDIN_FILENO, &oldattr)
		--newattr = oldattr
		--newattr.c_lflag &= ~ICANON
		--tcsetattr(STDIN_FILENO, TCSANOW, &newattr)
	end
	local ch = getc(stdin)
	if Windows then
		--SetConsoleMode(input, oldmode)
	elseif Linux then
		tcsetattr(STDIN_FILENO, TCSANOW, oldattr)
	end
	return ch
end

function clrline()
	printf(ESC"[2K"..ESC"E")
end

function resetcolors()
	printf(ESC"001b"..ESC"[0m")
end
