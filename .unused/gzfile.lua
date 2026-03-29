--[[

	ZLIB binding, gz file compression & decompression.
	Written by Cosmin Apreutesei. Public Domain.

   [try_]gzip_open(filename[, mode][, bufsize]) -> gzfile
   gzfile:close()
   gzfile:flush('none|partial|sync|full|finish|block|trees')
   gzfile:read_tobuffer(buf, size) -> bytes_read
   gzfile:read(size) -> s
   gzfile:write(cdata, size) -> bytes_written
   gzfile:write(s[, size]) -> bytes_written
   gzfile:eof() -> true|false     NOTE: only true if trying to read *past* EOF!
   gzfile:seek(['cur'|'set'], [offset])
      If the file is opened for reading, this function is emulated but can be
      extremely slow. If the file is opened for writing, only forward seeks are
      supported: `seek()` then compresses a sequence of zeroes up to the new
      starting position. If the file is opened for writing and the new starting
      position is before the current position, an error occurs.
      Returns the resulting offset location as measured in bytes from the
      beginning of the uncompressed stream.
   gzfile:offset() -> n
      When reading, the offset does not include as yet unused buffered input.
      This information can be used for a progress indicator.

]]

require'gzip'

cdef[[
typedef struct {int unused;} gzFile_s;
typedef gzFile_s* gzFile;

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
]]

local function checkz(ret) assert(ret == 0) end
local function checkminus1(ret) assert(ret ~= -1); return ret end

local function gzclose(gzfile)
	checkz(C.gzclose(gzfile))
	gc(gzfile, nil)
end

function try_gzip_open(filename, mode, bufsize)
	local gzfile = C.gzopen(filename, mode or 'r')
	if gzfile == nil then
		return nil, string.format('errno %d', errno())
	end
	gc(gzfile, gzclose)
	if bufsize then C.gzbuffer(gzfile, bufsize) end
	return gzfile
end
function gzip_open(...)
	return assert(try_gzip_open(...))
end

local flush_enum = {
	none    = C.Z_NO_FLUSH,
	partial = C.Z_PARTIAL_FLUSH,
	sync    = C.Z_SYNC_FLUSH,
	full    = C.Z_FULL_FLUSH,
	finish  = C.Z_FINISH,
	block   = C.Z_BLOCK,
	trees   = C.Z_TREES,
}

local function gzflush(gzfile, flush)
	checkz(C.gzflush(gzfile, flush_enum[flush]))
end

local function gzread_tobuffer(gzfile, buf, sz)
	return checkminus1(C.gzread(gzfile, buf, sz))
end

local function gzread(gzfile, sz)
	local buf = u8a(sz)
	return str(buf, gzread_tobuffer(gzfile, buf, sz))
end

local function gzwrite(gzfile, data, sz)
	sz = C.gzwrite(gzfile, data, sz or #data)
	if sz == 0 then return nil,'error' end
	return sz
end

local function gzeof(gzfile)
	return C.gzeof(gzfile) == 1
end

local function gzseek(gzfile, ...)
	local narg = select('#',...)
	local whence, offset
	if narg == 0 then
		whence, offset = 'cur', 0
	elseif narg == 1 then
		if isstr((...)) then
			whence, offset = ..., 0
		else
			whence, offset = 'cur',...
		end
	else
		whence, offset = ...
	end
	whence = assert(whence == 'set' and 0 or whence == 'cur' and 1)
	return checkminus1(C.gzseek(gzfile, offset, whence))
end

local function gzoffset(gzfile)
	return checkminus1(C.gzoffset(gzfile))
end

metatype('gzFile_s', {__index = {
	close = gzclose,
	read = gzread,
	write = gzwrite,
	flush = gzflush,
	eof = gzeof,
	seek = gzseek,
	offset = gzoffset,
}})
