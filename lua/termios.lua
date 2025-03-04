--go@ ssh -tt root@10.0.0.8 -i c:\users\cosmin\.ssh\id_rsa "/mnt/x/sdk/bin/linux/luajit -ltermios -e return"
--[=[

	termios binding.
	Written by Cosmin Apreutesei. Public Domain.

]=]

local ffi = require'ffi'
local new  = ffi.new
local band = bit.band
local bor  = bit.bor
local C    = ffi.C

-- terminal control modes
local TCSANOW   = 0
local TCSADRAIN = 1
local TCSAFLUSH = 2
local ICANON    = 0x0010 -- Canonical mode
local ECHO      = 0x0008 -- Echo input characters
local OPOST     = 0x0001 -- Post-processing output
local ICRNL     = 0x0400 -- Map CR to NL on input
local IUTF8     = 0x0400 -- Enable UTF-8 input
local ISIG      = 0x0001 -- Enable signals (e.g., Ctrl+C)
local IEXTEN    = 0x0040 -- Enable extended input processing

-- flags
local CLOCAL     = 0x08000   -- Ignore modem control lines
local CSIZE      = 0x00030   -- Mask for character size
local CS5        = 0x00000   -- 5 bits per character
local CS6        = 0x00010   -- 6 bits per character
local CS7        = 0x00020   -- 7 bits per character
local CS8        = 0x00030   -- 8 bits per character
local PARENB     = 0x01000   -- Enable parity generation and detection
local PARODD     = 0x02000   -- Odd parity
local CCTS_OFLOW = 0x20000  -- Enable CTS flow control
local CRTS_IFLOW = 0x10000  -- Enable RTS flow control

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

local function set_raw_mode(fd)
	tcgetattr(fd)

	-- disable canonical mode (input line buffering) and echo
	term.c_lflag = band(term.c_lflag, bnot(ICANON))
	term.c_lflag = band(term.c_lflag, bnot(ECHO))
	term.c_oflag = band(term.c_oflag, bnot(OPOST))  -- Disable output processing
	term.c_iflag = band(term.c_iflag, bnot(ICRNL))  -- Disable CR -> NL conversion
	term.c_iflag = band(term.c_iflag, bnot(ISIG))   -- Disable signals like Ctrl+C
	term.c_iflag = band(term.c_iflag, bnot(IEXTEN)) -- Disable extended input processing

	tcsetattr(fd)
end

-- Function to reset terminal to original state
local function reset_terminal(fd)
	tcgetattr(fd)

	term.c_lflag = bor(term.c_lflag, ICANON)
	term.c_lflag = bor(term.c_lflag, ECHO)
	term.c_oflag = bor(term.c_oflag, OPOST)  -- Re-enable output processing
	term.c_iflag = bor(term.c_iflag, ICRNL)  -- Re-enable CR -> NL conversion
	term.c_iflag = bor(term.c_iflag, ISIG)   -- Enable signals like Ctrl+C
	term.c_iflag = bor(term.c_iflag, IEXTEN) -- Enable extended input processing

	tcsetattr(fd)
end

local function flush_terminal(fd, queue)
	assert(check_errno(C.tcflush(fd, queue) ~= -1))
end

local function drain_terminal(fd)
	assert(check_errno(C.tcdrain(fd) ~= -1))
end

local function send_break(fd, duration)
	assert(check_errno(C.tcsendbreak(fd, duration) ~= -1))
end



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
