--[=[

	JPEG encoding and decoding (based on libjpeg-turbo).
	Written by Cosmin Apreutesei. Public domain.

	Supports progressive loading, yielding from the reader function,
	partial loading, fractional scaling and multiple pixel formats.

	[try_]jpeg_open(opt|read) -> jpg  open a JPEG image for decoding
	  read(buf, len) -> len|0|nil     read function (can yield)
	  partial_loading                 load broken images partially (true)
	  warning                         f(msg, level) for non-fatal errors
	  read_buffer                     the read buffer to use (optional)
	  read_buffer_size                size of read_buffer (64K)
	jpg.format, jpg.w, jpg.h          JPEG file native format and dimensions
	jpg.progressive                   JPEG file is progressive
	jpg.jfif                          JFIF marker (see code)
	jpg.adobe                         Adobe marker (see code)
	jpg:[try_]load([opt]) -> bmp      load the image into a bitmap
	  accept.FORMAT                   specify one or more accepted formats (*)
	  accept.bottom_up                output bitmap should be upside-down (false).
	  accept.stride_aligned           row stride should be a multiple of 4 (false).
	  scale_num, scale_denom          scale down the image by scale_num/scale_denom.
	    the only supported scaling ratios are M/8 with all M from 1 to 16,
		 or any reduced fraction thereof (such as 1/2, 3/4, etc.). Smaller scaling ratios permit significantly faster decoding since
	  fewer pixels need be processed and a simpler IDCT method can be used.
	  * `dct_method`: `'accurate'`, `'fast'`, `'float'` (default is `'accurate'`)
	  * `fancy_upsampling`: `true/false` (default is `false`); use a fancier
	  upsampling method.
	  * `block_smoothing`: `true/false` (default is `false`); smooth out large
	  pixels of early progression stages for progressive JPEGs.
	jpg.partial                       JPEG file is truncated (see after loading)
	jpg:free()                        free the image
	jpeg_decoder() -> decode()        create a push-style decode function.
	[try_]jpeg_save(opt)              compress a bitmap into a JPEG image

jpeg_open(opt | read) -> jpg

	Open a JPEG image and read its header. The supplied read function can yield
	and it can signal I/O errors by returning `nil,err` or by raising an error.
	It will only be asked to read a positive number of bytes and it can return
	less bytes than asked, including zero which signals EOF.

	Unknown JPEG formats are opened but the `format` field is missing.

	Arithmetic decoding doesn't work with suspended I/O and we need that to
	allow the read callback to yield (browsers don't support arithmetic
	decoding either for the same reason).

	TIP: Wrap `tcp:read()` from sock.lua to read from a TCP socket.
	TIP: Use `f:*_reader()` from fs.lua to read from a file.

jpg:load([opt]) -> bmp

	Load the image, returning a bitmap object.

Format Conversions

 * ycc8 g8  => rgb8 bgr8 rgba8 bgra8 argb8 abgr8 rgbx8 bgrx8 xrgb8 xbgr8 g8
 * ycck8    => cmyk8

NOTE: As can be seen, not all conversions are possible with libjpeg-turbo,
so always check the image's `format` field to get the actual format. Use
bitmap.lua to further convert the image if necessary.

For more info on the decoding process and options read the [libjpeg-turbo doc].

NOTE: the number of bits per channel in the output bitmap is always 8.

[try_]jpeg_save(opt)

	Encode a bitmap as JPEG. `opt` is a table containing at least
	the source bitmap and an output write function, and possibly other options:

	* bitmap       : a [bitmap] in an accepted format.
	* write        : write function write(buf, size) -> true | nil,err.
	* finish       : optional function to be called after all the data is written.
	* format       : output format (see list of supported formats above).
	* quality      : you know what that is (0..100).
	* progressive  : make it progressive (false).
	* dct_method   : 'accurate', 'fast', 'float' ('accurate').
	* optimize_coding : optimize Huffmann tables.
	* smoothing    : smoothing factor (0..100).
	* write_buffer_size : internal buffer size (64K).
	* write_buffer : internal buffer (default is to internally allocate one).

]=]

if not ... then require'jpeg_test'; return end

require'glue'
require'libjpeg_h'
local C = ffi.load'jpeg'

cdef'void *memmove(void *dest, const void *src, size_t n);'

local LIBJPEG_VERSION = 62

--NOTE: images with C.JCS_UNKNOWN format are not supported.
local formats = {
	[C.JCS_GRAYSCALE]= 'g8',
	[C.JCS_YCbCr]    = 'ycc8',
	[C.JCS_CMYK]     = 'cmyk8',
	[C.JCS_YCCK]     = 'ycck8',
	[C.JCS_RGB]      = 'rgb8',
	--libjpeg-turbo only
	[C.JCS_EXT_RGB]  = 'rgb8',
	[C.JCS_EXT_BGR]  = 'bgr8',
	[C.JCS_EXT_RGBX] = 'rgbx8',
	[C.JCS_EXT_BGRX] = 'bgrx8',
	[C.JCS_EXT_XRGB] = 'xrgb8',
	[C.JCS_EXT_XBGR] = 'xbgr8',
	[C.JCS_EXT_RGBA] = 'rgba8',
	[C.JCS_EXT_BGRA] = 'bgra8',
	[C.JCS_EXT_ARGB] = 'argb8',
	[C.JCS_EXT_ABGR] = 'abgr8',
}

local channel_count = {
	g8 = 1, ycc8 = 3, cmyk8 = 4, ycck8 = 4, rgb8 = 3, bgr8 = 3,
	rgbx8 = 4, bgrx8 = 4, xrgb8 = 4, xbgr8 = 4,
	rgba8 = 4, bgra8 = 4, argb8 = 4, abgr8 = 4,
}

local color_spaces = index(formats)

--all conversions that libjpeg implements, in order of preference.
--{source = {dest1, ...}}
local conversions = {
	ycc8 = {'rgb8', 'bgr8', 'rgba8', 'bgra8', 'argb8', 'abgr8', 'rgbx8',
		'bgrx8', 'xrgb8', 'xbgr8', 'g8'},
	g8 = {'rgb8', 'bgr8', 'rgba8', 'bgra8', 'argb8', 'abgr8', 'rgbx8', 'bgrx8',
		'xrgb8', 'xbgr8'},
	ycck8 = {'cmyk8'},
}

--given current pixel format of an image and an accept table,
--choose the best accepted pixel format.
local function best_format(format, accept)
	if not accept or accept[format] then --no preference or source format accepted
		return format
	end
	if conversions[format] then
		for _,dformat in ipairs(conversions[format]) do
			if accept[dformat] then --convertible to the best accepted format
				return dformat
			end
		end
	end
	return format --not convertible
end

--given a row stride, return the next larger stride that is a multiple of 4.
local function pad_stride(stride)
	return bit.band(stride + 3, bit.bnot(3))
end

--create a callback manager object and its destructor.
local function callback_manager(mgr_ct, callbacks)
	local mgr = new(mgr_ct)
	local cbt = {}
	for k,f in pairs(callbacks) do
		if isfunc(f) then
			cbt[k] = cast(format('jpeg_%s_callback', k), f)
			mgr[k] = cbt[k]
		else
			mgr[k] = f
		end
	end
	local function free()
		for k,cb in pairs(cbt) do
			mgr[k] = nil --anchor mgr
			cb:free()
		end
	end
	return mgr, free
end

--end-of-image marker, inserted on EOF for partial display of broken images.
local JPEG_EOI = char(0xff, 0xD9):rep(32)

local dct_methods = {
	accurate = C.JDCT_ISLOW,
	fast     = C.JDCT_IFAST,
	float    = C.JDCT_FLOAT,
}

local ccptr_ct = ctype'const uint8_t*' --const prevents copying

--create and setup a error handling object.
local function jpeg_err(t)
	local jerr = new'jpeg_error_mgr'
	C.jpeg_std_error(jerr)
	local err_cb = cast('jpeg_error_exit_callback', function(cinfo)
		local buf = new'uint8_t[512]'
		cinfo.err.format_message(cinfo, buf)
		error(str(buf))
	end)
	local warnbuf --cache this buffer because there are a ton of messages
	local emit_cb = cast('jpeg_emit_message_callback', function(cinfo, level)
		if t.warning then
			warnbuf = warnbuf or new'uint8_t[512]'
			cinfo.err.format_message(cinfo, warnbuf)
			t.warning(str(warnbuf), level)
		end
	end)
	local function free() --anchor jerr, err_cb, emit_cb
		C.jpeg_std_error(jerr) --reset jerr fields
		err_cb:free()
		emit_cb:free()
	end
	jerr.error_exit = err_cb
	jerr.emit_message = emit_cb
	return jerr, free
end

--create a top-down or bottom-up array of rows pointing to a bitmap buffer.
local function rows_buffer(h, bottom_up, data, stride)
	local rows = new('uint8_t*[?]', h)
	local data = cast(u8p, data)
	if bottom_up then
		for i=0,h-1 do
			rows[h-1-i] = data + (i * stride)
		end
	else
		for i=0,h-1 do
			rows[i] = data + (i * stride)
		end
	end
	return rows
end

--jit-off all callback-calling functions
local function jpeg_read_header(cinfo, require_image)
	return C.jpeg_read_header(cinfo, require_image)
end
jit.off(jpeg_read_header)

local function jpeg_start_decompress(cinfo)
	return C.jpeg_start_decompress(cinfo)
end
jit.off(jpeg_start_decompress)

local function jpeg_input_complete(cinfo)
	return C.jpeg_input_complete(cinfo)
end
jit.off(jpeg_input_complete)

local function jpeg_consume_input(cinfo)
	return C.jpeg_consume_input(cinfo)
end
jit.off(jpeg_consume_input)

local function jpeg_read_scanlines(cinfo, scan_lines, max_lines)
	return C.jpeg_read_scanlines(cinfo, scan_lines, max_lines)
end
jit.off(jpeg_read_scanlines)

local function jpeg_finish_output(cinfo)
	return C.jpeg_finish_output(cinfo)
end
jit.off(jpeg_finish_output)

local function jpeg_finish_decompress(cinfo)
	return C.jpeg_finish_decompress(cinfo)
end
jit.off(jpeg_finish_decompress)

function try_jpeg_open(opt)

	--normalize args
	if isfunc(opt) then
		opt = {read = opt}
	end
	local read = assert(opt.read, 'read expected')

	--create a global free function and finalizer accumulator
	local free_t = {} --{free1, ...}
	local function free()
		if not free_t then return end
		for i = #free_t, 1, -1 do
			free_t[i]()
		end
		free_t = nil
	end
	local function finally(func)
		add(free_t, func)
	end

	--create the state object and output image
	local cinfo = new'jpeg_decompress_struct'
	local img = {}

	img.free = free

	--setup error handling
	local jerr, jerr_free = jpeg_err(opt)
	cinfo.err = jerr
	finally(jerr_free)

	--init state
	C.jpeg_CreateDecompress(cinfo,
		opt.lib_version or LIBJPEG_VERSION,
		sizeof(cinfo))

	finally(function()
		C.jpeg_destroy_decompress(cinfo)
		cinfo = nil
	end)

	gc(cinfo, free)

	local function check(ret, err)
		if ret then return ret end
		free()
		raise('jpeg', '%s', err)
	end

	--create the buffer filling function for suspended I/O
	local partial_loading = opt.partial_loading ~= false
	local sz   = opt.read_buffer_size or 64 * 1024
	local buf  = opt.read_buffer or u8a(sz)
	local bytes_to_skip = 0

	--create a skip buffer if the reader doesn't support seeking.
	local skip_buf_sz, skip_buf = 1/0
	if opt.skip_buffer ~= false then
		skip_buf_sz = opt.skip_buffer_size or 64 * 1024
		skip_buf    = opt.skip_buffer or u8a(skip_buf_sz)
	end

	local function fill_input_buffer()
		while bytes_to_skip > 0 do
			local sz = min(skip_buf_sz, bytes_to_skip)
			local readsz = check(read(skip_buf, sz))
			check(readsz > 0, 'eof')
			bytes_to_skip = bytes_to_skip - readsz
		end
		local ofs = tonumber(cinfo.src.bytes_in_buffer)
		--move the data after the restart point to the start of the buffer
		ffi.C.memmove(buf, cinfo.src.next_input_byte, ofs)
		--move the restart point to the start of the buffer
		cinfo.src.next_input_byte = buf
		--fill the rest of the buffer
		local sz = sz - ofs
		check(sz > 0, 'buffer too small')
		local readsz = check(read(buf + ofs, sz))
		if readsz == 0 then --eof
			check(partial_loading, 'eof')
			readsz = #JPEG_EOI
			check(readsz <= sz, 'buffer too small')
			copy(buf + ofs, JPEG_EOI)
			img.partial = true
		end
		cinfo.src.bytes_in_buffer = ofs + readsz
	end

	--create source callbacks
	local cb = {}
	cb.init_source = pass
	cb.term_source = pass
	cb.resync_to_restart = C.jpeg_resync_to_restart

	function cb.fill_input_buffer(cinfo)
		return false --suspended I/O mode
	end
	function cb.skip_input_data(cinfo, sz)
		if sz <= 0 then return end
		if sz >= cinfo.src.bytes_in_buffer then
			bytes_to_skip = sz - tonumber(cinfo.src.bytes_in_buffer)
			cinfo.src.bytes_in_buffer = 0
		else
			bytes_to_skip = 0
			cinfo.src.bytes_in_buffer = cinfo.src.bytes_in_buffer - sz
			cinfo.src.next_input_byte = cinfo.src.next_input_byte + sz
		end
	end

	--create a source manager and set it up
	local mgr, free_mgr = callback_manager('jpeg_source_mgr', cb)
	cinfo.src = mgr
	finally(free_mgr)
	cinfo.src.bytes_in_buffer = 0
	cinfo.src.next_input_byte = nil

	local function load_header()

		while jpeg_read_header(cinfo, 1) == C.JPEG_SUSPENDED do
			fill_input_buffer()
		end

		img.w = cinfo.image_width
		img.h = cinfo.image_height
		img.format = formats[tonumber(cinfo.jpeg_color_space)]
		img.progressive = C.jpeg_has_multiple_scans(cinfo) ~= 0

		img.jfif = cinfo.saw_JFIF_marker == 1 and {
			maj_ver = cinfo.JFIF_major_version,
			min_ver = cinfo.JFIF_minor_version,
			density_unit = cinfo.density_unit,
			x_density = cinfo.X_density,
			y_density = cinfo.Y_density,
		} or nil

		img.adobe = cinfo.saw_Adobe_marker == 1 and {
			transform = cinfo.Adobe_transform,
		} or nil
	end

	local ok, err = pcall(load_header)
	if not ok then
		free()
		assert(iserror(err, 'jpeg'), err)
		return nil, err
	end

	function img.load(img, opt)
		opt = opt or empty
		local bmp = {}
		--find the best accepted output pixel format
		check(img.format, 'invalid pixel format')
		check(cinfo.num_components == channel_count[img.format])
		bmp.format = best_format(img.format, opt.accept)

		--set decompression options
		cinfo.out_color_space = check(color_spaces[bmp.format])
		cinfo.output_components = channel_count[bmp.format]
		cinfo.scale_num   = opt.scale_num or 1
		cinfo.scale_denom = opt.scale_denom or 1
		local dct_method = dct_methods[opt.dct_method or 'accurate']
		cinfo.dct_method = check(dct_method, 'invalid dct_method')
		cinfo.do_fancy_upsampling = opt.fancy_upsampling or false
		cinfo.do_block_smoothing  = opt.block_smoothing or false
		cinfo.buffered_image = 1 --multi-scan reading

		--start decompression, which fills the info about the output image
		while jpeg_start_decompress(cinfo) == 0 do
			fill_input_buffer()
		end

		--get info about the output image
		bmp.w = cinfo.output_width
		bmp.h = cinfo.output_height

		--compute the stride
		bmp.stride = cinfo.output_width * cinfo.output_components
		if opt.accept and opt.accept.stride_aligned then
			bmp.stride = pad_stride(bmp.stride)
		end

		--allocate image and row buffers
		bmp.size = bmp.h * bmp.stride
		bmp.data = u8a(bmp.size)
		bmp.bottom_up = opt.accept and opt.accept.bottom_up

		bmp.rows = rows_buffer(bmp.h, bmp.bottom_up, bmp.data, bmp.stride)

		--decompress the image
		while jpeg_input_complete(cinfo) == 0 do

			--read all the scanlines of the current scan
			local ret
			repeat
				ret = jpeg_consume_input(cinfo)
				if ret == C.JPEG_SUSPENDED then
					fill_input_buffer()
				end
			until ret == C.JPEG_REACHED_EOI or ret == C.JPEG_SCAN_COMPLETED
			local last_scan = ret == C.JPEG_REACHED_EOI

			--render the scan
			C.jpeg_start_output(cinfo, cinfo.input_scan_number)

			--read all the scanlines into the row buffers
			while cinfo.output_scanline < bmp.h do

				--read several scanlines at once, depending on the size of the output buffer
				local i = cinfo.output_scanline
				local n = min(bmp.h - i, cinfo.rec_outbuf_height)
				while jpeg_read_scanlines(cinfo, bmp.rows + i, n) < n do
					fill_input_buffer()
				end
			end

			--call the rendering callback on the converted image
			if opt.render_scan then
				opt.render_scan(bmp, last_scan, cinfo.output_scan_number)
			end

			while jpeg_finish_output(cinfo) == 0 do
				fill_input_buffer()
			end

		end

		while jpeg_finish_decompress(cinfo) == 0 do
			fill_input_buffer()
		end

		return bmp
	end
	img.try_load = protect('jpeg', img.load)

	return img
end
jpeg_open = protect('jpeg', try_jpeg_open)

--returns a `decode(buf, len) -> nil,'more' | bmp` function to be called
--repeatedly while `nil,'more'` is returned and then a bitmap is returned.
function jpeg_decoder()
	require'sock'
	local decode = cowrap(function(yield)
		local jp, err = try_jpeg_open(yield)
		if not jp then return nil, err end
		local bmp = jp:load()
		jp:free()
		return true, bmp
	end)
	local buf, sz = decode()
	if not buf then return nil, sz end
	return function(p, len)
		while len > 0 do
			local n = min(len, sz)
			copy(buf, p, n)
			buf, sz = decode(n)
			if buf == true then return sz end --return bmp
			if not buf then return nil, sz end --error
			len = len - n
			p = p + n
		end
		return nil, 'more' --signal "need more data"
	end
end

function try_jpeg_save(opt)
	return fpcall(function(finally)

		--create the state object
		local cinfo = new'jpeg_compress_struct'

		--setup error handling
		local jerr, jerr_free = jpeg_err(opt)
		cinfo.err = jerr
		finally(jerr_free)

		--init state
		C.jpeg_CreateCompress(cinfo,
			opt.lib_version or LIBJPEG_VERSION,
			sizeof(cinfo))

		finally(function()
			C.jpeg_destroy_compress(cinfo)
		end)

		local write = opt.write
		local finish = opt.finish or pass

		--create the dest. buffer
		local sz = opt.write_buffer_size or 64 * 1024
		local buf = opt.write_buffer or u8a(sz)

		--create destination callbacks
		local cb = {}

		function cb.init_destination(cinfo)
			cinfo.dest.next_output_byte = buf
			cinfo.dest.free_in_buffer = sz
		end

		function cb.term_destination(cinfo)
			assert(write(buf, sz - tonumber(cinfo.dest.free_in_buffer)))
			finish()
		end

		function cb.empty_output_buffer(cinfo)
			assert(write(buf, sz))
			cb.init_destination(cinfo)
			return true
		end

		--create a destination manager and set it up
		local mgr, free_mgr = callback_manager('jpeg_destination_mgr', cb)
		cinfo.dest = mgr
		finally(free_mgr) --the finalizer anchors mgr through free_mgr!

		--set the source format
		cinfo.image_width  = opt.bitmap.w
		cinfo.image_height = opt.bitmap.h
		cinfo.in_color_space =
			assert(color_spaces[opt.bitmap.format], 'invalid source format')
		cinfo.input_components =
			assert(channel_count[opt.bitmap.format], 'invalid source format')

		--set the default compression options based on in_color_space
		C.jpeg_set_defaults(cinfo)

		--set compression options
		if opt.format then
			C.jpeg_set_colorspace(cinfo,
				assert(color_spaces[opt.format], 'invalid destination format'))
		end
		if opt.quality then
			C.jpeg_set_quality(cinfo, opt.quality, true)
		end
		if opt.progressive then
			C.jpeg_simple_progression(cinfo)
		end
		if opt.dct_method then
			cinfo.dct_method =
				assert(dct_methods[opt.dct_method], 'invalid dct_method')
		end
		if opt.optimize_coding then
			cinfo.optimize_coding = opt.optimize_coding
		end
		if opt.smoothing then
			cinfo.smoothing_factor = opt.smoothing
		end

		--start the compression cycle
		C.jpeg_start_compress(cinfo, true)

		--make row pointers from the bitmap buffer
		local bmp = opt.bitmap
		local rows = bmp.rows or rows_buffer(bmp.h, bmp.bottom_up, bmp.data, bmp.stride)

		--compress rows
		C.jpeg_write_scanlines(cinfo, rows, bmp.h)

		--finish the compression, optionally adding additional scans
		C.jpeg_finish_compress(cinfo)

	end)
end
jit.off(try_jpeg_save, true)

function jpeg_save(...)
	return assert(try_jpeg_save(...))
end
