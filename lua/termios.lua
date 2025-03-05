--[=[

	termios binding.
	Written by Cosmin Apreutesei. Public Domain.

	https://www.man7.org/linux/man-pages/man3/termios.3.html

]=]

local ffi = require'ffi'

local new   = ffi.new
local band  = bit.band
local bor   = bit.bor
local C     = ffi.C
local Linux = ffi.os == 'Linux'

assert(Linux, 'not on Linux')

function o(str) return tonumber(str, 8) end

local TCSANOW   = 0
local TCSADRAIN = 1
local TCSAFLUSH = 2

--lflag bits
local ISIG    = o'0000001' -- Enable signals.
local ICANON  = o'0000002' -- Canonical input (erase and kill processing).
local XCASE   = o'0000004'
local ECHO    = o'0000010' -- Enable echo.
local ECHOE   = o'0000020' -- Echo erase character as error-correcting backspace.
local ECHOK   = o'0000040' -- Echo KILL.
local ECHONL  = o'0000100' -- Echo NL.
local NOFLSH  = o'0000200' -- Disable flush after interrupt or quit.
local TOSTOP  = o'0000400' -- Send SIGTTOU for background output.
local ECHOCTL = o'0001000' -- If ECHO is also set, terminal special characters other than TAB, NL, START, and STOP are echoed as ^X, where X is the character with ASCII code 0x40 greater than the special character (not in POSIX).
local ECHOPRT = o'0002000' -- If ICANON and ECHO are also set, characters are printed as they are being erased (not in POSIX).
local ECHOKE  = o'0004000' -- If ICANON is also set, KILL is echoed by erasing each character on the line, as specified by ECHOE and ECHOPRT (not in POSIX).
local FLUSHO  = o'0010000' -- Output is being flushed.  This flag is toggled by typing the DISCARD character (not in POSIX).
local PENDIN  = o'0040000' -- All characters in the input queue are reprinted when the next character is read (not in POSIX).
local IEXTEN  = o'0100000' -- Enable implementation-defined input processing.
local EXTPROC = o'0200000'

--iflag bits
local IGNBRK  = o'0000001' -- Ignore break condition.
local BRKINT  = o'0000002' -- Signal interrupt on break.
local IGNPAR  = o'0000004' -- Ignore characters with parity errors.
local PARMRK  = o'0000010' -- Mark parity and framing errors.
local INPCK   = o'0000020' -- Enable input parity check.
local ISTRIP  = o'0000040' -- Strip 8th bit off characters.
local INLCR   = o'0000100' -- Map NL to CR on input.
local IGNCR   = o'0000200' -- Ignore CR.
local ICRNL   = o'0000400' -- Map CR to NL on input.
local IUCLC   = o'0001000' -- Map uppercase characters to lowercase on input (not in POSIX).
local IXON    = o'0002000' -- Enable start/stop output control.
local IXANY   = o'0004000' -- Enable any character to restart output.
local IXOFF   = o'0010000' -- Enable start/stop input control.
local IMAXBEL = o'0020000' -- Ring bell when input queue is full (not in POSIX).
local IUTF8   = o'0040000' -- Input is UTF8 (not in POSIX).

--cflag bits
local CSIZE  = o'0000060'
local   CS5  = o'0000000'
local   CS6  = o'0000020'
local   CS7  = o'0000040'
local   CS8  = o'0000060'
local CSTOPB = o'0000100'
local CREAD  = o'0000200'
local PARENB = o'0000400'
local PARODD = o'0001000'
local HUPCL  = o'0002000'
local CLOCAL = o'0004000'

--oflag bits
local OPOST  = o'000001'  -- Post-process output.
local OLCUC  = o'000002'  -- Map lowercase characters to uppercase on output. (not in POSIX).
local ONLCR  = o'000004'  -- Map NL to CR-NL on output.
local OCRNL  = o'000010'  -- Map CR to NL on output.
local ONOCR  = o'000020'  -- No CR output at column o'.
local ONLRET = o'000040'  -- NL performs CR function.
local OFILL  = o'000100'  -- Use fill characters for delay.
local OFDEL  = o'000200'  -- Fill is DEL.
local NLDLY  = o'000400'  -- Select newline delays:
local   NL0  = o'000000'  -- Newline type o'.
local   NL1  = o'000400'  -- Newline type 1.
local CRDLY  = o'003000'  -- Select carriage-return delays:
local   CR0  = o'000000'  -- Carriage-return delay type o'.
local   CR1  = o'001000'  -- Carriage-return delay type 1.
local   CR2  = o'002000'  -- Carriage-return delay type 2.
local   CR3  = o'003000'  -- Carriage-return delay type 3.
local TABDLY = o'014000'  -- Select horizontal-tab delays:
local   TAB0 = o'000000'  -- Horizontal-tab delay type o'.
local   TAB1 = o'004000'  -- Horizontal-tab delay type 1.
local   TAB2 = o'010000'  -- Horizontal-tab delay type 2.
local   TAB3 = o'014000'  -- Expand tabs to spaces.
local BSDLY  = o'020000'  -- Select backspace delays:
local   BS0  = o'000000'  -- Backspace-delay type o'.
local   BS1  = o'020000'  -- Backspace-delay type 1.
local FFDLY  = o'100000'  -- Select form-feed delays:
local   FF0  = o'000000'  -- Form-feed delay type o'.
local   FF1  = o'100000'  -- Form-feed delay type 1.
local VTDLY  = o'040000'  -- Select vertical-tab delays:
local   VT0  = o'000000'  -- Vertical-tab delay type o'.
local   VT1  = o'040000'  -- Vertical-tab delay type 1.
local XTABS  = o'014000'

-- cc offsets
local VINTR    =  0
local VQUIT    =  1
local VERASE   =  2
local VKILL    =  3
local VEOF     =  4
local VTIME    =  5
local VMIN     =  6
local VSWTC    =  7
local VSTART   =  8
local VSTOP    =  9
local VSUSP    = 10
local VEOL     = 11
local VREPRINT = 12
local VDISCARD = 13
local VWERASE  = 14
local VLNEXT   = 15
local VEOL2    = 16

ffi.cdef[[
int isatty(int fd);

struct termios {
	unsigned int c_iflag;
	unsigned int c_oflag;
	unsigned int c_cflag;
	unsigned int c_lflag;
	unsigned char c_line;
	unsigned char c_cc[32];
	unsigned int c_ispeed;
	unsigned int c_ospeed;
};

int tcgetattr(int fd, struct termios *term);
int tcsetattr(int fd, int optional_actions, const struct termios *term);
int tcflush(int fd, int queue_selector);
int tcdrain(int fd);
int tcsendbreak(int fd, int duration);

int ioctl(int fd, unsigned long, ...);
]]

function isatty(fd)
	local is = C.isatty(fd)
	assert(check_errno(is ~= -1))
	return is == 1
end

local term = new'struct termios'

local function tcgetattr(fd)
	assert(check_errno(C.tcgetattr(fd, term) ~= -1))
end

local function tcsetattr(fd)
	assert(check_errno(C.tcsetattr(fd, TCSANOW, term) ~= -1))
end

function set_raw_mode(fd)
	tcgetattr(fd)

	-- disable canonical mode (input line buffering) and echo
	term.c_lflag = band(term.c_lflag, bnot(ICANON))
	term.c_lflag = band(term.c_lflag, bnot(ECHO))
	term.c_oflag = band(term.c_oflag, bnot(OPOST))  -- Disable output processing
	term.c_iflag = band(term.c_iflag, bnot(ICRNL))  -- Disable CR -> NL conversion
	term.c_iflag = band(term.c_iflag, bnot(ISIG))   -- Disable signals like Ctrl+C
	term.c_iflag = band(term.c_iflag, bnot(IEXTEN)) -- Disable extended input processing

	term.c_cc[VMIN ] = 1 -- read one byte at a time
	term.c_cc[VTIME] = 0 -- no timeout

	tcsetattr(fd)
end

function get_raw_mode(fd)
	tcgetattr(fd)
	return band(term.c_lflag, ICANON) == 0
end

-- Function to reset terminal to original state
function reset_terminal(fd)
	tcgetattr(fd)

	term.c_lflag = bor(term.c_lflag, ICANON)
	term.c_lflag = bor(term.c_lflag, ECHO)
	term.c_oflag = bor(term.c_oflag, OPOST)  -- Re-enable output processing
	term.c_iflag = bor(term.c_iflag, ICRNL)  -- Re-enable CR -> NL conversion
	term.c_iflag = bor(term.c_iflag, ISIG)   -- Enable signals like Ctrl+C
	term.c_iflag = bor(term.c_iflag, IEXTEN) -- Enable extended input processing

	tcsetattr(fd)
end

function flush_terminal(fd, queue)
	assert(check_errno(C.tcflush(fd, queue) ~= -1))
end

function drain_terminal(fd)
	assert(check_errno(C.tcdrain(fd) ~= -1))
end

function send_break(fd, duration)
	assert(check_errno(C.tcsendbreak(fd, duration) ~= -1))
end


if not ... then
	require'fs'

	local fd = 0
	assertf(isatty(fd), 'fd %d is not a tty', fd)

	print'\27[31mHello\27[0m'
	set_raw_mode(fd)
	reset_terminal(fd)

	-- Flush terminal input and output buffers
	-- flush_terminal(fd, 0)  -- 0 for input buffer
	-- flush_terminal(fd, 1)  -- 1 for output buffer
	-- flush_terminal(fd, 2)  -- 2 for both

	-- Drain terminal output buffer
	-- drain_terminal(fd)

	-- Send break signal (duration in microseconds)
	-- send_break(fd, 0)  -- No break
end
