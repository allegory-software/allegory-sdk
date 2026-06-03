--[=[

	PNG encoding and decoding with libspng (not yieldable).
	Written by Cosmin Apreutesei. Public Domain.

	[try_]png_open(opt|read) -> png    open a PNG image for decoding
	  read(buf, len) -> len|0|nil,err  the read function (can't yield)
	png.format, png.w, png.h       PNG file native format and dimensions
	png.interlaced                 PNG file is interlaced
	png.indexed                    PNG file is palette-based

	png:[try_]load([opt]) -> bmp       load the image into a bitmap
	  opt.accept            : {FORMAT->true}
	    FORMAT: bgra8, rgba8, rgba16, rgb8, g8, ga8, ga16.
	  opt.bottom_up         : bottom-up bitmap (false).
	  opt.stride_aligned    : align stride to 4 bytes (false).
	  opt.gamma             : decode and apply gamma (only for RGB(A) output; false).
	  opt.premultiply_alpha : premultiply the alpha channel (true).

	png:free()                     free the image

	[try_]png_load(file) -> png, bmp    load a png from a file
	[try_]png_save(opt)                 encode a bitmap into a PNG image

[try_]png_open(opt) -> png

	Open a PNG image and read its header. The supplied read function cannot
	yield and must signal I/O errors by returning `nil,err` or raising a
	structured I/O error. It will only be asked to read a positive number of
	bytes and it can return less bytes than asked, including zero which
	signals EOF.

png:[try_]load(opt) -> bmp

	If no `accept` option is given or no conversion is possible, the image
	is returned in the native format, transparency not decoded, gamma not
	decoded palette not expanded. To avoid this from happening, accept at
	least one RGB(A) output format (see [1]).

	[1]: https://github.com/randy408/libspng/blob/master/docs/decode.md#supported-format-flag-combinations

	The returned bitmap has:

		* standard bitmap fields: format, bottom_up, stride, data, size, w, h.
		* partial: image wasn't fully read (read_error contains the error).

[try_]png_save(opt)

	Encode a bitmap as PNG. `opt` is a table containing at least the source
	bitmap and an output write function, and possibly other options:

	bitmap  : a bitmap in an accepted format:
		'g1', 'g2', 'g4', 'g8', 'g16', 'ga8', 'ga16',
		'rgb8', 'rgba8', 'bgra8', 'rgba16', 'i1', 'i2', 'i4', 'i8'`.
	write   : write data to a sink of form `write(buf, len) -> true/nil | nil,err`
	(cannot yield).
	chunks  : list of PNG chunks to encode.

]=]

if not ... then require'png_test'; return end

require'glue'
local C = ffi.load'spng'

cdef[[

enum spng_text_type
{
	SPNG_TEXT = 1,
	SPNG_ZTXT = 2,
	SPNG_ITXT = 3
};

enum spng_color_type
{
	SPNG_COLOR_TYPE_GRAYSCALE = 0,
	SPNG_COLOR_TYPE_TRUECOLOR = 2,
	SPNG_COLOR_TYPE_INDEXED = 3,
	SPNG_COLOR_TYPE_GRAYSCALE_ALPHA = 4,
	SPNG_COLOR_TYPE_TRUECOLOR_ALPHA = 6
};

enum spng_filter
{
	SPNG_FILTER_NONE = 0,
	SPNG_FILTER_SUB = 1,
	SPNG_FILTER_UP = 2,
	SPNG_FILTER_AVERAGE = 3,
	SPNG_FILTER_PAETH = 4
};

enum spng_filter_choice
{
	SPNG_DISABLE_FILTERING = 0,
	SPNG_FILTER_CHOICE_NONE = 8,
	SPNG_FILTER_CHOICE_SUB = 16,
	SPNG_FILTER_CHOICE_UP = 32,
	SPNG_FILTER_CHOICE_AVG = 64,
	SPNG_FILTER_CHOICE_PAETH = 128,
	SPNG_FILTER_CHOICE_ALL = (8|16|32|64|128)
};

enum spng_interlace_method
{
	SPNG_INTERLACE_NONE = 0,
	SPNG_INTERLACE_ADAM7 = 1
};

/* Channels are always in byte-order */
enum spng_format
{
	SPNG_FMT_RGBA8 = 1,
	SPNG_FMT_RGBA16 = 2,
	SPNG_FMT_RGB8 = 4,

	/* Partially implemented, see documentation */
	SPNG_FMT_GA8 = 16,
	SPNG_FMT_GA16 = 32,
	SPNG_FMT_G8 = 64,

	/* No conversion or scaling */
	SPNG_FMT_PNG = 256, /* host-endian */
	SPNG_FMT_RAW = 512  /* big-endian */
};

enum spng_ctx_flags
{
	SPNG_CTX_IGNORE_ADLER32 = 1, /* Ignore checksum in DEFLATE streams */
	SPNG_CTX_ENCODER = 2 /* Create an encoder context */
};

enum spng_decode_flags
{
	SPNG_DECODE_USE_TRNS = 1, /* Deprecated */
	SPNG_DECODE_USE_GAMA = 2, /* Deprecated */
	SPNG_DECODE_USE_SBIT = 8, /* Undocumented */

	SPNG_DECODE_TRNS = 1, /* Apply transparency */
	SPNG_DECODE_GAMMA = 2, /* Apply gamma correction */
	SPNG_DECODE_PROGRESSIVE = 256 /* Initialize for progressive reads */
};

enum spng_crc_action
{
	/* Default for critical chunks */
	SPNG_CRC_ERROR = 0,

	/* Discard chunk, invalid for critical chunks.
	   Since v0.6.2: default for ancillary chunks */
	SPNG_CRC_DISCARD = 1,

	/* Ignore and don't calculate checksum.
	   Since v0.6.2: also ignores checksums in DEFLATE streams */
	SPNG_CRC_USE = 2
};

enum spng_encode_flags
{
	SPNG_ENCODE_PROGRESSIVE = 1, /* Initialize for progressive writes */
	SPNG_ENCODE_FINALIZE = 2, /* Finalize PNG after encoding image */
};

struct spng_ihdr
{
	uint32_t width;
	uint32_t height;
	uint8_t bit_depth;
	uint8_t color_type;
	uint8_t compression_method;
	uint8_t filter_method;
	uint8_t interlace_method;
};

struct spng_plte_entry
{
	uint8_t red;
	uint8_t green;
	uint8_t blue;

	uint8_t alpha; /* Reserved for internal use */
};

struct spng_plte
{
	uint32_t n_entries;
	struct spng_plte_entry entries[256];
};

struct spng_trns
{
	uint16_t gray;

	uint16_t red;
	uint16_t green;
	uint16_t blue;

	uint32_t n_type3_entries;
	uint8_t type3_alpha[256];
};

struct spng_chrm_int
{
	uint32_t white_point_x;
	uint32_t white_point_y;
	uint32_t red_x;
	uint32_t red_y;
	uint32_t green_x;
	uint32_t green_y;
	uint32_t blue_x;
	uint32_t blue_y;
};

struct spng_chrm
{
	double white_point_x;
	double white_point_y;
	double red_x;
	double red_y;
	double green_x;
	double green_y;
	double blue_x;
	double blue_y;
};

struct spng_iccp
{
	char profile_name[80];
	size_t profile_len;
	char *profile;
};

struct spng_sbit
{
	uint8_t grayscale_bits;
	uint8_t red_bits;
	uint8_t green_bits;
	uint8_t blue_bits;
	uint8_t alpha_bits;
};

struct spng_text
{
	char keyword[80];
	int type;

	size_t length;
	char *text;

	uint8_t compression_flag; /* iTXt only */
	uint8_t compression_method; /* iTXt, ztXt only */
	char *language_tag; /* iTXt only */
	char *translated_keyword; /* iTXt only */
};

struct spng_bkgd
{
	uint16_t gray; /* Only for gray/gray alpha */
	uint16_t red;
	uint16_t green;
	uint16_t blue;
	uint16_t plte_index; /* Only for indexed color */
};

struct spng_hist
{
	uint16_t frequency[256];
};

struct spng_phys
{
	uint32_t ppu_x, ppu_y;
	uint8_t unit_specifier;
};

struct spng_splt_entry
{
	uint16_t red;
	uint16_t green;
	uint16_t blue;
	uint16_t alpha;
	uint16_t frequency;
};

struct spng_splt
{
	char name[80];
	uint8_t sample_depth;
	uint32_t n_entries;
	struct spng_splt_entry *entries;
};

struct spng_time
{
	uint16_t year;
	uint8_t month;
	uint8_t day;
	uint8_t hour;
	uint8_t minute;
	uint8_t second;
};

struct spng_offs
{
	int32_t x, y;
	uint8_t unit_specifier;
};

struct spng_exif
{
	size_t length;
	char *data;
};

struct spng_chunk
{
	size_t offset;
	uint32_t length;
	uint8_t type[4];
	uint32_t crc;
};

enum spng_location
{
	SPNG_AFTER_IHDR = 1,
	SPNG_AFTER_PLTE = 2,
	SPNG_AFTER_IDAT = 8,
};

struct spng_unknown_chunk
{
	uint8_t type[4];
	size_t length;
	void *data;
	enum spng_location location;
};

enum spng_option
{
	SPNG_KEEP_UNKNOWN_CHUNKS = 1,

	SPNG_IMG_COMPRESSION_LEVEL,
	SPNG_IMG_WINDOW_BITS,
	SPNG_IMG_MEM_LEVEL,
	SPNG_IMG_COMPRESSION_STRATEGY,

	SPNG_TEXT_COMPRESSION_LEVEL,
	SPNG_TEXT_WINDOW_BITS,
	SPNG_TEXT_MEM_LEVEL,
	SPNG_TEXT_COMPRESSION_STRATEGY,

	SPNG_FILTER_CHOICE,
	SPNG_CHUNK_COUNT_LIMIT,
	SPNG_ENCODE_TO_BUFFER,
};

struct spng_row_info
{
	uint32_t scanline_idx;
	uint32_t row_num; /* deinterlaced row index */
	int pass;
	uint8_t filter;
};

const char *spng_strerror(int err);
const char *spng_version_string(void);

typedef struct spng_ctx spng_ctx;
spng_ctx *spng_ctx_new(int flags);
void spng_ctx_free(spng_ctx *ctx);

typedef int spng_rw_fn(spng_ctx *ctx, void *user, uint8_t *dst_src, size_t length);
int spng_set_png_stream(spng_ctx *ctx, spng_rw_fn *rw_func, void *user);

int spng_set_image_limits(spng_ctx *ctx, uint32_t width, uint32_t height);
int spng_get_image_limits(spng_ctx *ctx, uint32_t *width, uint32_t *height);
int spng_set_chunk_limits(spng_ctx *ctx, size_t chunk_size, size_t cache_size);
int spng_get_chunk_limits(spng_ctx *ctx, size_t *chunk_size, size_t *cache_size);
int spng_set_crc_action(spng_ctx *ctx, int critical, int ancillary);
int spng_set_option(spng_ctx *ctx, enum spng_option option, int value);
int spng_get_option(spng_ctx *ctx, enum spng_option option, int *value);

/* Decode */
int spng_decoded_image_size(spng_ctx *ctx, int fmt, size_t *len);
int spng_decode_image(spng_ctx *ctx, void *out, size_t len, int fmt, int flags);
int spng_decode_row(spng_ctx *ctx, void *out, size_t len);
int spng_decode_chunks(spng_ctx *ctx);

/* Encode/decode */
int spng_get_row_info(spng_ctx *ctx, struct spng_row_info *row_info);

/* Encode */
int spng_encode_image(spng_ctx *ctx, const void *img, size_t len, int fmt, int flags);
int spng_encode_chunks(spng_ctx *ctx);

int spng_get_ihdr(spng_ctx *ctx, struct spng_ihdr *ihdr);
int spng_get_plte(spng_ctx *ctx, struct spng_plte *plte);
int spng_get_trns(spng_ctx *ctx, struct spng_trns *trns);
int spng_get_chrm(spng_ctx *ctx, struct spng_chrm *chrm);
int spng_get_chrm_int(spng_ctx *ctx, struct spng_chrm_int *chrm_int);
int spng_get_gama(spng_ctx *ctx, double *gamma);
int spng_get_gama_int(spng_ctx *ctx, uint32_t *gama_int);
int spng_get_iccp(spng_ctx *ctx, struct spng_iccp *iccp);
int spng_get_sbit(spng_ctx *ctx, struct spng_sbit *sbit);
int spng_get_srgb(spng_ctx *ctx, uint8_t *rendering_intent);
int spng_get_text(spng_ctx *ctx, struct spng_text *text, uint32_t *n_text);
int spng_get_bkgd(spng_ctx *ctx, struct spng_bkgd *bkgd);
int spng_get_hist(spng_ctx *ctx, struct spng_hist *hist);
int spng_get_phys(spng_ctx *ctx, struct spng_phys *phys);
int spng_get_splt(spng_ctx *ctx, struct spng_splt *splt, uint32_t *n_splt);
int spng_get_time(spng_ctx *ctx, struct spng_time *time);
int spng_get_unknown_chunks(spng_ctx *ctx, struct spng_unknown_chunk *chunks, uint32_t *n_chunks);
int spng_get_offs(spng_ctx *ctx, struct spng_offs *offs);
int spng_get_exif(spng_ctx *ctx, struct spng_exif *exif);

int spng_set_ihdr(spng_ctx *ctx, struct spng_ihdr *ihdr);
int spng_set_plte(spng_ctx *ctx, struct spng_plte *plte);
int spng_set_trns(spng_ctx *ctx, struct spng_trns *trns);
int spng_set_chrm(spng_ctx *ctx, struct spng_chrm *chrm);
int spng_set_chrm_int(spng_ctx *ctx, struct spng_chrm_int *chrm_int);
int spng_set_gama(spng_ctx *ctx, double gamma);
int spng_set_gama_int(spng_ctx *ctx, uint32_t gamma);
int spng_set_iccp(spng_ctx *ctx, struct spng_iccp *iccp);
int spng_set_sbit(spng_ctx *ctx, struct spng_sbit *sbit);
int spng_set_srgb(spng_ctx *ctx, uint8_t rendering_intent);
int spng_set_text(spng_ctx *ctx, struct spng_text *text, uint32_t n_text);
int spng_set_bkgd(spng_ctx *ctx, struct spng_bkgd *bkgd);
int spng_set_hist(spng_ctx *ctx, struct spng_hist *hist);
int spng_set_phys(spng_ctx *ctx, struct spng_phys *phys);
int spng_set_splt(spng_ctx *ctx, struct spng_splt *splt, uint32_t n_splt);
int spng_set_time(spng_ctx *ctx, struct spng_time *time);
int spng_set_unknown_chunks(spng_ctx *ctx, struct spng_unknown_chunk *chunks, uint32_t n_chunks);
int spng_set_offs(spng_ctx *ctx, struct spng_offs *offs);
int spng_set_exif(spng_ctx *ctx, struct spng_exif *exif);

/* extensions for luapower ffi binding */
void spng_rgba8_to_bgra8(void* p, uint32_t n);
void spng_premultiply_alpha_rgba8(void* p, uint32_t n);
void spng_premultiply_alpha_rgba16(void* p, uint32_t n);
void spng_premultiply_alpha_ga8(void* p, uint32_t n);
void spng_premultiply_alpha_ga16(void* p, uint32_t n);
]]

--given a row stride, return the next larger stride that is a multiple of 4.
local function pad_stride(stride)
	return band(stride + 3, bnot(3))
end

local formats = {                                --bpc:
	[C.SPNG_COLOR_TYPE_GRAYSCALE      ] = 'g'   , --1,2,4,8,16
	[C.SPNG_COLOR_TYPE_TRUECOLOR      ] = 'rgb' , --8,16
	[C.SPNG_COLOR_TYPE_INDEXED        ] = 'i'   , --8 (with 1,2,4,8 indexes)
	[C.SPNG_COLOR_TYPE_GRAYSCALE_ALPHA] = 'ga'  , --8,16
	[C.SPNG_COLOR_TYPE_TRUECOLOR_ALPHA] = 'rgba', --8,16
}

--all conversions that libspng implements, in order of preference,
--with or without gamma conversion: {source = {dest1, ...}}.
local rgb8   = {'rgba8', 'bgra8', 'rgb8', 'rgba16'}
local rgba8  = {'rgba8', 'bgra8', 'rgba16', 'rgb8'}
local rgb16  = {'rgba16', 'rgba8', 'bgra8', 'rgb8'}
local rgba16 = {'rgba16', 'rgba8', 'bgra8', 'rgb8'}
local g8     = {'ga8', 'rgba8', 'bgra8', 'rgba16', 'g8', 'rgb8'}
local ga8    = {'ga8', 'rgba8', 'bgra8', 'rgba16', 'g8', 'rgb8'}
local g16    = {'ga16', 'rgba16', 'rgba8', 'bgra8', 'rgb8'}
local ga16   = {'ga16', 'rgba16', 'rgba8', 'bgra8', 'rgb8'}
local conversions = {
	g1     = g8,
	g2     = g8,
	g4     = g8,
	g8     = g8,
	g16    = g16,
	ga8    = ga8,
	ga16   = ga16,
	rgb8   = rgb8,
	rgba8  = rgba8,
	rgb16  = rgb16,
	rgba16 = rgba16,
	i1     = rgb8,
	i2     = rgb8,
	i4     = rgb8,
	i8     = rgb8,
}

local dest_formats_no_gamma = {
	rgba8  = C.SPNG_FMT_RGBA8,
	bgra8  = C.SPNG_FMT_RGBA8,
	rgba16 = C.SPNG_FMT_RGBA16,
	rgb8   = C.SPNG_FMT_RGB8,
	g8     = C.SPNG_FMT_G8,
	ga16   = C.SPNG_FMT_GA16,
	ga8    = C.SPNG_FMT_GA8,
}

local dest_formats_gamma = {
	rgba8  = C.SPNG_FMT_RGBA8,
	bgra8  = C.SPNG_FMT_RGBA8,
	rgba16 = C.SPNG_FMT_RGBA16,
	rgb8   = C.SPNG_FMT_RGB8,
}

local function best_fmt(raw_fmt, accept, gamma)
	local dest_formats = gamma and dest_formats_gamma or dest_formats_no_gamma
	if accept and conversions[raw_fmt] then --source format convertible
		for _,bmp_fmt in ipairs(conversions[raw_fmt]) do
			if accept[bmp_fmt] then --found a dest format
				local spng_fmt = dest_formats[bmp_fmt]
				if spng_fmt then --dest format is available
					return bmp_fmt, spng_fmt
				end
			end
		end
	end
	return raw_fmt, C.SPNG_FMT_PNG
end

local function struct_getter(ct, get) --getter for a struct type
	local ct = ctype(ct)
	return function(ctx)
		local s = ct()
		return get(ctx, s) == 0 and s or nil
	end
end
local function prim_getter(ct, get) --getter for a primitive type
	local ct = ctype(ct)
	return function(ctx)
		local s = ct()
		return get(ctx, s) == 0 and s[0] or nil
	end
end
local function list_getter(ct, get) --getter for a list of structs
	local ct = ctype(ct)
	return function(ctx)
		local n = u32a(1)
		if get(ctx, nil, n) ~= 0 then return nil end
		n = n[0]
		local s = ct(n)
		if get(ctx, s, n) ~= 0 then return nil end
		return s, n
	end
end
local chunk_decoders = {
	ihdr     = struct_getter('struct spng_ihdr'    , C.spng_get_ihdr),
	plte     = struct_getter('struct spng_plte'    , C.spng_get_plte),
	trns     = struct_getter('struct spng_trns'    , C.spng_get_trns),
	chrm     = struct_getter('struct spng_chrm'    , C.spng_get_chrm),
	chrm_int = struct_getter('struct spng_chrm_int', C.spng_get_chrm_int),
	gama     =   prim_getter('double[1]'           , C.spng_get_gama),
	gama_int =   prim_getter('uint32_t[1]'         , C.spng_get_gama_int),
	iccp     = struct_getter('struct spng_iccp'    , C.spng_get_iccp),
	sbit     = struct_getter('struct spng_sbit'    , C.spng_get_sbit),
	srgb     =   prim_getter('uint8_t[1]'          , C.spng_get_srgb),
	bkgd     = struct_getter('struct spng_bkgd'    , C.spng_get_bkgd),
	hist     = struct_getter('struct spng_hist'    , C.spng_get_hist),
	phys     = struct_getter('struct spng_phys'    , C.spng_get_phys),
	time     = struct_getter('struct spng_time'    , C.spng_get_time),
	text     =   list_getter('struct spng_text[?]' , C.spng_get_text),
	splt     =   list_getter('struct spng_splt[?]' , C.spng_get_splt),
	offs     = struct_getter('struct spng_offs'    , C.spng_get_offs),
	exif     = struct_getter('struct spng_exif'    , C.spng_get_exif),
	unknown  =   list_getter('struct spng_unknown_chunk', C.spng_get_unknown_chunks),
}

local rw_fn_ct = ctype'spng_rw_fn*'
--^^ very important to ctype() this to avoid "table overflow" !

local premultiply_funcs = {
	rgba8  = C.spng_premultiply_alpha_rgba8,
	bgra8  = C.spng_premultiply_alpha_rgba8,
	rgba16 = C.spng_premultiply_alpha_rgba16,
	ga8    = C.spng_premultiply_alpha_ga8,
	ga16   = C.spng_premultiply_alpha_ga16,
}

function try_png_open(opt)
	opt = isfunc(opt) and {read = opt} or opt or empty
	local read = assert(opt.read, 'read expected')

	local ctx = C.spng_ctx_new(0)
	assert(ctx ~= nil)

	local read_cb
	local function free()
		if read_cb then read_cb:free(); read_cb = nil end
		if ctx then C.spng_ctx_free(ctx); ctx = nil end
	end

	local function check(ret)
		if ret == 0 then return true end
		free()
		return nil, str(C.spng_strerror(ret))
	end

	local read_err
	local function spng_read(ctx, _, buf, len)
		len = tonumber(len)
		::again::
		local ok, sz, err = catch('fs pipe net', read, buf, len)
		if not ok then read_err = sz; return -2 end --SPNG_IO_ERROR
		if not sz then read_err = err; return -2 end --SPNG_IO_ERROR
		if sz == 0 then return -1 end -- SPNG_IO_EOF
		if sz < len then --partial read
			len = len - sz
			buf = buf + sz
			goto again
		end
		return 0
	end

	--[[local]] read_cb = cast(rw_fn_ct, spng_read)
	local ok, err = check(C.spng_set_png_stream(ctx, read_cb, nil))
	if not ok then
		return nil, err
	end
	local ok, err = check(C.spng_decode_chunks(ctx))
	if not ok then
		return nil, read_err or err
	end

	local img = {free = free}

	function img:chunk(name)
		local decode = chunk_decoders[name]
		if not decode then
			return nil, 'unknown chunk name '..name
		end
		return decode(ctx)
	end

	local ihdr = img:chunk'ihdr'
	if not ihdr then
		free()
		return nil, 'invalid header'
	end
	img.w = ihdr.width
	img.h = ihdr.height
	local bpc = ihdr.bit_depth
	img.format = formats[ihdr.color_type]..bpc
	img.interlaced = ihdr.interlace_method ~= C.SPNG_INTERLACE_NONE or nil
	img.indexed = ihdr.color_type == C.SPNG_COLOR_TYPE_INDEXED or nil
	ihdr = nil

	function img:try_load(opt)
		opt = opt or empty
		local bmp_fmt, spng_fmt = best_fmt(img.format, opt.accept, opt.gamma)

		local nb = new'size_t[1]'
		local ok, err = check(C.spng_decoded_image_size(ctx, spng_fmt, nb))
		if not ok then
			return nil, err
		end
		local row_size = tonumber(nb[0]) / img.h

		local bmp = {w = img.w, h = img.h, format = bmp_fmt}

		bmp.stride = row_size
		if opt.accept and opt.accept.stride_aligned then
			bmp.stride = pad_stride(bmp.stride)
		end
		bmp.size = bmp.stride * bmp.h
		bmp.data = u8a(bmp.size)

		local flags = bor(
			C.SPNG_DECODE_TRNS,
			opt.gamma and C.SPNG_DECODE_GAMMA or 0,
			C.SPNG_DECODE_PROGRESSIVE
		)
		C.spng_decode_image(ctx, nil, 0, spng_fmt, flags)

		local row_info = new'struct spng_row_info'
		local bottom_up = opt.accept and opt.accept.bottom_up
		bmp.bottom_up = bottom_up
		local row_sz = bmp.size / bmp.h

		local function check_partial(ret)
			if ret == 0 then return end
			bmp.partial = true
			bmp.read_error = read_err or select(2, check(ret))
			return true
		end
		while true do
			if check_partial(C.spng_get_row_info(ctx, row_info)) then break end
			local i = row_info.row_num
			if bottom_up then i = img.h - i - 1 end
			local row = bmp.data + bmp.stride * i
			local ret = C.spng_decode_row(ctx, row, row_size)
			if ret == 75 then break end --SPNG_EOI
			if check_partial(ret) then break end
		end

		local premultiply_alpha =
			(not opt or opt.premultiply_alpha ~= false)
			and (img.format:find('a', 1, true) or img:chunk'trns')
			and premultiply_funcs[bmp.format]
		if premultiply_alpha then
			premultiply_alpha(bmp.data, bmp.size)
		end

		if bmp.format == 'bgra8' then --cairo's native format.
			C.spng_rgba8_to_bgra8(bmp.data, bmp.size)
		end

		return bmp
	end
	function img:load(...)
		return assert(self:try_load(...))
	end
	jit.off(img.load) --calls back into Lua through a ffi call.

	return img
end
jit.off(try_png_open) --calls back into Lua through a ffi call.

function png_open(...)
	return assert(try_png_open(...))
end

local function struct_setter(ct, set) --setter for a struct type
	local ct = ctype(ct)
	return function(ctx, v)
		local s = ct(v)
		return set(ctx, s) == 0
	end
end
local function prim_setter(ct, set) --setter for a primitive type
	local ct = ctype(ct)
	return function(ctx, v)
		local s = ct(v)
		return set(ctx, s) == 0
	end
end
local function list_setter(ct, set) --setter for a list of structs
	local ct = ctype(ct)
	return function(ctx, v)
		local t = ct(#v, v)
		return set(ctx, t, #v) == 0
	end
end
local chunk_encoders = {
	ihdr     = struct_setter('struct spng_ihdr'    , C.spng_set_ihdr),
	plte     = struct_setter('struct spng_plte'    , C.spng_set_plte),
	trns     = struct_setter('struct spng_trns'    , C.spng_set_trns),
	chrm     = struct_setter('struct spng_chrm'    , C.spng_set_chrm),
	chrm_int = struct_setter('struct spng_chrm_int', C.spng_set_chrm_int),
	gama     =   prim_setter('double[1]'           , C.spng_set_gama),
	gama_int =   prim_setter('uint32_t[1]'         , C.spng_set_gama_int),
	iccp     = struct_setter('struct spng_iccp'    , C.spng_set_iccp),
	sbit     = struct_setter('struct spng_sbit'    , C.spng_set_sbit),
	srgb     =   prim_setter('uint8_t[1]'          , C.spng_set_srgb),
	bkgd     = struct_setter('struct spng_bkgd'    , C.spng_set_bkgd),
	hist     = struct_setter('struct spng_hist'    , C.spng_set_hist),
	phys     = struct_setter('struct spng_phys'    , C.spng_set_phys),
	time     = struct_setter('struct spng_time'    , C.spng_set_time),
	text     =   list_setter('struct spng_text[?]' , C.spng_set_text),
	splt     =   list_setter('struct spng_splt[?]' , C.spng_set_splt),
	offs     = struct_setter('struct spng_offs'    , C.spng_set_offs),
	exif     = struct_setter('struct spng_exif'    , C.spng_set_exif),
	unknown  =   list_setter('struct spng_unknown_chunk', C.spng_set_unknown_chunks),
}

local color_types = {
	g1     = C.SPNG_COLOR_TYPE_GRAYSCALE,
	g2     = C.SPNG_COLOR_TYPE_GRAYSCALE,
	g4     = C.SPNG_COLOR_TYPE_GRAYSCALE,
	g8     = C.SPNG_COLOR_TYPE_GRAYSCALE,
	g16    = C.SPNG_COLOR_TYPE_GRAYSCALE,
	ga8    = C.SPNG_COLOR_TYPE_GRAYSCALE_ALPHA,
	ga16   = C.SPNG_COLOR_TYPE_GRAYSCALE_ALPHA,
	rgb8   = C.SPNG_COLOR_TYPE_TRUECOLOR,
	rgba8  = C.SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
	bgra8  = C.SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
	rgba16 = C.SPNG_COLOR_TYPE_TRUECOLOR_ALPHA,
	i1     = C.SPNG_COLOR_TYPE_INDEXED,
	i2     = C.SPNG_COLOR_TYPE_INDEXED,
	i4     = C.SPNG_COLOR_TYPE_INDEXED,
	i8     = C.SPNG_COLOR_TYPE_INDEXED,
}

function try_png_save(opt)
	opt = opt or empty
	local bmp = assert(opt.bitmap, 'bitmap expected')
	local write = assert(opt.write, 'write expected')
	if bmp.bottom_up then
		return nil, 'bottom-up bitmap NYI'
	end

	local ctx = C.spng_ctx_new(C.SPNG_CTX_ENCODER)
	assert(ctx ~= nil)

	local write_cb
	local function free()
		if write_cb then write_cb:free(); write_cb = nil end
		if ctx then C.spng_ctx_free(ctx); ctx = nil end
	end

	local function check(ret)
		if ret == 0 then return true end
		free()
		return nil, str(C.spng_strerror(ret))
	end

	local write_err
	local function spng_write(ctx, _, buf, len)
		len = tonumber(len)
		local caught, ok, err = catch('fs pipe net', write, buf, len)
		if not caught then write_err = ok; return -2 end --SPNG_IO_ERROR
		if ok == false or err ~= nil then write_err = err; return -2 end --SPNG_IO_ERROR
		return 0
	end

	--[[local]] write_cb = cast(rw_fn_ct, spng_write)
	local ok, err = check(C.spng_set_png_stream(ctx, write_cb, nil))
	if not ok then
		return nil, err
	end

	local color_type = color_types[bmp.format]
	local bpc = tonumber(bmp.format:match'%d+$')
	if not color_type or not bpc then
		return nil, 'invalid format '..bmp.format
	end

	assert(chunk_encoders.ihdr(ctx, {
		width      = bmp.w,
		height     = bmp.h,
		bit_depth  = bpc,
		color_type = color_type,
		compression_method = 0,
		filter_method      = 0,
		interlace_method   = 0,
	}))

	if opt.chunks then
		for name, v in pairs(opt.chunks) do
			local encode = assert(chunk_encoders[name], 'unknown chunk '..name)
			assert(encode(ctx, v), 'invalid chunk '..name)
		end
	end

	local data = bmp.data
	if bmp.format == 'bgra8' then
		data = u8a(bmp.size)
		copy(data, bmp.data, bmp.size)
		C.spng_rgba8_to_bgra8(data, bmp.size)
	end

	local fmt = C.SPNG_FMT_PNG
	local flags = C.SPNG_ENCODE_FINALIZE
	local ok, err = check(C.spng_encode_image(ctx, data, bmp.size, fmt, flags))
	if not ok then
		return nil, write_err or err
	end

	return true
end
jit.off(try_png_save) --calls back into Lua through a ffi call.

function png_save(...)
	return assert(try_png_save(...))
end

function try_png_load(file)
	require'pbuffer'
	local f, err = open(file)
	if not f then return nil, err end
	local img, err = try_png_open{read = pbuffer{f = f}:reader()}
	if not img then return nil, err end
	local bmp, err = img:try_load{accept = {bgra8 = true}}
	f:try_close()
	if not bmp then return nil, err end
	return img, bmp
end
function png_load(file)
	local img, bmp = try_png_load(file)
	--TODO: distinguish between I/O errors (retriable) and content errors.
	check_for('png', file, 'load', img, bmp) --bmp=err
	return img, bmp
end

--[[
	TODO: finish this but: do we sync() ?

	[try_]png_save(bmp, file)           encode a bitmap into a PNG image

function try_png_save(bmp, file)
	local f = open(file, 'w')
	local ok, err = try_png_save{
		bitmap = bmp,
		write = function(buf, sz)
			return catch('io', f.write, f, buf, sz)
		end,
	}
	if not ok then f:try_close(); return nil, err end
	local ok, err = catch('fs pipe net', f.sync, f); if not ok then f:try_close(); return nil, err end
	local ok, err = f:try_close(); if not ok then return nil, err end
	return true
end
function png_save(bmp, file)
	local ok, err = try_png_save(file)
	--TODO: distinguish between I/O errors (retriable) and content errors.
	check_for('png', file, 'save', ok, err)
end
]]
