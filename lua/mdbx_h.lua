local ffi = require'ffi'
assert(ffi.abi'64bit')
assert(ffi.abi'le')
ffi.cdef[[
typedef unsigned int mode_t;
typedef int pid_t;
typedef unsigned long int real_pthread_t;
typedef struct { real_pthread_t _; } pthread_t;

// we're defining MDBX_val for ffi use to minimize ffi allocations in hot paths.
struct MDBX_val {
	// const data allows assigning a Lua string to data without a cast.
	// noconst version allows copy() to work. const is dumb.
	union {
		const uint8_t* data;
		uint8_t* data_noconst;
	};
	// this split avoids allocating a boxed uint64 when reading size.
	// this is safe: we'll never put > 4 GB values into the db.
	uint32_t size;
	uint32_t size_hi;
};

typedef int mdbx_filehandle_t;
typedef pid_t mdbx_pid_t;
typedef pthread_t mdbx_tid_t;
typedef mode_t mdbx_mode_t;
struct MDBX_version_info {
	uint16_t major;
	uint16_t minor;
	uint16_t patch;
	uint16_t tweak;
	const char *semver_prerelease;
	struct {
		const char *datetime;
		const char *tree;
		const char *commit;
		const char *describe;
	} git;
	const char *sourcery;
} mdbx_version;

struct MDBX_build_info {
	const char *datetime;
	const char *target;
	const char *options;
	const char *compiler;
	const char *flags;
	const char *metadata;
} mdbx_build;

typedef struct MDBX_env MDBX_env;
typedef struct MDBX_txn MDBX_txn;
typedef uint32_t MDBX_dbi;
typedef struct MDBX_cursor MDBX_cursor;
typedef struct MDBX_val MDBX_val;

/* NOTE: taken from internals.h because missing API to get parent and nested */
struct MDBX_txn {
  int32_t signature;
  uint32_t flags;
  size_t n_dbi;
  size_t owner;

  MDBX_txn *parent;
  MDBX_txn *nested;
};

enum MDBX_constants {
	MDBX_MAX_DBI = 32765U,
	MDBX_MAXDATASIZE = 0x7fff0000U,
	MDBX_MIN_PAGESIZE = 256,
	MDBX_MAX_PAGESIZE = 65536,
};

typedef enum MDBX_log_level {
	MDBX_LOG_FATAL = 0,
	MDBX_LOG_ERROR = 1,
	MDBX_LOG_WARN = 2,
	MDBX_LOG_NOTICE = 3,
	MDBX_LOG_VERBOSE = 4,
	MDBX_LOG_DEBUG = 5,
	MDBX_LOG_TRACE = 6,
	MDBX_LOG_EXTRA = 7,
	MDBX_LOG_DONTCHANGE = -1
} MDBX_log_level_t;

typedef enum MDBX_debug_flags {
	MDBX_DBG_NONE = 0,
	MDBX_DBG_ASSERT = 1,
	MDBX_DBG_AUDIT = 2,
	MDBX_DBG_JITTER = 4,
	MDBX_DBG_DUMP = 8,
	MDBX_DBG_LEGACY_MULTIOPEN = 16,
	MDBX_DBG_LEGACY_OVERLAP = 32,
	MDBX_DBG_DONT_UPGRADE = 64,
	MDBX_DBG_DONTCHANGE = -1
} MDBX_debug_flags_t;

typedef void MDBX_debug_func(MDBX_log_level_t loglevel, const char *function, int line, const char *fmt, va_list args);
int mdbx_setup_debug(MDBX_log_level_t log_level, MDBX_debug_flags_t debug_flags, MDBX_debug_func *logger);
typedef void MDBX_debug_func_nofmt(MDBX_log_level_t loglevel, const char *function, int line, const char *msg, unsigned length);
int mdbx_setup_debug_nofmt(MDBX_log_level_t log_level, MDBX_debug_flags_t debug_flags, MDBX_debug_func_nofmt *logger, char *logger_buffer, size_t logger_buffer_size);
typedef void MDBX_assert_func(const MDBX_env *env, const char *msg, const char *function, unsigned line);
int mdbx_env_set_assert(MDBX_env *env, MDBX_assert_func *func);
const char *mdbx_dump_val(const MDBX_val *key, char *const buf, const size_t bufsize);
void mdbx_panic(const char *fmt, ...);
void mdbx_assert_fail(const MDBX_env *env, const char *msg, const char *func, unsigned line);

typedef enum MDBX_env_flags {
	MDBX_ENV_DEFAULTS = 0,
	MDBX_VALIDATION = 0x00002000U,
	MDBX_NOSUBDIR = 0x4000U,
	MDBX_RDONLY = 0x20000U,
	MDBX_EXCLUSIVE = 0x400000U,
	MDBX_ACCEDE = 0x40000000U,
	MDBX_WRITEMAP = 0x80000U,
	MDBX_NOSTICKYTHREADS = 0x200000U,
	MDBX_NORDAHEAD = 0x800000U,
	MDBX_NOMEMINIT = 0x1000000U,
	MDBX_LIFORECLAIM = 0x4000000U,
	MDBX_PAGEPERTURB = 0x8000000U,
	MDBX_SYNC_DURABLE = 0,
	MDBX_NOMETASYNC = 0x40000U,
	MDBX_SAFE_NOSYNC = 0x10000U,
	MDBX_MAPASYNC = MDBX_SAFE_NOSYNC,
	MDBX_UTTERLY_NOSYNC = MDBX_SAFE_NOSYNC | 0x100000U,
} MDBX_env_flags_t;

typedef enum MDBX_txn_flags {
	MDBX_TXN_READWRITE = 0,
	MDBX_TXN_RDONLY = MDBX_RDONLY,
	MDBX_TXN_RDONLY_PREPARE = MDBX_RDONLY | MDBX_NOMEMINIT,
	MDBX_TXN_TRY = 0x10000000U,
	MDBX_TXN_NOMETASYNC = MDBX_NOMETASYNC,
	MDBX_TXN_NOSYNC = MDBX_SAFE_NOSYNC,
	MDBX_TXN_INVALID = (-2147483647-1),
	MDBX_TXN_FINISHED = 0x01,
	MDBX_TXN_ERROR = 0x02,
	MDBX_TXN_DIRTY = 0x04,
	MDBX_TXN_SPILLS = 0x08,
	MDBX_TXN_HAS_CHILD = 0x10,
	MDBX_TXN_PARKED = 0x20,
	MDBX_TXN_AUTOUNPARK = 0x40,
	MDBX_TXN_OUSTED = 0x80,
	MDBX_TXN_BLOCKED = MDBX_TXN_FINISHED | MDBX_TXN_ERROR | MDBX_TXN_HAS_CHILD | MDBX_TXN_PARKED
} MDBX_txn_flags_t;

typedef enum MDBX_db_flags {
	MDBX_DB_DEFAULTS = 0,
	MDBX_REVERSEKEY = 0x02U,
	MDBX_DUPSORT = 0x04U,
	MDBX_INTEGERKEY = 0x08U,
	MDBX_DUPFIXED = 0x10U,
	MDBX_INTEGERDUP = 0x20U,
	MDBX_REVERSEDUP = 0x40U,
	MDBX_CREATE = 0x40000U,
	MDBX_DB_ACCEDE = MDBX_ACCEDE
} MDBX_db_flags_t;

typedef enum MDBX_put_flags {
	MDBX_UPSERT = 0,
	MDBX_NOOVERWRITE = 0x10U,
	MDBX_NODUPDATA = 0x20U,
	MDBX_CURRENT = 0x40U,
	MDBX_ALLDUPS = 0x80U,
	MDBX_RESERVE = 0x10000U,
	MDBX_APPEND = 0x20000U,
	MDBX_APPENDDUP = 0x40000U,
	MDBX_MULTIPLE = 0x80000U
} MDBX_put_flags_t;

typedef enum MDBX_copy_flags {
	MDBX_CP_DEFAULTS = 0,
	MDBX_CP_COMPACT = 1u,
	MDBX_CP_FORCE_DYNAMIC_SIZE = 2u,
	MDBX_CP_DONT_FLUSH = 4u,
	MDBX_CP_THROTTLE_MVCC = 8u,
	MDBX_CP_DISPOSE_TXN = 16u,
	MDBX_CP_RENEW_TXN = 32u
} MDBX_copy_flags_t;

typedef enum MDBX_cursor_op {
	MDBX_FIRST,
	MDBX_FIRST_DUP,
	MDBX_GET_BOTH,
	MDBX_GET_BOTH_RANGE,
	MDBX_GET_CURRENT,
	MDBX_GET_MULTIPLE,
	MDBX_LAST,
	MDBX_LAST_DUP,
	MDBX_NEXT,
	MDBX_NEXT_DUP,
	MDBX_NEXT_MULTIPLE,
	MDBX_NEXT_NODUP,
	MDBX_PREV,
	MDBX_PREV_DUP,
	MDBX_PREV_NODUP,
	MDBX_SET,
	MDBX_SET_KEY,
	MDBX_SET_RANGE,
	MDBX_PREV_MULTIPLE,
	MDBX_SET_LOWERBOUND,
	MDBX_SET_UPPERBOUND,

	MDBX_TO_KEY_LESSER_THAN,
	MDBX_TO_KEY_LESSER_OR_EQUAL ,
	MDBX_TO_KEY_EQUAL ,
	MDBX_TO_KEY_GREATER_OR_EQUAL ,
	MDBX_TO_KEY_GREATER_THAN ,

	MDBX_TO_EXACT_KEY_VALUE_LESSER_THAN,
	MDBX_TO_EXACT_KEY_VALUE_LESSER_OR_EQUAL ,
	MDBX_TO_EXACT_KEY_VALUE_EQUAL ,
	MDBX_TO_EXACT_KEY_VALUE_GREATER_OR_EQUAL ,
	MDBX_TO_EXACT_KEY_VALUE_GREATER_THAN ,

	MDBX_TO_PAIR_LESSER_THAN,
	MDBX_TO_PAIR_LESSER_OR_EQUAL ,
	MDBX_TO_PAIR_EQUAL ,
	MDBX_TO_PAIR_GREATER_OR_EQUAL ,
	MDBX_TO_PAIR_GREATER_THAN ,

	MDBX_SEEK_AND_GET_MULTIPLE
} MDBX_cursor_op;

typedef enum MDBX_error {
	MDBX_SUCCESS = 0,
	MDBX_RESULT_FALSE = MDBX_SUCCESS,
	MDBX_RESULT_TRUE = -1,
	MDBX_KEYEXIST = -30799,
	MDBX_NOTFOUND = -30798,
	MDBX_PAGE_NOTFOUND = -30797,
	MDBX_CORRUPTED = -30796,
	MDBX_PANIC = -30795,
	MDBX_VERSION_MISMATCH = -30794,
	MDBX_INVALID = -30793,
	MDBX_MAP_FULL = -30792,
	MDBX_DBS_FULL = -30791,
	MDBX_READERS_FULL = -30790,
	MDBX_TXN_FULL = -30788,
	MDBX_CURSOR_FULL = -30787,
	MDBX_PAGE_FULL = -30786,
	MDBX_UNABLE_EXTEND_MAPSIZE = -30785,
	MDBX_INCOMPATIBLE = -30784,
	MDBX_BAD_RSLOT = -30783,
	MDBX_BAD_TXN = -30782,
	MDBX_BAD_VALSIZE = -30781,
	MDBX_BAD_DBI = -30780,
	MDBX_PROBLEM = -30779,
	MDBX_BUSY = -30778,
	MDBX_FIRST_ADDED_ERRCODE = MDBX_BUSY,
	MDBX_EMULTIVAL = -30421,
	MDBX_EBADSIGN = -30420,
	MDBX_WANNA_RECOVERY = -30419,
	MDBX_EKEYMISMATCH = -30418,
	MDBX_TOO_LARGE = -30417,
	MDBX_THREAD_MISMATCH = -30416,
	MDBX_TXN_OVERLAPPING = -30415,
	MDBX_BACKLOG_DEPLETED = -30414,
	MDBX_DUPLICATED_CLK = -30413,
	MDBX_DANGLING_DBI = -30412,
	MDBX_OUSTED = -30411,
	MDBX_MVCC_RETARDED = -30410,
	MDBX_LAST_ADDED_ERRCODE = MDBX_MVCC_RETARDED,
	MDBX_ENODATA = 61,
	MDBX_EINVAL = 22,
	MDBX_EACCESS = 13,
	MDBX_ENOMEM = 12,
	MDBX_EROFS = 30,
	MDBX_ENOSYS = 38,
	MDBX_EIO = 5,
	MDBX_EPERM = 1,
	MDBX_EINTR = 4,
	MDBX_ENOFILE = 2,
	MDBX_EREMOTE = 121,
	MDBX_EDEADLK = 35,
} MDBX_error_t;

const char *mdbx_strerror(int errnum);
const char *mdbx_strerror_r(int errnum, char *buf, size_t buflen);
const char *mdbx_liberr2str(int errnum);

int mdbx_env_create(MDBX_env **penv);

typedef enum MDBX_option {
	MDBX_opt_max_db,
	MDBX_opt_max_readers,

	MDBX_opt_sync_bytes,

	MDBX_opt_sync_period,
	MDBX_opt_rp_augment_limit,
	MDBX_opt_loose_limit,
	MDBX_opt_dp_reserve_limit,
	MDBX_opt_txn_dp_limit,

	MDBX_opt_txn_dp_initial,
	MDBX_opt_spill_max_denominator,
	MDBX_opt_spill_min_denominator,
	MDBX_opt_spill_parent4child_denominator,
	MDBX_opt_merge_threshold_16dot16_percent,
	MDBX_opt_writethrough_threshold,

	MDBX_opt_prefault_write_enable,
	MDBX_opt_gc_time_limit,
	MDBX_opt_prefer_waf_insteadof_balance,
	MDBX_opt_subpage_limit,

	MDBX_opt_subpage_room_threshold,
	MDBX_opt_subpage_reserve_prereq,

	MDBX_opt_subpage_reserve_limit
} MDBX_option_t;

int mdbx_env_set_option(MDBX_env *env, const MDBX_option_t option, uint64_t value);
int mdbx_env_get_option(const MDBX_env *env, const MDBX_option_t option, uint64_t *pvalue);
int mdbx_env_open(MDBX_env *env, const char *pathname, MDBX_env_flags_t flags, mdbx_mode_t mode);

typedef enum MDBX_env_delete_mode {
	MDBX_ENV_JUST_DELETE = 0,
	MDBX_ENV_ENSURE_UNUSED = 1,
	MDBX_ENV_WAIT_FOR_UNUSED = 2,
} MDBX_env_delete_mode_t;

int mdbx_env_delete(const char *pathname, MDBX_env_delete_mode_t mode);
int mdbx_env_copy(MDBX_env *env, const char *dest, MDBX_copy_flags_t flags);
int mdbx_txn_copy2pathname(MDBX_txn *txn, const char *dest, MDBX_copy_flags_t flags);
int mdbx_env_copy2fd(MDBX_env *env, mdbx_filehandle_t fd, MDBX_copy_flags_t flags);
int mdbx_txn_copy2fd(MDBX_txn *txn, mdbx_filehandle_t fd, MDBX_copy_flags_t flags);

typedef struct MDBX_stat {
	uint32_t psize;
	uint32_t depth;
	uint64_t branch_pages;
	uint64_t leaf_pages;
	uint64_t overflow_pages;
	uint64_t entries;
	uint64_t mod_txnid;
} MDBX_stat;
int mdbx_env_stat_ex(const MDBX_env *env, const MDBX_txn *txn, MDBX_stat *stat, size_t bytes);

typedef struct MDBX_envinfo {
	struct {
		uint64_t lower;
		uint64_t upper;
		uint64_t current;
		uint64_t shrink;
		uint64_t grow;
	} mi_geo;
	uint64_t mapsize;
	uint64_t last_pgno;
	uint64_t recent_txnid;
	uint64_t latter_reader_txnid;
	uint64_t self_latter_reader_txnid;

	uint64_t meta_txnid[3], meta_sign[3];
	uint32_t maxreaders;
	uint32_t numreaders;
	uint32_t dxb_pagesize;
	uint32_t sys_pagesize;
	struct {
		struct {
			uint64_t x, y;
		} current, meta[3];
	} mi_bootid;

	uint64_t unsync_volume;
	uint64_t autosync_threshold;
	uint32_t since_sync_seconds16dot16;
	uint32_t autosync_period_seconds16dot16;
	uint32_t since_reader_check_seconds16dot16;
	uint32_t mode;

	struct {
		uint64_t newly;
		uint64_t cow;
		uint64_t clone;

		uint64_t split;
		uint64_t merge;
		uint64_t spill;
		uint64_t unspill;
		uint64_t wops;

		uint64_t prefault;
		uint64_t mincore;
		uint64_t msync;
		uint64_t fsync;
	} mi_pgop_stat;

	struct {
		uint64_t x, y;
	} mi_dxbid;
} MDBX_envinfo;

int mdbx_env_info_ex(const MDBX_env *env, const MDBX_txn *txn, MDBX_envinfo *info, size_t bytes);
int mdbx_env_sync_ex(MDBX_env *env, _Bool force, _Bool nonblock);
int mdbx_env_close_ex(MDBX_env *env, _Bool dont_sync);
int mdbx_env_resurrect_after_fork(MDBX_env *env);

typedef enum MDBX_warmup_flags {
	MDBX_warmup_default = 0,
	MDBX_warmup_force = 1,
	MDBX_warmup_oomsafe = 2,
	MDBX_warmup_lock = 4,
	MDBX_warmup_touchlimit = 8,
	MDBX_warmup_release = 16,
} MDBX_warmup_flags_t;

int mdbx_env_warmup(const MDBX_env *env, const MDBX_txn *txn, MDBX_warmup_flags_t flags, unsigned timeout_seconds_16dot16);
int mdbx_env_set_flags(MDBX_env *env, MDBX_env_flags_t flags, _Bool onoff);
int mdbx_env_get_flags(const MDBX_env *env, unsigned *flags);
int mdbx_env_get_path(const MDBX_env *env, const char **dest);
int mdbx_env_get_fd(const MDBX_env *env, mdbx_filehandle_t *fd);
int mdbx_env_set_geometry(MDBX_env *env, intptr_t size_lower, intptr_t size_now, intptr_t size_upper, intptr_t growth_step, intptr_t shrink_threshold, intptr_t pagesize);
int mdbx_is_readahead_reasonable(size_t volume, intptr_t redundancy);

intptr_t mdbx_limits_dbsize_min(intptr_t pagesize);
intptr_t mdbx_limits_dbsize_max(intptr_t pagesize);
intptr_t mdbx_limits_keysize_max(intptr_t pagesize, MDBX_db_flags_t flags);
intptr_t mdbx_limits_keysize_min(MDBX_db_flags_t flags);
intptr_t mdbx_limits_valsize_max(intptr_t pagesize, MDBX_db_flags_t flags);
intptr_t mdbx_limits_valsize_min(MDBX_db_flags_t flags);
intptr_t mdbx_limits_pairsize4page_max(intptr_t pagesize, MDBX_db_flags_t flags);
intptr_t mdbx_limits_valsize4page_max(intptr_t pagesize, MDBX_db_flags_t flags);
intptr_t mdbx_limits_txnsize_max(intptr_t pagesize);

size_t mdbx_default_pagesize(void);
int mdbx_get_sysraminfo(intptr_t *page_size, intptr_t *total_pages, intptr_t *avail_pages);
int mdbx_env_get_maxkeysize_ex(const MDBX_env *env, MDBX_db_flags_t flags);
int mdbx_env_get_maxvalsize_ex(const MDBX_env *env, MDBX_db_flags_t flags);

int mdbx_env_get_pairsize4page_max(const MDBX_env *env, MDBX_db_flags_t flags);
int mdbx_env_get_valsize4page_max(const MDBX_env *env, MDBX_db_flags_t flags);
int mdbx_env_set_userctx(MDBX_env *env, void *ctx);
void *mdbx_env_get_userctx(const MDBX_env *env);
int mdbx_txn_begin_ex(MDBX_env *env, MDBX_txn *parent, MDBX_txn_flags_t flags, MDBX_txn **txn, void *context);
int mdbx_txn_set_userctx(MDBX_txn *txn, void *ctx);
void *mdbx_txn_get_userctx(const MDBX_txn *txn);

typedef struct MDBX_txn_info {
	uint64_t txn_id;
	uint64_t txn_reader_lag;
	uint64_t txn_space_used;
	uint64_t txn_space_limit_soft;
	uint64_t txn_space_limit_hard;
	uint64_t txn_space_retired;
	uint64_t txn_space_leftover;
	uint64_t txn_space_dirty;
} MDBX_txn_info;
int mdbx_txn_info(const MDBX_txn *txn, MDBX_txn_info *info, _Bool scan_rlt);
MDBX_env *mdbx_txn_env(const MDBX_txn *txn);
MDBX_txn_flags_t mdbx_txn_flags(const MDBX_txn *txn);
uint64_t mdbx_txn_id(const MDBX_txn *txn);

typedef struct MDBX_commit_latency {
	uint32_t preparation;
	uint32_t gc_wallclock;
	uint32_t audit;
	uint32_t write;
	uint32_t sync;
	uint32_t ending;
	uint32_t whole;
	uint32_t gc_cputime;
	struct {
		uint32_t wloops;
		uint32_t coalescences;
		uint32_t wipes;
		uint32_t flushes;
		uint32_t kicks;
		uint32_t work_counter;
		uint32_t work_rtime_monotonic;
		uint32_t work_xtime_cpu;
		uint32_t work_rsteps;
		uint32_t work_xpages;
		uint32_t work_majflt;
		uint32_t self_counter;
		uint32_t self_rtime_monotonic;
		uint32_t self_xtime_cpu;
		uint32_t self_rsteps;
		uint32_t self_xpages;
		uint32_t self_majflt;
		struct {
			uint32_t time;
			uint64_t volume;
			uint32_t calls;
		} pnl_merge_work, pnl_merge_self;
	} gc_prof;
} MDBX_commit_latency;

int mdbx_txn_commit_ex(MDBX_txn *txn, MDBX_commit_latency *latency);
int mdbx_txn_abort(MDBX_txn *txn);
int mdbx_txn_break(MDBX_txn *txn);
int mdbx_txn_reset(MDBX_txn *txn);
int mdbx_txn_park(MDBX_txn *txn, _Bool autounpark);
int mdbx_txn_unpark(MDBX_txn *txn, _Bool restart_if_ousted);
int mdbx_txn_renew(MDBX_txn *txn);

typedef struct MDBX_canary {
	uint64_t x, y, z, v;
} MDBX_canary;
int mdbx_canary_put(MDBX_txn *txn, const MDBX_canary *canary);
int mdbx_canary_get(const MDBX_txn *txn, MDBX_canary *canary);

typedef int(MDBX_cmp_func)(const MDBX_val *a, const MDBX_val *b) ;
int mdbx_dbi_open (MDBX_txn *txn, const char *name, MDBX_db_flags_t flags, MDBX_dbi *dbi);
int mdbx_dbi_rename (MDBX_txn *txn, MDBX_dbi dbi, const char *name);

int mdbx_dbi_stat(const MDBX_txn *txn, MDBX_dbi dbi, MDBX_stat *stat, size_t bytes);
int mdbx_dbi_dupsort_depthmask(const MDBX_txn *txn, MDBX_dbi dbi, uint32_t *mask);

typedef enum MDBX_dbi_state {
	MDBX_DBI_DIRTY = 0x01,
	MDBX_DBI_STALE = 0x02,
	MDBX_DBI_FRESH = 0x04,
	MDBX_DBI_CREAT = 0x08,
} MDBX_dbi_state_t;

int mdbx_dbi_flags_ex(const MDBX_txn *txn, MDBX_dbi dbi, unsigned *flags, unsigned *state);
int mdbx_dbi_close(MDBX_env *env, MDBX_dbi dbi);
int mdbx_drop(MDBX_txn *txn, MDBX_dbi dbi, _Bool del);
int mdbx_get(const MDBX_txn *txn, MDBX_dbi dbi, MDBX_val *key, MDBX_val *data);
int mdbx_get_ex(const MDBX_txn *txn, MDBX_dbi dbi, MDBX_val *key, MDBX_val *data, size_t *values_count);
int mdbx_get_equal_or_great(const MDBX_txn *txn, MDBX_dbi dbi, MDBX_val *key, MDBX_val *data);
int mdbx_put(MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *key, MDBX_val *data, MDBX_put_flags_t flags);
int mdbx_replace(MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *key, MDBX_val *new_data, MDBX_val *old_data, MDBX_put_flags_t flags);

typedef int (*MDBX_preserve_func)(void *context, MDBX_val *target, const void *src, size_t bytes);
int mdbx_replace_ex(MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *key, MDBX_val *new_data,
	MDBX_val *old_data, MDBX_put_flags_t flags, MDBX_preserve_func preserver,
	void *preserver_context);

int mdbx_del(MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *key, const MDBX_val *data);

MDBX_cursor *mdbx_cursor_create(void *context);
int mdbx_cursor_set_userctx(MDBX_cursor *cursor, void *ctx);
void *mdbx_cursor_get_userctx(const MDBX_cursor *cursor);
int mdbx_cursor_bind(MDBX_txn *txn, MDBX_cursor *cursor, MDBX_dbi dbi);
int mdbx_cursor_unbind(MDBX_cursor *cursor);
int mdbx_cursor_reset(MDBX_cursor *cursor);
int mdbx_cursor_open(MDBX_txn *txn, MDBX_dbi dbi, MDBX_cursor **cursor);
void mdbx_cursor_close(MDBX_cursor *cursor);
int mdbx_cursor_close2(MDBX_cursor *cursor);
int mdbx_txn_release_all_cursors_ex(const MDBX_txn *txn, _Bool unbind, size_t *count);
int mdbx_cursor_renew(MDBX_txn *txn, MDBX_cursor *cursor);
MDBX_txn *mdbx_cursor_txn(const MDBX_cursor *cursor);
MDBX_dbi mdbx_cursor_dbi(const MDBX_cursor *cursor);
int mdbx_cursor_copy(const MDBX_cursor *src, MDBX_cursor *dest);
int mdbx_cursor_compare(const MDBX_cursor *left, const MDBX_cursor *right, _Bool ignore_multival);
int mdbx_cursor_get(MDBX_cursor *cursor, MDBX_val *key, MDBX_val *data, MDBX_cursor_op op);
int mdbx_cursor_ignord(MDBX_cursor *cursor);
typedef int(MDBX_predicate_func)(void *context, MDBX_val *key, MDBX_val *value, void *arg) ;
int mdbx_cursor_scan(MDBX_cursor *cursor, MDBX_predicate_func *predicate, void *context,
	MDBX_cursor_op start_op, MDBX_cursor_op turn_op, void *arg);
int mdbx_cursor_scan_from(MDBX_cursor *cursor, MDBX_predicate_func *predicate, void *context,
	MDBX_cursor_op from_op, MDBX_val *from_key, MDBX_val *from_value,
	MDBX_cursor_op turn_op, void *arg);
int mdbx_cursor_get_batch(MDBX_cursor *cursor, size_t *count, MDBX_val *pairs, size_t limit,
	MDBX_cursor_op op);
int mdbx_cursor_put(MDBX_cursor *cursor, const MDBX_val *key, MDBX_val *data, MDBX_put_flags_t flags);
int mdbx_cursor_del(MDBX_cursor *cursor, MDBX_put_flags_t flags);
int mdbx_cursor_count(const MDBX_cursor *cursor, size_t *count);
int mdbx_cursor_count_ex(const MDBX_cursor *cursor, size_t *count, MDBX_stat *stat, size_t bytes);
int mdbx_cursor_eof(const MDBX_cursor *cursor);
int mdbx_cursor_on_first(const MDBX_cursor *cursor);
int mdbx_cursor_on_first_dup(const MDBX_cursor *cursor);
int mdbx_cursor_on_last(const MDBX_cursor *cursor);
int mdbx_cursor_on_last_dup(const MDBX_cursor *cursor);

int mdbx_estimate_distance(const MDBX_cursor *first, const MDBX_cursor *last, ptrdiff_t *distance_items);
int mdbx_estimate_move(const MDBX_cursor *cursor, MDBX_val *key, MDBX_val *data, MDBX_cursor_op move_op, ptrdiff_t *distance_items);
int mdbx_estimate_range(const MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *begin_key,
												const MDBX_val *begin_data, const MDBX_val *end_key, const MDBX_val *end_data,
												ptrdiff_t *distance_items);

int mdbx_is_dirty(const MDBX_txn *txn, const void *ptr);

int mdbx_dbi_sequence(MDBX_txn *txn, MDBX_dbi dbi, uint64_t *result, uint64_t increment);

int mdbx_cmp(const MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *a, const MDBX_val *b);
MDBX_cmp_func *mdbx_get_keycmp(MDBX_db_flags_t flags);
int mdbx_dcmp(const MDBX_txn *txn, MDBX_dbi dbi, const MDBX_val *a, const MDBX_val *b);
MDBX_cmp_func *mdbx_get_datacmp(MDBX_db_flags_t flags);

typedef int(MDBX_reader_list_func)(void *ctx, int num, int slot, mdbx_pid_t pid, mdbx_tid_t thread, uint64_t txnid,
	uint64_t lag, size_t bytes_used, size_t bytes_retained) ;
int mdbx_reader_list(const MDBX_env *env, MDBX_reader_list_func *func, void *ctx);
int mdbx_reader_check(MDBX_env *env, int *dead);

int mdbx_thread_register(const MDBX_env *env);
int mdbx_thread_unregister(const MDBX_env *env);

typedef int(MDBX_hsr_func)(const MDBX_env *env, const MDBX_txn *txn, mdbx_pid_t pid, mdbx_tid_t tid, uint64_t laggard,
	unsigned gap, size_t space, int retry) ;
int mdbx_env_set_hsr(MDBX_env *env, MDBX_hsr_func *hsr_callback);
MDBX_hsr_func *mdbx_env_get_hsr(const MDBX_env *env);

int mdbx_txn_lock(MDBX_env *env, _Bool dont_wait);
int mdbx_txn_unlock(MDBX_env *env);

int mdbx_env_open_for_recovery(MDBX_env *env, const char *pathname, unsigned target_meta, _Bool writeable);
int mdbx_env_turn_for_recovery(MDBX_env *env, unsigned target_meta);

int mdbx_preopen_snapinfo(const char *pathname, MDBX_envinfo *info, size_t bytes);
]]

-- mdbx_env_chk()
ffi.cdef[[
typedef enum MDBX_chk_flags {
	MDBX_CHK_DEFAULTS = 0,
	MDBX_CHK_READWRITE = 1,
	MDBX_CHK_SKIP_BTREE_TRAVERSAL = 2,
	MDBX_CHK_SKIP_KV_TRAVERSAL = 4,
	MDBX_CHK_IGNORE_ORDER = 8
} MDBX_chk_flags_t;

typedef enum MDBX_chk_severity {
	MDBX_chk_severity_prio_shift = 4,
	MDBX_chk_severity_kind_mask = 0xF,
	MDBX_chk_fatal = 0x00u,
	MDBX_chk_error = 0x11u,
	MDBX_chk_warning = 0x22u,
	MDBX_chk_notice = 0x33u,
	MDBX_chk_result = 0x44u,
	MDBX_chk_resolution = 0x55u,
	MDBX_chk_processing = 0x56u,
	MDBX_chk_info = 0x67u,
	MDBX_chk_verbose = 0x78u,
	MDBX_chk_details = 0x89u,
	MDBX_chk_extra = 0x9Au
} MDBX_chk_severity_t;

typedef enum MDBX_chk_stage {
	MDBX_chk_none,
	MDBX_chk_init,
	MDBX_chk_lock,
	MDBX_chk_meta,
	MDBX_chk_tree,
	MDBX_chk_gc,
	MDBX_chk_space,
	MDBX_chk_maindb,
	MDBX_chk_tables,
	MDBX_chk_conclude,
	MDBX_chk_unlock,
	MDBX_chk_finalize
} MDBX_chk_stage_t;

typedef struct MDBX_chk_line {
	struct MDBX_chk_context *ctx;
	uint8_t severity, scope_depth, empty;
	char *begin, *end, *out;
} MDBX_chk_line_t;

typedef struct MDBX_chk_issue {
	struct MDBX_chk_issue *next;
	size_t count;
	const char *caption;
} MDBX_chk_issue_t;

typedef struct MDBX_chk_scope {
	MDBX_chk_issue_t *issues;
	struct MDBX_chk_internal *internal;
	const void *object;
	MDBX_chk_stage_t stage;
	MDBX_chk_severity_t verbosity;
	size_t subtotal_issues;
	union {
		void *ptr;
		size_t number;
	} usr_z, usr_v, usr_o;
} MDBX_chk_scope_t;

typedef struct MDBX_chk_user_table_cookie MDBX_chk_user_table_cookie_t;

struct MDBX_chk_histogram {
	size_t amount, count, le1_amount, le1_count;
	struct {
		size_t begin, end, amount, count;
	} ranges[9];
};

typedef struct MDBX_chk_table {
	MDBX_chk_user_table_cookie_t *cookie;
	MDBX_val name;
	MDBX_db_flags_t flags;
	int id;
	size_t payload_bytes, lost_bytes;
	struct {
		size_t all, empty, broken;
		size_t branch, leaf;
		size_t nested_branch, nested_leaf, nested_subleaf;
	} pages;
	struct {
		struct MDBX_chk_histogram height;
		struct MDBX_chk_histogram large_pages;
		struct MDBX_chk_histogram nested_height_or_gc_span_length;
		struct MDBX_chk_histogram key_len;
		struct MDBX_chk_histogram val_len;
		struct MDBX_chk_histogram multival;
		struct MDBX_chk_histogram tree_density;
		struct MDBX_chk_histogram large_or_nested_density;
		struct MDBX_chk_histogram page_age;
		struct MDBX_chk_histogram pgno;
	} histogram;
} MDBX_chk_table_t;

typedef struct MDBX_chk_context {
	struct MDBX_chk_internal *internal;
	MDBX_env *env;
	MDBX_txn *txn;
	MDBX_chk_scope_t *scope;
	uint8_t scope_nesting;
	struct {
		size_t total_payload_bytes;
		size_t table_total, table_processed;
		size_t total_unused_bytes, unused_pages;
		size_t processed_pages, reclaimable_pages, gc_pages, alloc_pages, backed_pages;
		size_t problems_meta, tree_problems, gc_tree_problems, kv_tree_problems, problems_gc, problems_kv, total_problems;
		uint64_t steady_txnid, recent_txnid;
		struct MDBX_chk_histogram histogram_page_age;
		struct MDBX_chk_histogram histogram_pgno_payload;
		struct MDBX_chk_histogram histogram_pgno_retained;
		const MDBX_chk_table_t *const *tables;
	} result;
} MDBX_chk_context_t;

typedef struct MDBX_chk_callbacks {
	_Bool (*check_break)(MDBX_chk_context_t *ctx);
	int (*scope_push)(MDBX_chk_context_t *ctx, MDBX_chk_scope_t *outer, MDBX_chk_scope_t *inner, const char *fmt,
						  va_list args);
	int (*scope_conclude)(MDBX_chk_context_t *ctx, MDBX_chk_scope_t *outer, MDBX_chk_scope_t *inner, int err);
	void (*scope_pop)(MDBX_chk_context_t *ctx, MDBX_chk_scope_t *outer, MDBX_chk_scope_t *inner);
	void (*issue)(MDBX_chk_context_t *ctx, const char *object, uint64_t entry_number, const char *issue,
					 const char *extra_fmt, va_list extra_args);
	MDBX_chk_user_table_cookie_t *(*table_filter)(MDBX_chk_context_t *ctx, const MDBX_val *name, MDBX_db_flags_t flags);
	int (*table_conclude)(MDBX_chk_context_t *ctx, const MDBX_chk_table_t *table, MDBX_cursor *cursor, int err);
	void (*table_dispose)(MDBX_chk_context_t *ctx, const MDBX_chk_table_t *table);

	int (*table_handle_kv)(MDBX_chk_context_t *ctx, const MDBX_chk_table_t *table, size_t entry_number,
								 const MDBX_val *key, const MDBX_val *value);

	int (*stage_begin)(MDBX_chk_context_t *ctx, MDBX_chk_stage_t);
	int (*stage_end)(MDBX_chk_context_t *ctx, MDBX_chk_stage_t, int err);

	MDBX_chk_line_t *(*print_begin)(MDBX_chk_context_t *ctx, MDBX_chk_severity_t severity);
	void (*print_flush)(MDBX_chk_line_t *);
	void (*print_done)(MDBX_chk_line_t *);
	void (*print_chars)(MDBX_chk_line_t *, const char *str, size_t len);
	void (*print_format)(MDBX_chk_line_t *, const char *fmt, va_list args);
	void (*print_size)(MDBX_chk_line_t *, const char *prefix, const uint64_t value, const char *suffix);
} MDBX_chk_callbacks_t;

int mdbx_env_chk(MDBX_env *env, const MDBX_chk_callbacks_t *cb, MDBX_chk_context_t *ctx,
	const MDBX_chk_flags_t flags, MDBX_chk_severity_t verbosity,
	unsigned timeout_seconds_16dot16);

int mdbx_env_chk_encount_problem(MDBX_chk_context_t *ctx);
]]
