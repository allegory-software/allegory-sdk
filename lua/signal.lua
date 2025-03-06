--[[

	Async polling of unix signals.

	SIG*  signal numbers

	signal_file('SIGHUP ...'|{SIGHUP, ...}, async, bor(SFD_*, ...), [debug_name]) -> sf
	sf:try_read_signal() -> signal | nil,err
	sf:read_signal() -> signalfd_siginfo

	signal_block     (signals)
	signal_unblock   (signals)
	signal_blockonly (signals)
	signal_ignore    (signals)

]]

require'sock'
require'fs'

cdef[[
typedef struct {
	unsigned long int __val[(1024 / (8 * sizeof(unsigned long int)))];
} sigset_t;
struct signalfd_siginfo {
	uint32_t signo;      /* Signal number */
	 int32_t errno;      /* Error number (unused) */
	 int32_t code;       /* Signal code */
	uint32_t pid;        /* PID of sender */
	uint32_t uid;        /* Real UID of sender */
	 int32_t fd;         /* File descriptor (SIGIO) */
	uint32_t tid;        /* Kernel timer ID (POSIX timers)
	uint32_t band;       /* Band event (SIGIO) */
	uint32_t overrun;    /* POSIX timer overrun count */
	uint32_t trapno;     /* Trap number that caused signal */
	 int32_t status;     /* Exit status or signal (SIGCHLD) */
	 int32_t sigqueue_int; /* Integer sent by sigqueue(3) */
	uint64_t sigqueue_ptr; /* Pointer sent by sigqueue(3) */
	uint64_t utime;      /* User CPU time consumed (SIGCHLD) */
	uint64_t stime;      /* System CPU time consumed (SIGCHLD) */
	uint64_t addr;       /* Address that generated signal (for hardware-generated signals) */
	uint16_t addr_lsb;   /* Least significant bit of address (SIGBUS; since Linux 2.6.37) */
	uint16_t __pad2;
	 int32_t syscall;
	uint64_t call_addr;
	uint32_t arch;
	uint8_t __pad[28];       /* Pad size to 128 bytes (allow for additional fields in the future) */
};
int sigemptyset (sigset_t*);
int sigaddset   (sigset_t*, int);
int sigprocmask (int how, sigset_t* set, sigset_t* oldset);
intptr_t signal (int, intptr_t);
int signalfd    (int fd, const sigset_t* mask, int flags);
]]

SIGHUP    =  1 --controlling terminal was lost
SIGINT    =  2 --Ctrl+C
SIGQUIT   =  3
SIGILL    =  4 --illegal instruction
SIGTRAP   =  5
SIGABRT   =  6 --abort()
SIGIOT    =  6
SIGBUS    =  7 --bad memory access
SIGFPE    =  8
SIGKILL   =  9 --kill (can't catch it)
SIGUSR1   = 10
SIGSEGV   = 11 --seg fault
SIGUSR2   = 12
SIGPIPE   = 13
SIGALRM   = 14 --alarm()
SIGTERM   = 15 --terminate gracefully
SIGSTKFLT = 16
SIGCHLD   = 17 --child terminated
SIGCONT   = 18 --resume paused process
SIGSTOP   = 19 --Ctrl+Z (can't catch it)
SIGTSTP   = 20
SIGTTIN   = 21
SIGTTOU   = 22
SIGURG    = 23
SIGXCPU   = 24
SIGXFSZ   = 25
SIGVTALRM = 26
SIGPROF   = 27
SIGWINCH  = 28
SIGIO     = 29
SIGPOLL   = 29
SIGLOST   = 29
SIGPWR    = 30
SIGSYS    = 31
SIGUNUSED = 31

SFD_CLOEXEC  = 0x80000
SFD_NONBLOCK = 0x00800 --not needed since file_wrap_fd() calls ioctl().

local function check_signal(signal)
	return isstr(signal) and assertf(_G[signal], 'unknown signal %s', signal)
		or isnum(signal) and signal
		or assert(false, 'invalid signal type %s', typeof(signal))
end

local ss = new'sigset_t'
local function sigset(signals)
	C.sigemptyset(ss)
	for signal in words(signals) do
		signal = check_signal(signal)
		C.sigaddset(ss, signal)
	end
	return ss
end

function signal_file(signals, async, flags, name)
	local ss = sigset(signals)
	local fd = C.signalfd(-1, ss, bor(async and SFD_NONBLOCK or 0, flags or 0))
	assert(check_errno(fd ~= -1))
	local f = file_wrap_fd(fd, null, async, 'pipe', name)
	local si = new'struct signalfd_siginfo'
	assert(sizeof(si) == 128)
	local psi = cast(u8p, si)
	f.try_read_signal = function(f)
		local buf, err = f:try_readn(psi, 128)
		if not buf then return nil, err end
		return si
	end
	f.read_signal = function(f)
		f:readn(psi, 128)
		return si
	end
	return f
end

local SIG_BLOCK   = 0
local SIG_UNBLOCK = 1
local SIG_SETMASK = 2
local function signal_set(op, signals)
	local ss = sigset(signals)
	assert(check_errno(C.sigprocmask(op, ss, nil) == 0))
end
function signal_block     (signals) signal_set(SIG_BLOCK  , signals) end
function signal_unblock   (signals) signal_set(SIG_UNBLOCK, signals) end
function signal_blockonly (signals) signal_set(SIG_SETMASK, signals) end

local SIG_IGN = 1
local SIG_DFL = 0
local SIG_ERR = -1
function signal_ignore (signals)
	for signal in words(signals) do
		signal = check_signal(signal)
		assert(check_errno(C.signal(signal, SIG_IGN) ~= SIG_ERR))
	end
end

if not ... then --self-test

	local signals = 'SIGINT SIGTERM SIGUSR1'
	signal_block(signals)
	local f = signal_file(signals, true)
	resume(thread(function()
		while 1 do
			local s = f:read_signal()
			if s.signo == SIGINT then
				pr'\rGot SIGINT. Breaking loop.'
				break
			elseif s.signo == SIGTERM then
				pr'\rGot SIGTERM. Breaking loop.'
				break
			elseif s.signo == SIGUSR1 then
				pr'Got SIGUSR1'
			end
		end
	end))
	start()

end
