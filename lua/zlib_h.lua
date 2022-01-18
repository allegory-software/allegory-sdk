--zlib 1.2.7 from ufo
local ffi = require'ffi'

ffi.cdef[[
enum {
/* flush values*/
     Z_NO_FLUSH           = 0,
     Z_PARTIAL_FLUSH      = 1,
     Z_SYNC_FLUSH         = 2,
     Z_FULL_FLUSH         = 3,
     Z_FINISH             = 4,
     Z_BLOCK              = 5,
     Z_TREES              = 6,
/* return codes */
     Z_OK                 = 0,
     Z_STREAM_END         = 1,
     Z_NEED_DICT          = 2,
     Z_ERRNO              = -1,
     Z_STREAM_ERROR       = -2,
     Z_DATA_ERROR         = -3,
     Z_MEM_ERROR          = -4,
     Z_BUF_ERROR          = -5,
     Z_VERSION_ERROR      = -6,
/* compression values */
     Z_NO_COMPRESSION      =  0,
     Z_BEST_SPEED          =  1,
     Z_BEST_COMPRESSION    =  9,
     Z_DEFAULT_COMPRESSION = -1,
/* compression levels */
     Z_FILTERED            =  1,
     Z_HUFFMAN_ONLY        =  2,
     Z_RLE                 =  3,
     Z_FIXED               =  4,
     Z_DEFAULT_STRATEGY    =  0,
/* compression strategies */
     Z_BINARY              =  0,
     Z_TEXT                =  1,
     Z_ASCII               =  Z_TEXT,   /* for compatibility with 1.2.2 and earlier */
     Z_UNKNOWN             =  2,
/* Possible values of the data_type field (though see inflate()) */
     Z_DEFLATED            =  8,
/* The deflate compression method (the only one supported in this version) */
     Z_NULL                =  0,  /* for initializing zalloc, zfree, opaque */
     Z_MAX_WBITS           =  15 /* 32K LZ77 window */
};

typedef struct {int unused;} gzFile_s;
typedef gzFile_s* gzFile;

typedef void*    (* z_alloc_func)( void* opaque, unsigned items, unsigned size );
typedef void     (* z_free_func) ( void* opaque, void* address );
typedef unsigned (* z_in_func  )( void*, unsigned char*  * );
typedef int      (* z_out_func )( void*, unsigned char*, unsigned );

typedef struct z_stream_s {
   const char*   next_in;
   unsigned      avail_in;
   unsigned long total_in;
   char*         next_out;
   unsigned      avail_out;
   unsigned long total_out;
   char*         msg;
   void*         state;
   z_alloc_func  zalloc;
   z_free_func   zfree;
   void*         opaque;
   int           data_type;
   unsigned long adler;
   unsigned long reserved;
} z_stream;

typedef struct gz_header_s {
    int           text;
    unsigned long time;
    int           xflags;
    int           os;
    char*         extra;
    unsigned      extra_len;
    unsigned      extra_max;
    char*         name;
    unsigned      name_max;
    char*         comment;
    unsigned      comm_max;
    int           hcrc;
    int           done;
} gz_header;

const char*   zlibVersion(           );
unsigned long zlibCompileFlags(      );
const char*   zError(               int );

int           inflate(              z_stream*, int flush );
int           inflateEnd(           z_stream*  );

int           inflateSetDictionary( z_stream*, const char *dictionary, unsigned dictLength);
int           inflateSync(          z_stream*  );
int           inflateCopy(          z_stream*, z_stream* source);
int           inflateReset(         z_stream*  );
int           inflateReset2(        z_stream*, int windowBits);
int           inflatePrime(         z_stream*, int bits, int value);
long          inflateMark(          z_stream*  );
int           inflateGetHeader(     z_stream*, gz_header* head);
int           inflateBack(          z_stream*, z_in_func  in,  void* in_desc,
				               z_out_func out, void* out_desc );
int           inflateBackEnd(       z_stream*  );
int           inflateInit_(         z_stream*, const char *version, int stream_size);
int           inflateInit2_(        z_stream*, int windowBits, const char* version, int stream_size);
int           inflateBackInit_(     z_stream*, int windowBits, unsigned char *window,
				               const char *version, int stream_size);
int           inflateSyncPoint(     z_stream*  );
int           inflateUndermine(     z_stream*, int );

int           deflate(              z_stream*, int flush );
int           deflateEnd(           z_stream*  );

int           deflateSetDictionary( z_stream*, const char *dictionary, unsigned dictLength );
int           deflateCopy(          z_stream*, z_stream* source );
int           deflateReset(         z_stream*  );
int           deflateParams(        z_stream*, int level, int strategy );
int           deflateTune(          z_stream*, int good_length, int max_lazy, int nice_length, int max_chain );
unsigned long deflateBound(         z_stream*, unsigned long sourceLen );
int           deflatePrime(         z_stream*, int bits, int value );
int           deflateSetHeader(     z_stream*, gz_header* head );
int           deflateInit_(         z_stream*, int level, const char *version, int stream_size);
int           deflateInit2_(        z_stream*, int level, int method, int windowBits, int memLevel,
				               int strategy, const char *version, int stream_size );

int           compress(             char *dest,   unsigned long *destLen,
			      const char *source, unsigned long sourceLen );
int           compress2(            char *dest,   unsigned long *destLen,
			      const char *source, unsigned long sourceLen, int level);
unsigned long compressBound(        unsigned long sourceLen );
int           uncompress(           char *dest,   unsigned long *destLen,
			      const char *source, unsigned long sourceLen );

gzFile        gzdopen(              int fd, const char *mode);
int           gzbuffer(             gzFile, unsigned size);
int           gzsetparams(          gzFile, int level, int strategy);
int           gzread(               gzFile, void* buf, unsigned len);
int           gzwrite(              gzFile, void const *buf, unsigned len);
int           gzprintf(             gzFile, const char *format, ...);
int           gzputs(               gzFile, const char *s);
char*         gzgets(               gzFile, char *buf, int len);
int           gzputc(               gzFile, int c);
int           gzgetc(               gzFile  );
int           gzungetc(      int c, gzFile  );
int           gzflush(              gzFile, int flush);
int           gzrewind(             gzFile  );
int           gzeof(                gzFile  );
int           gzdirect(             gzFile  );
int           gzclose(              gzFile  );
int           gzclose_r(            gzFile  );
int           gzclose_w(            gzFile  );
const char*   gzerror(              gzFile, int *errnum);
void          gzclearerr(           gzFile  );
gzFile        gzopen(               const char *, const char * );
long          gzseek(               gzFile, long, int );
long          gztell(               gzFile );
long          gzoffset(             gzFile );

unsigned long adler32(              unsigned long adler, const char *buf, unsigned len );
unsigned long crc32(                unsigned long crc,   const char *buf, unsigned len );
unsigned long adler32_combine(      unsigned long, unsigned long, long );
unsigned long crc32_combine(        unsigned long, unsigned long, long );

const unsigned long* get_crc_table( void );
]]
