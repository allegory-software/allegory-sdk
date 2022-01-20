--[=[

	Extracting and creating zip archives (DEFLATE only).
	Written by Cosmin Apreutesei. Public Domain.

FEATURES
	* reading and writing zip archives from memory.
	* password protection with AES encryption.
	* preserving file attributes and timestamps across file systems.
	* multi-file archives.
	* following and storing symbolic links.
	* utf8 filename support.
	* zipping of central directory to reduce size.
	* generate and verify CMS file signatures.
	* recover the central directory if it is corrupt or missing.

LIMITATIONS
	* no LZMA or bzip2 (the binding supports it but the binary doesn't).
	* no stream API (use temp files, it's ok).

BROWSING
	zip.open(opt | file,[mode],[passwd]) -> rz|wz
		mode                : open mode ('r'; 'r'|'w'|'a')
		file                : open zip file from disk
		in_memory           : load whole file in memory (false)
		data                : open zip file from buffer or string
		size                : data size (#data)
		copy                : copy the buffer before loading (false)
		pattern             : filter listing entries
		ci_pattern          : filter listing entries (case insensitive)
		password            : set password (for both rz and wz)
		raw                 : set raw mode (for both rz and wz)
		encoding            : support codepages in filenames (;'utf8'|codepage)
		zip_cd              : zip the central directory (false)
		aes                 : use aes encryption (true !!!)
		store_links         : store symlinks (false)
		follow_links        : follow symlinks (false)
		compression_level   : compression level (9; 0..9)
		compression_method  : compression method ('deflate'; 'store'|'deflate')
	rz:entries() -> iter() -> e     iterate entries
	rz:first() -> t|f               goto first entry
	rz:next() -> t|f                goto next entry
	rz:find(filename[, ignore_case]) -> t|f    find entry
	rz.entry_is_dir -> t|f          is current entry a directory?
	rz:entry_hash(['md5'|'sha1'|'sha256']) -> s|false   current entry hash
	rz.sign_required = t|f          require signing
	rz.file_has_sign -> t|f         is _opened *file* entry_ signed?
	rz:file_verify_sign() -> t|f    verify signature of _opened file entry_
	rz.entry -> e                   get current entry info
		e.compression_method -> s    - compression method
		e.mtime -> ts                - last modified time
		e.atime -> ts                - last accessed time
		e.btime -> ts                - creation time
		e.crc -> n                   - crc-32
		e.compressed_size -> n       - compressed size
		e.uncompressed_size -> n     - uncompressed size
		e.disk_number -> n           - disk number start
		e.disk_offset -> n           - relative offset of local header
		e.internal_fa -> n           - internal file attributes
		e.external_fa -> n           - external file attributes
		e.filename -> s              - filename
		e.comment -> s               - comment
		e.linkname -> s              - sym-link filename
		e.zip64 -> t|f               - zip64 extension mode
		e.aes_version -> n           - winzip aes extension if not 0
		e.aes_encryption_mode -> n   - winzip aes encryption mode
	rz.pattern = s                  filter listing entries
	rz.ci_pattern = s               filter listing entries (case insensitive)
	rz|wz.password = s              set password for decryption/encryption
	rz|wz.raw = t|f                 set raw mode
	rz|wz.raw -> t|f                get raw mode
	rz|wz.zip_handle -> z           get C zip handle
	rz|wz:close()                   close the zip file

EXTRACTION
	rz:extract(to_filepath)         extract current entry to file
	rz:extract_all(to_dir)          extract all to dir
	rz:read'*a' -> s                read entire entry as string
	rz:open_entry()                 open current entry
	rz:read(buf, maxlen) -> len     read from opened entry into a buffer
	rz:close_entry()                close entry
	rz.encoding = 'utf8'|codepage   support codepages in filenames
	rz.zip_cd -> t|f                does the zip have a zipped central directory?
	rz.comment -> s                 get comment for the central directory

COMPRESSION
	wz.zip_cd = t|f                 zip the central directory
	wz.aes = t|f                    use aes encryption
	wz.store_links = t|f            store symlinks
	wz.follow_links = t|f           follow symlinks
	wz.compression_level = 0..9     set compression level
	wz.compression_method = 'store|deflate'             set compression method
	wz:add_file(filepath[, filepath_in_zip])            archive a file
	wz:add_memfile{filename=,data=,[size=],...}         add a file from a memory buffer
	wz:add_all(dir,[root_dir],[incl_path],[recursive])  add entire dir
	wz:add_all_from_zip(rz)         add all entries from other zip file
	wz:zip_cd()                     compress central directory
	wz:set_cert(cert_path[, password])   set signing certificate

All functions raise on errors, with the exception of I/O and parsing errors
on which they return `nil, err, errcode`.

Neither Windows Explorer on Windows 10 nor Total Commander can read zip files
with zipped central directory (`zip_cd` option).

Windows Explorer on Windows 10 cannot read AES-encrypted zip entries
(`aes` option, enabled by default). On the other hand, the old PKZIP
encryption (`aes = false`) is not secure at all, and can be decrypted with
specialized tools since 1990 regardless of password length. So you have
to choose between security and accessibility with this one as you can't
have both. AES encryption (`aes` option) means AES-256, the only option.

]=]

if not ... then require'minizip2_test'; return end

local ffi = require'ffi'
require'minizip2_h'
require'minizip2_rw_h'
local C = ffi.load'minizip2'
local M = {C = C}

--tools ----------------------------------------------------------------------

local glue = {}

--reverse keys with values.
function glue.index(t)
	local dt={}
	for k,v in pairs(t) do dt[v]=k end
	return dt
end

--return a metatable that supports virtual properties.
function glue.gettersandsetters(getters, setters, super)
	local get = getters and function(t, k)
		local get = getters[k]
		if get then return get(t) end
		return super and super[k]
	end
	local set = setters and function(t, k, v)
		local set = setters[k]
		if set then set(t, v); return end
		rawset(t, k, v)
	end
	return {__index = get, __newindex = set}
end

local function str(s, len)
	return s ~= nil and ffi.string(s, len) or nil
end

local function init_properties(self, t, fields)
	for k in pairs(fields) do
		if t[k] then self[k] = t[k] end
	end
end

--zip entry ------------------------------------------------------------------

local entry_get = {}
local entry_set = {}

function entry_get:filename   () return str(self.filename_ptr  , self.filename_size) end
function entry_get:comment    () return str(self.comment_ptr   , self.comment_size ) end
function entry_get:linkname   () return str(self.linkname_ptr                      ) end

function entry_set:filename   (s) self.filename_ptr = s; self.filename_size = #s end
function entry_set:comment    (s) self.comment_ptr  = s; self.comment_size  = #s end
function entry_set:linkname   (s) self.linkname_ptr = s; end

local compression_methods = {
	store   = C.MZ_COMPRESS_METHOD_STORE  ,
	deflate = C.MZ_COMPRESS_METHOD_DEFLATE,
	bzip2   = C.MZ_COMPRESS_METHOD_BZIP2  ,
	lzma    = C.MZ_COMPRESS_METHOD_LZMA   ,
	aes     = C.MZ_COMPRESS_METHOD_AES    ,
}
local compression_method_names = glue.index(compression_methods)

function entry_get:compression_method()
	return compression_method_names[self.compression_method_num]
end

local aes_bits = {
	[C.MZ_AES_ENCRYPTION_MODE_128] = 128,
	[C.MZ_AES_ENCRYPTION_MODE_192] = 192,
	[C.MZ_AES_ENCRYPTION_MODE_256] = 256,
}
function entry_get:aes_bits()
	return aes_bits[self.aes_encryption_mode]
end

function entry_get:mtime() return tonumber(self.mtime_t) end
function entry_get:atime() return tonumber(self.atime_t) end
function entry_get:btime() return tonumber(self.btime_t) end

function entry_set:mtime(t) self.mtime_t = t end
function entry_set:atime(t) self.atime_t = t end
function entry_set:btime(t) self.btime_t = t end

function entry_get:compressed_size   () return tonumber(self.compressed_size_i64  ) end
function entry_get:uncompressed_size () return tonumber(self.uncompressed_size_i64) end
function entry_get:disk_offset       () return tonumber(self.disk_offset_i64      ) end

function entry_set:compressed_size   (n) self.compressed_size_i64   = n end
function entry_set:uncompressed_size (n) self.uncompressed_size_i64 = n end
function entry_set:disk_offset       (n) self.disk_offset_i64       = n end

function entry_get:zip64             () return self.zip64_u16 == 1 end
function entry_set:zip64             (b) self.zip64_u16 = b end

ffi.metatype('mz_zip_file', glue.gettersandsetters(entry_get, entry_set))

--reader & writer ------------------------------------------------------------

ffi.cdef[[
typedef struct minizip_reader_t;
typedef struct minizip_writer_t;
]]
local reader_ptr_ct = ffi.typeof'struct minizip_reader_t*'
local writer_ptr_ct = ffi.typeof'struct minizip_writer_t*'

local reader = {}; local reader_get = {}; local reader_set = {}
local writer = {}; local writer_get = {}; local writer_set = {}

local cbuf = ffi.new'char*[1]'
local bbuf = ffi.new'uint8_t[1]'
local vbuf = ffi.new'void*[1]'

local entry_init_fields = {
	mtime=1,
	atime=1,
	btime=1,
	filename=1,
	comment=1,
	linkname=1,
}
local function mz_zip_file(t)
	local e = ffi.new'mz_zip_file'
	init_properties(e, t, entry_init_fields)
	ffi.gc(e, function() --anchor the strings
		local _ = t.filename
		local _ = t.comment
		local _ = t.linkname
	end)
	return e
end

local error_strings = {
	[C.MZ_DATA_ERROR     ] = 'data',
	[C.MZ_END_OF_STREAM  ] = 'eof',
	[C.MZ_CRC_ERROR      ] = 'crc',
	[C.MZ_CRYPT_ERROR    ] = 'crypt',
	[C.MZ_PASSWORD_ERROR ] = 'password',
	[C.MZ_SUPPORT_ERROR  ] = 'support',
	[C.MZ_HASH_ERROR     ] = 'hash',
	[C.MZ_OPEN_ERROR     ] = 'open',
	[C.MZ_EXIST_ERROR    ] = 'exist',
	[C.MZ_CLOSE_ERROR    ] = 'close',
	[C.MZ_SEEK_ERROR     ] = 'seek',
	[C.MZ_TELL_ERROR     ] = 'tell',
	[C.MZ_READ_ERROR     ] = 'read',
	[C.MZ_WRITE_ERROR    ] = 'write',
	[C.MZ_SIGN_ERROR     ] = 'sign',
	[C.MZ_SYMLINK_ERROR  ] = 'symlink',
}

local function check(err, ret)
	assert(err ~= C.MZ_PARAM_ERROR    , 'param error')
	assert(err ~= C.MZ_INTERNAL_ERROR , 'internal error')
	assert(err ~= C.MZ_STREAM_ERROR   , 'stream error')
	assert(err ~= C.MZ_MEM_ERROR      , 'memory error')
	assert(err ~= C.MZ_BUF_ERROR      , 'buffer error')
	assert(err ~= C.MZ_VERSION_ERROR  , 'version error')
	if err >= 0 then return ret end
	local err = error_strings[err] or err
	return nil, string.format('minizip %s error', err), err
end

local function checkok(err)
	return check(err, true)
end

local function checklen(err)
	return check(err, err > 0 and err or nil)
end

local function open_reader(t)
	assert(C.mz_zip_reader_create(vbuf) ~= nil)
	local z = ffi.cast(reader_ptr_ct, vbuf[0])
	init_properties(z, t, reader_set)
	local err
	if t.file then
		if t.in_memory then
			err = C.mz_zip_reader_open_file_in_memory(z, t.file)
		else
			err = C.mz_zip_reader_open_file(z, t.file)
		end
	elseif t.data then
		err = C.mz_zip_reader_open_buffer(z, t.data, t.size or #t.data, t.copy or false)
		ffi.gc(z, function() local _ = t.data end) --anchor it
	else
		--TODO: int32_t mz_zip_reader_open(void *handle, void *stream);
		assert(false)
	end
	if err ~= 0 then
 		C.mz_zip_reader_delete(vbuf)
	end
	return check(err, z)
end

local function open_writer(t)
	assert(C.mz_zip_writer_create(vbuf) ~= nil)
	local z = ffi.cast(writer_ptr_ct, vbuf[0])
	init_properties(z, t, writer_set)
	local err
	if t.file then
		err = C.mz_zip_writer_open_file(z, t.file, t.disk_size or 0, t.mode == 'a')
	else
		--TODO: int32_t mz_zip_writer_open(void *handle, void *stream);
		assert(false)
	end

	if err ~= 0 then
		C.mz_zip_writer_delete(vbuf)
	end
	return check(err, z)
end

function M.open(t, mode, password)
	if type(t) == 'string' then
		t = {file = t, mode = mode, password = password}
	end
	local open = (t.mode or 'r') == 'r' and open_reader or open_writer
	return open(t)
end

function reader:close()
	local ok, err, errcode = checkok(C.mz_zip_reader_close(self))
	vbuf[0] = self
	C.mz_zip_reader_delete(vbuf)
	if not ok then return nil, err, errcode end
	return true
end

function writer:close()
	local ok, err, errcode = checkok(C.mz_zip_writer_close(self))
	vbuf[0] = self
	C.mz_zip_writer_delete(vbuf)
	if not ok then return nil, err, errcode end
	return true
end

--reader entry catalog

local function checkeol(err)
	if err == C.MZ_END_OF_LIST then return false end
	return checkok(err)
end

function reader:first()
	return checkeol(C.mz_zip_reader_goto_first_entry(self))
end

function reader:next()
	return checkeol(C.mz_zip_reader_goto_next_entry(self))
end

function reader:find(filename, ignore_case)
	return checkeol(C.mz_zip_reader_locate_entry(self, filename, ignore_case or false))
end

local pebuf = ffi.new'mz_zip_file*[1]'
function reader_get:entry()
	assert(checkok(C.mz_zip_reader_entry_get_info(self, pebuf)))
	return pebuf[0]
end

function reader:entries()
	return function(self, e)
		if e == false then return nil end
		local ok, err, ec
		if e == nil then
			ok, err, ec = self:first()
		else
			ok, err, ec = self:next()
		end
		if ok == nil then return false, err, ec end
		if ok == false then return nil end
		local e, err, ec = self.entry
		if not e then return false, err, ec end
		return e
	end, self
end

function reader_set:pattern(pattern)
	C.mz_zip_reader_set_pattern(self, pattern, false)
end

function reader_set:ci_pattern(pattern)
	C.mz_zip_reader_set_pattern(self, pattern, true)
end

function reader_set:encoding(encoding)
	if encoding == 'utf8' then encoding = C.MZ_ENCODING_UTF8 end
	C.mz_zip_reader_set_encoding(self, encoding)
end

function reader_get:comment()
	assert(checkok(C.mz_zip_reader_get_comment(self, cbuf)))
	return str(cbuf[0])
end

function reader_get:zip_cd()
	assert(checkok(C.mz_zip_reader_get_zip_cd(self, bbuf)))
	return bbuf[0] == 1
end

--reader entry I/O

function reader:open_entry()
	return checkok(C.mz_zip_reader_entry_open(self))
end

function reader:read(buf, len)
	if buf == '*a' then --NOTE: 2GB max this way!
		local len, err = checklen(C.mz_zip_reader_entry_save_buffer_length(self))
		if not len then
			if err then return nil, err end
			return nil
		end
		local buf = ffi.new('char[?]', len)
		local ok, err, ec = checkok(C.mz_zip_reader_entry_save_buffer(self, buf, len))
		if not ok then return nil, err, ec end
		return str(buf, len)
	else
		return checklen(C.mz_zip_reader_entry_read(self, buf, len))
	end
end

function reader:close_entry()
	return checkok(C.mz_zip_reader_entry_close(self))
end

function reader:extract(dest_file)
	return checkok(C.mz_zip_reader_entry_save_file(self, dest_file))
end

function reader:extract_all(dest_dir)
	return checkok(C.mz_zip_reader_save_all(self, dest_dir))
end

local function assert_checkexist(err)
	if err == C.MZ_EXIST_ERROR then return false end
	return assert(check(err, true))
end

function reader_get:entry_is_dir()
	return assert_checkexist(C.mz_zip_reader_entry_is_dir(self))
end

local algorithms = {
	md5    = C.MZ_HASH_MD5   ,
	sha1   = C.MZ_HASH_SHA1  ,
	sha256 = C.MZ_HASH_SHA256,
}

local digest_sizes = {
	md5    = C.MZ_HASH_MD5_SIZE   ,
	sha1   = C.MZ_HASH_SHA1_SIZE  ,
	sha256 = C.MZ_HASH_SHA256_SIZE,
}

function reader:entry_hash(algorithm, hbuf, hbuf_size)
	algorithm = algorithm or 'sha256'
	local digest_size = assert(digest_sizes[algorithm])
	local algorithm   = assert(algorithms[algorithm])
	local return_string
	if not hbuf then
		return_string = true
		hbuf_size = digest_size
		hbuf = ffi.new('char[?]', digest_size)
	elseif hbuf_size < digest_size then
		return nil, digest_size
	end
	local exists = assert_checkexist(C.mz_zip_reader_entry_get_hash(
		self, algorithm, hbuf, digest_size))
	if return_string then
		return str(hbuf, digest_size)
	end
	return exists
end

function reader_set:sign_required(req)
	C.mz_zip_reader_set_sign_required(self, req and true or false)
end

function reader_get:file_has_sign()
	return assert_checkexist(C.mz_zip_reader_entry_has_sign(self))
end

function reader:file_verify_sign()
	return assert_checkexist(C.mz_zip_reader_entry_sign_verify(self))
end

function reader_set:password(password)
	C.mz_zip_reader_set_password(self, password)
end

function reader_set:raw(raw)
	C.mz_zip_reader_set_raw(self, raw)
end

function reader_get:raw()
	assert(checkok(C.mz_zip_reader_get_raw(self, bbuf)))
	return bbuf[0] == 1
end

function reader_get:zip_handle()
	assert(checkok(C.mz_zip_reader_get_zip_handle(self, vbuf)))
	return vbuf[0]
end

--writer entry catalog & I/O

function writer:add_entry(entry)
	return checkok(C.mz_zip_writer_add_info(self, nil, nil, mz_zip_file(entry)))
end

function writer:write(buf, len)
	return checklen(C.mz_zip_writer_entry_write(self, buf, len or #buf))
end

function writer:close_entry()
	return checkok(C.mz_zip_writer_entry_close(self))
end

function writer:add_file(file, filename_in_zip)
	return checkok(C.mz_zip_writer_add_file(self, file, filename_in_zip))
end

local void_ptr_ct = ffi.typeof'void*'
function writer:add_memfile(entry, ...)
	if type(entry) == 'string' then
		local data, size = ...
		entry = {filename = entry, data = data, size = size}
	end
	return checkok(C.mz_zip_writer_add_buffer(self,
		ffi.cast(void_ptr_ct, entry.data),
		entry.size or #entry.data,
		mz_zip_file(entry)))
end

function writer:add_all(dir, root_dir, include_path, recursive)
	return checkok(C.mz_zip_writer_add_path(self, dir, root_dir,
		include_path or false,
		recursive ~= false))
end

function writer:add_all_from_zip(reader)
	return checkok(C.mz_zip_writer_copy_from_reader(self, reader))
end

function writer:zip_cd()
	assert(check(C.mz_zip_writer_zip_cd(), true))
end

function writer_set:password(password)
	C.mz_zip_writer_set_password(self, password)
end

function writer_set:comment(comment)
	C.mz_zip_writer_set_comment(self, comment)
end

function writer_set:raw(raw)
	C.mz_zip_writer_set_raw(self, raw and true or false)
end

function writer_get:raw()
	assert(checkok(C.mz_zip_writer_get_raw(self, bbuf)))
	return bbuf[0] == 1
end

function writer_set:aes(aes)
	C.mz_zip_writer_set_aes(self, aes and true or false)
end

function writer_set:compression_method(s)
	C.mz_zip_writer_set_compress_method(self, compression_methods[s])
end

function writer_set:compression_level(level)
	if level <= 0 then
		self.compression_method = 'store'
	else
		C.mz_zip_writer_set_compress_level(self, math.min(math.max(level, 1), 9))
	end
end

function writer_set:follow_links(follow)
	C.mz_zip_writer_set_follow_links(self, follow and true or false)
end

function writer_set:store_links(store)
	C.mz_zip_writer_set_store_links(self, store and true or false)
end

function writer_set:zip_cd(zip_it)
	C.mz_zip_writer_set_zip_cd(self, zip_it and true or false)
end

function writer:set_cert(path, pwd)
	assert(checkok(C.mz_zip_writer_set_certificate(self, path, pwd)))
end

function writer_get:zip_handle()
	assert(checkok(C.mz_zip_writer_get_zip_handle(self, vbuf)))
	return vbuf[0]
end

ffi.metatype('struct minizip_reader_t', glue.gettersandsetters(reader_get, reader_set, reader))
ffi.metatype('struct minizip_writer_t', glue.gettersandsetters(writer_get, writer_set, writer))

return M
