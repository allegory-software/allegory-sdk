--[[

	Async polling of unix signals.

	signal_file('SIGHUP ...', [flags], [debug_name]) -> f
	f:try_read_signal() -> signal | nil,err
	f:read_signal() -> signal

]]

require'sock'
require'fs'

local SIG_BLOCK   = 0
local SIG_UNBLOCK = 1
local SIG_SETMASK = 2

cdef[[
typedef struct {
	unsigned long int __val[(1024 / (8 * sizeof(unsigned long int)))];
} sigset_t;
struct signalfd_siginfo {
	uint32_t ssi_signo;      /* Signal number */
	 int32_t ssi_errno;      /* Error number (unused) */
	 int32_t ssi_code;       /* Signal code */
	uint32_t ssi_pid;        /* PID of sender */
	uint32_t ssi_uid;        /* Real UID of sender */
	 int32_t ssi_fd;         /* File descriptor (SIGIO) */
	uint32_t ssi_tid;        /* Kernel timer ID (POSIX timers)
	uint32_t ssi_band;       /* Band event (SIGIO) */
	uint32_t ssi_overrun;    /* POSIX timer overrun count */
	uint32_t ssi_trapno;     /* Trap number that caused signal */
	 int32_t ssi_status;     /* Exit status or signal (SIGCHLD) */
	 int32_t ssi_int;        /* Integer sent by sigqueue(3) */
	uint64_t ssi_ptr;        /* Pointer sent by sigqueue(3) */
	uint64_t ssi_utime;      /* User CPU time consumed (SIGCHLD) */
	uint64_t ssi_stime;      /* System CPU time consumed (SIGCHLD) */
	uint64_t ssi_addr;       /* Address that generated signal (for hardware-generated signals) */
	uint16_t ssi_addr_lsb;   /* Least significant bit of address (SIGBUS; since Linux 2.6.37) */
	uint16_t __pad2;
	 int32_t ssi_syscall;
	uint64_t ssi_call_addr;
	uint32_t ssi_arch;
	uint8_t __pad[28];       /* Pad size to 128 bytes (allow for additional fields in the future) */
};
int sigemptyset (sigset_t*);
int sigfillset  (sigset_t*);
int sigaddset   (sigset_t*, int);
int sigprocmask (int how, sigset_t* set, sigset_t* oldset);
int signalfd    (int fd, const sigset_t* mask, int flags);
]]

local signums = {
	SIGHUP         =  1,
	SIGINT         =  2,
	SIGQUIT        =  3,
	SIGILL         =  4,
	SIGTRAP        =  5,
	SIGABRT        =  6,
	SIGIOT         =  6,
	SIGBUS         =  7,
	SIGFPE         =  8,
	SIGKILL        =  9,
	SIGUSR1        = 10,
	SIGSEGV        = 11,
	SIGUSR2        = 12,
	SIGPIPE        = 13,
	SIGALRM        = 14,
	SIGTERM        = 15,
	SIGSTKFLT      = 16,
	SIGCHLD        = 17,
	SIGCONT        = 18,
	SIGSTOP        = 19,
	SIGTSTP        = 20,
	SIGTTIN        = 21,
	SIGTTOU        = 22,
	SIGURG         = 23,
	SIGXCPU        = 24,
	SIGXFSZ        = 25,
	SIGVTALRM      = 26,
	SIGPROF        = 27,
	SIGWINCH       = 28,
	SIGIO          = 29,
	SIGPOLL        = 29,
	SIGLOST        = 29,
	SIGPWR         = 30,
	SIGSYS         = 31,
	SIGUNUSED      = 31,
}

local SFD_CLOEXEC  = 0x80000
local SFD_NONBLOCK = 0x00800 --not needed since file_wrap_fd() calls ioctl.

local ss = new'sigset_t'
local function sigset(signals)
	C.sigemptyset(ss)
	for signal in words(signals) do
		pr(signal)
		local signal = assertf(signums[signal], 'unknown signal %s', signal)
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
	local psi = cast(u8p, si)
	pp(f)
	f.try_read_signal = function(f)
		local buf, err = f:try_readn(psi, sizeof(si))
		if not buf then return nil, err end
		return si
	end
	f.read_signal = function(f)
		f:readn(psi, sizeof(si))
		return si
	end
	return f
end

local function signal_set(signals, op)
	local ss = sigset(signals)
	assert(check_errno(C.sigprocmask(op, set, nil) == 0))
end
function signal_block     (signals) return signal_set(signals, SIG_BLOCK  ) end
function signal_unblock   (signals) return signal_set(signals, SIG_UNBLOCK) end
function signal_blockonly (signals) return signal_set(signals, SIG_SETMASK) end

if not ... then

local signals = cat(keys(signums), ' ')
signals = 'SIGUSR1'
signal_block(signals)
local f = signal_file(signals, false)
pr(f.s, f:read_signal())
--resume(thread(function()
--	while 1 do
--		pr(f:read_signal())
--	end
--end))
--start()
end
