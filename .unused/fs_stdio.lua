--[[

	fileno(FILE*) -> fd                           get stream's file descriptor
	file_wrap_file(FILE*, ...) -> f               wrap opened FILE* object

STDIO STREAMS
	f:stream(mode) -> fs                          open a FILE* object from a file
	fs:[try_]close()                              close the FILE* object

Stdio Streams ----------------------------------------------------------------

f:stream(mode) -> fs

	Open a `FILE*` object from a file. The file should not be used anymore while
	a stream is open on it and `fs:close()` should be called to close the file.

fs:[try_]close()

	Close the `FILE*` object and the underlying file object.

]]

local stream = {}; stream.__index = stream --FILE methods

cdef[[
int fileno(struct FILE *stream);
]]

function fileno(F)
	local fd = C.fileno(F)
	if fd == -1 then return check_errno() end
	return fd
end

function file_wrap_file(F, opt)
	local fd = C.fileno(F)
	if fd == -1 then return check_errno() end
	return file_wrap_fd(fd, opt, 'file')
end

--stdio streams --------------------------------------------------------------

cdef[[
typedef struct FILE FILE;
FILE *fdopen(int fd, const char *mode);
int fclose(FILE*);
]]

stream_ct = ctype'struct FILE'

function stream.close(fs)
	return check_errno(C.fclose(fs) == 0)
end

function file.stream(f, mode)
	local fs = C.fdopen(f.fd, mode)
	if fs == nil then return check_errno() end
	return fs
end

metatype(stream_ct, stream)

--tests ----------------------------------------------------------------------

function test.wrap_file() --indirectly tests wrap_fd() and wrap_handle()
	local name = 'fs_test_wrap_file'
	rmfile(name)
	local f = io.open(name, 'w')
	f:write'hello'
	f:flush()
	if Linux then
		os.execute'sleep .2' --WTF??
	end
	local f2 = file_wrap_file(f)
	assert(f2:attr'size' == 5)
	f:close()
	rmfile(name)
end

function test.stream()
	local testfile = 'fs_test'
	local f = open(testfile, 'w'):stream('w')
	f:close()
	local f = open(testfile, 'r'):stream('r')
	f:close()
	rmfile(testfile)
end
