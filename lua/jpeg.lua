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
	jpeg_decoder() -> thread          create a push-style decoder
	- thread.decode(buf, len) -> nil,'more' | bmp    call repeatedly to decode chunks
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
local C = ffi.load'jpeg'

--result of `cpp jpeglib.h` from libjpeg-turbo 1.2.1 with JPEG_LIB_VERSION = 62.
--added a few new typedefs for useful structs and callbacks.
cdef[[
typedef int boolean;
typedef struct FILE FILE;

enum {
	JPEG_SUSPENDED,     /* Suspended due to lack of input data */
	JPEG_REACHED_SOS,   /* Reached start of new scan */
	JPEG_REACHED_EOI,   /* Reached end of image */
	JPEG_ROW_COMPLETED, /* Completed one iMCU row */
	JPEG_SCAN_COMPLETED /* Completed last iMCU row of a scan */
};
typedef short INT16;
typedef signed int INT32;
typedef unsigned char JSAMPLE;
typedef short JCOEF;
typedef unsigned char JOCTET;
typedef unsigned char UINT8;
typedef unsigned short UINT16;
typedef unsigned int JDIMENSION;
typedef JSAMPLE *JSAMPROW;
typedef JSAMPROW *JSAMPARRAY;
typedef JSAMPARRAY *JSAMPIMAGE;
typedef JCOEF JBLOCK[64];
typedef JBLOCK *JBLOCKROW;
typedef JBLOCKROW *JBLOCKARRAY;
typedef JBLOCKARRAY *JBLOCKIMAGE;
typedef JCOEF *JCOEFPTR;

typedef struct {
	UINT16 quantval[64];
	boolean sent_table;
} JQUANT_TBL;

typedef struct {
	UINT8 bits[17];
	UINT8 huffval[256];
	boolean sent_table;
} JHUFF_TBL;

typedef struct {
	int component_id;
	int component_index;
	int h_samp_factor;
	int v_samp_factor;
	int quant_tbl_no;
	int dc_tbl_no;
	int ac_tbl_no;
	JDIMENSION width_in_blocks;
	JDIMENSION height_in_blocks;
	int DCT_scaled_size;
	JDIMENSION downsampled_width;
	JDIMENSION downsampled_height;
	boolean component_needed;
	int MCU_width;
	int MCU_height;
	int MCU_blocks;
	int MCU_sample_width;
	int last_col_width;
	int last_row_height;
	JQUANT_TBL * quant_table;
	void * dct_table;
} jpeg_component_info;

typedef struct {
	int comps_in_scan;
	int component_index[4];
	int Ss, Se;
	int Ah, Al;
} jpeg_scan_info;

typedef struct jpeg_marker_struct * jpeg_saved_marker_ptr;

struct jpeg_marker_struct {
	jpeg_saved_marker_ptr next;
	UINT8 marker;
	unsigned int original_length;
	unsigned int data_length;
	JOCTET * data;
};

typedef enum {
	JCS_UNKNOWN,
	JCS_GRAYSCALE,
	JCS_RGB,
	JCS_YCbCr,
	JCS_CMYK,
	JCS_YCCK,
	/* libjpeg-turbo only */
	JCS_EXT_RGB,
	JCS_EXT_RGBX,
	JCS_EXT_BGR,
	JCS_EXT_BGRX,
	JCS_EXT_XBGR,
	JCS_EXT_XRGB,
	JCS_EXT_RGBA,
	JCS_EXT_BGRA,
	JCS_EXT_ABGR,
	JCS_EXT_ARGB
} J_COLOR_SPACE;

typedef enum {
	JDCT_ISLOW,
	JDCT_IFAST,
	JDCT_FLOAT
} J_DCT_METHOD;

typedef enum {
	JDITHER_NONE,
	JDITHER_ORDERED,
	JDITHER_FS
} J_DITHER_MODE;

struct jpeg_common_struct {
  struct jpeg_error_mgr * err;
  struct jpeg_memory_mgr * mem;
  struct jpeg_progress_mgr * progress;
  void * client_data;
  boolean is_decompressor;
  int global_state;
};

typedef struct jpeg_common_struct * j_common_ptr;
typedef struct jpeg_compress_struct * j_compress_ptr;
typedef struct jpeg_decompress_struct * j_decompress_ptr;

typedef struct jpeg_compress_struct {
	struct jpeg_error_mgr * err;
	struct jpeg_memory_mgr * mem;
	struct jpeg_progress_mgr * progress;
	void * client_data;
	boolean is_decompressor;
	int global_state;
	struct jpeg_destination_mgr * dest;
	JDIMENSION image_width;
	JDIMENSION image_height;
	int input_components;
	J_COLOR_SPACE in_color_space;
	double input_gamma;
	int data_precision;
	int num_components;
	J_COLOR_SPACE jpeg_color_space;
	jpeg_component_info * comp_info;
	JQUANT_TBL * quant_tbl_ptrs[4];
	JHUFF_TBL * dc_huff_tbl_ptrs[4];
	JHUFF_TBL * ac_huff_tbl_ptrs[4];
	UINT8 arith_dc_L[16];
	UINT8 arith_dc_U[16];
	UINT8 arith_ac_K[16];
	int num_scans;
	const jpeg_scan_info * scan_info;
	boolean raw_data_in;
	boolean arith_code;
	boolean optimize_coding;
	boolean CCIR601_sampling;
	int smoothing_factor;
	J_DCT_METHOD dct_method;
	unsigned int restart_interval;
	int restart_in_rows;
	boolean write_JFIF_header;
	UINT8 JFIF_major_version;
	UINT8 JFIF_minor_version;
	UINT8 density_unit;
	UINT16 X_density;
	UINT16 Y_density;
	boolean write_Adobe_marker;
	JDIMENSION next_scanline;
	boolean progressive_mode;
	int max_h_samp_factor;
	int max_v_samp_factor;
	JDIMENSION total_iMCU_rows;
	int comps_in_scan;
	jpeg_component_info * cur_comp_info[4];
	JDIMENSION MCUs_per_row;
	JDIMENSION MCU_rows_in_scan;
	int blocks_in_MCU;
	int MCU_membership[10];
	int Ss, Se, Ah, Al;
	struct jpeg_comp_master * master;
	struct jpeg_c_main_controller * main;
	struct jpeg_c_prep_controller * prep;
	struct jpeg_c_coef_controller * coef;
	struct jpeg_marker_writer * marker;
	struct jpeg_color_converter * cconvert;
	struct jpeg_downsampler * downsample;
	struct jpeg_forward_dct * fdct;
	struct jpeg_entropy_encoder * entropy;
	jpeg_scan_info * script_space;
	int script_space_size;
} jpeg_compress_struct;

typedef struct jpeg_decompress_struct {
	struct jpeg_error_mgr * err;
	struct jpeg_memory_mgr * mem;
	struct jpeg_progress_mgr * progress;
	void * client_data;
	boolean is_decompressor;
	int global_state;
	struct jpeg_source_mgr * src;
	JDIMENSION image_width;
	JDIMENSION image_height;
	int num_components;
	J_COLOR_SPACE jpeg_color_space;
	J_COLOR_SPACE out_color_space;
	unsigned int scale_num, scale_denom;
	double output_gamma;
	boolean buffered_image;
	boolean raw_data_out;
	J_DCT_METHOD dct_method;
	boolean do_fancy_upsampling;
	boolean do_block_smoothing;
	boolean quantize_colors;
	J_DITHER_MODE dither_mode;
	boolean two_pass_quantize;
	int desired_number_of_colors;
	boolean enable_1pass_quant;
	boolean enable_external_quant;
	boolean enable_2pass_quant;
	JDIMENSION output_width;
	JDIMENSION output_height;
	int out_color_components;
	int output_components;
	int rec_outbuf_height;
	int actual_number_of_colors;
	JSAMPARRAY colormap;
	JDIMENSION output_scanline;
	int input_scan_number;
	JDIMENSION input_iMCU_row;
	int output_scan_number;
	JDIMENSION output_iMCU_row;
	int (*coef_bits)[64];
	JQUANT_TBL * quant_tbl_ptrs[4];
	JHUFF_TBL * dc_huff_tbl_ptrs[4];
	JHUFF_TBL * ac_huff_tbl_ptrs[4];
	int data_precision;
	jpeg_component_info * comp_info;
	boolean progressive_mode;
	boolean arith_code;
	UINT8 arith_dc_L[16];
	UINT8 arith_dc_U[16];
	UINT8 arith_ac_K[16];
	unsigned int restart_interval;
	boolean saw_JFIF_marker;
	UINT8 JFIF_major_version;
	UINT8 JFIF_minor_version;
	UINT8 density_unit;
	UINT16 X_density;
	UINT16 Y_density;
	boolean saw_Adobe_marker;
	UINT8 Adobe_transform;
	boolean CCIR601_sampling;
	jpeg_saved_marker_ptr marker_list;
	int max_h_samp_factor;
	int max_v_samp_factor;
	int min_DCT_scaled_size;
	JDIMENSION total_iMCU_rows;
	JSAMPLE * sample_range_limit;
	int comps_in_scan;
	jpeg_component_info * cur_comp_info[4];
	JDIMENSION MCUs_per_row;
	JDIMENSION MCU_rows_in_scan;
	int blocks_in_MCU;
	int MCU_membership[10];
	int Ss, Se, Ah, Al;
	int unread_marker;
	struct jpeg_decomp_master * master;
	struct jpeg_d_main_controller * main;
	struct jpeg_d_coef_controller * coef;
	struct jpeg_d_post_controller * post;
	struct jpeg_input_controller * inputctl;
	struct jpeg_marker_reader * marker;
	struct jpeg_entropy_decoder * entropy;
	struct jpeg_inverse_dct * idct;
	struct jpeg_upsampler * upsample;
	struct jpeg_color_deconverter * cconvert;
	struct jpeg_color_quantizer * cquantize;
} jpeg_decompress_struct;

typedef void (*jpeg_error_exit_callback) (j_common_ptr cinfo);
typedef void (*jpeg_emit_message_callback) (j_common_ptr cinfo, int msg_level);
typedef void (*jpeg_output_message_callback) (j_common_ptr cinfo);
typedef void (*jpeg_format_message_callback) (j_common_ptr cinfo, char * buffer);

typedef struct jpeg_error_mgr {
	jpeg_error_exit_callback error_exit;
	jpeg_emit_message_callback emit_message;
	jpeg_output_message_callback output_message;
	jpeg_format_message_callback format_message;
	void (*reset_error_mgr) (j_common_ptr cinfo);
	int msg_code;
	union {
		int i[8];
		char s[80];
	} msg_parm;
	int trace_level;
	long num_warnings;
	const char * const * jpeg_message_table;
	int last_jpeg_message;
	const char * const * addon_message_table;
	int first_addon_message;
	int last_addon_message;
} jpeg_error_mgr;

struct jpeg_progress_mgr {
	void (*progress_monitor) (j_common_ptr cinfo);
	long pass_counter;
	long pass_limit;
	int completed_passes;
	int total_passes;
};

typedef void    (*jpeg_init_destination_callback)    (j_compress_ptr cinfo);
typedef boolean (*jpeg_empty_output_buffer_callback) (j_compress_ptr cinfo);
typedef void    (*jpeg_term_destination_callback)    (j_compress_ptr cinfo);

typedef struct jpeg_destination_mgr {
	JOCTET * next_output_byte;
	size_t free_in_buffer;
	jpeg_init_destination_callback     init_destination;
	jpeg_empty_output_buffer_callback  empty_output_buffer;
	jpeg_term_destination_callback     term_destination;
} jpeg_destination_mgr;

typedef void    (*jpeg_init_source_callback)       (j_decompress_ptr cinfo);
typedef boolean (*jpeg_fill_input_buffer_callback) (j_decompress_ptr cinfo);
typedef void    (*jpeg_skip_input_data_callback)   (j_decompress_ptr cinfo, long num_bytes);
typedef boolean (*jpeg_resync_to_restart_callback) (j_decompress_ptr cinfo, int desired);
typedef void    (*jpeg_term_source_callback)       (j_decompress_ptr cinfo);

typedef struct jpeg_source_mgr {
	const JOCTET * next_input_byte;
	size_t bytes_in_buffer;
	jpeg_init_source_callback        init_source;
	jpeg_fill_input_buffer_callback  fill_input_buffer;
	jpeg_skip_input_data_callback    skip_input_data;
	jpeg_resync_to_restart_callback  resync_to_restart;
	jpeg_term_source_callback        term_source;
} jpeg_source_mgr;

typedef struct jvirt_sarray_control * jvirt_sarray_ptr;
typedef struct jvirt_barray_control * jvirt_barray_ptr;

struct jpeg_memory_mgr {
  void * (*alloc_small) (j_common_ptr cinfo, int pool_id, size_t sizeofobject);
  void * (*alloc_large) (j_common_ptr cinfo, int pool_id, size_t sizeofobject);
  JSAMPARRAY (*alloc_sarray) (j_common_ptr cinfo, int pool_id, JDIMENSION samplesperrow, JDIMENSION numrows);
  JBLOCKARRAY (*alloc_barray) (j_common_ptr cinfo, int pool_id, JDIMENSION blocksperrow, JDIMENSION numrows);
  jvirt_sarray_ptr (*request_virt_sarray) (j_common_ptr cinfo, int pool_id, boolean pre_zero, JDIMENSION samplesperrow, JDIMENSION numrows, JDIMENSION maxaccess);
  jvirt_barray_ptr (*request_virt_barray) (j_common_ptr cinfo, int pool_id, boolean pre_zero, JDIMENSION blocksperrow, JDIMENSION numrows, JDIMENSION maxaccess);
  void (*realize_virt_arrays) (j_common_ptr cinfo);
  JSAMPARRAY (*access_virt_sarray) (j_common_ptr cinfo, jvirt_sarray_ptr ptr, JDIMENSION start_row, JDIMENSION num_rows, boolean writable);
  JBLOCKARRAY (*access_virt_barray) (j_common_ptr cinfo, jvirt_barray_ptr ptr, JDIMENSION start_row, JDIMENSION num_rows, boolean writable);
  void (*free_pool) (j_common_ptr cinfo, int pool_id);
  void (*self_destruct) (j_common_ptr cinfo);
  long max_memory_to_use;
  long max_alloc_chunk;
};

typedef boolean (*jpeg_marker_parser_method) (j_decompress_ptr cinfo);

struct jpeg_error_mgr * jpeg_std_error (struct jpeg_error_mgr * err);

void jpeg_CreateCompress (j_compress_ptr cinfo, int version, size_t structsize);
void jpeg_CreateDecompress (j_decompress_ptr cinfo, int version, size_t structsize);
void jpeg_destroy_compress (j_compress_ptr cinfo);
void jpeg_destroy_decompress (j_decompress_ptr cinfo);
void jpeg_stdio_dest (j_compress_ptr cinfo, FILE * outfile);
void jpeg_stdio_src (j_decompress_ptr cinfo, FILE * infile);
void jpeg_set_defaults (j_compress_ptr cinfo);
void jpeg_set_colorspace (j_compress_ptr cinfo, J_COLOR_SPACE colorspace);
void jpeg_default_colorspace (j_compress_ptr cinfo);
void jpeg_set_quality (j_compress_ptr cinfo, int quality, boolean force_baseline);
void jpeg_set_linear_quality (j_compress_ptr cinfo, int scale_factor, boolean force_baseline);
void jpeg_add_quant_table (j_compress_ptr cinfo, int which_tbl, const unsigned int *basic_table, int scale_factor, boolean force_baseline);
int jpeg_quality_scaling (int quality);
void jpeg_simple_progression (j_compress_ptr cinfo);
void jpeg_suppress_tables (j_compress_ptr cinfo, boolean suppress);
JQUANT_TBL * jpeg_alloc_quant_table (j_common_ptr cinfo);
JHUFF_TBL * jpeg_alloc_huff_table (j_common_ptr cinfo);
void jpeg_start_compress (j_compress_ptr cinfo, boolean write_all_tables);
JDIMENSION jpeg_write_scanlines (j_compress_ptr cinfo, JSAMPARRAY scanlines, JDIMENSION num_lines);
void jpeg_finish_compress (j_compress_ptr cinfo);
JDIMENSION jpeg_write_raw_data (j_compress_ptr cinfo, JSAMPIMAGE data, JDIMENSION num_lines);
void jpeg_write_marker (j_compress_ptr cinfo, int marker, const JOCTET * dataptr, unsigned int datalen);
void jpeg_write_m_header (j_compress_ptr cinfo, int marker, unsigned int datalen);
void jpeg_write_m_byte (j_compress_ptr cinfo, int val);
void jpeg_write_tables (j_compress_ptr cinfo);
int jpeg_read_header (j_decompress_ptr cinfo, boolean require_image);
boolean jpeg_start_decompress (j_decompress_ptr cinfo);
JDIMENSION jpeg_read_scanlines (j_decompress_ptr cinfo, JSAMPARRAY scanlines, JDIMENSION max_lines);
boolean jpeg_finish_decompress (j_decompress_ptr cinfo);
JDIMENSION jpeg_read_raw_data (j_decompress_ptr cinfo, JSAMPIMAGE data, JDIMENSION max_lines);
boolean jpeg_has_multiple_scans (j_decompress_ptr cinfo);
boolean jpeg_start_output (j_decompress_ptr cinfo, int scan_number);
boolean jpeg_finish_output (j_decompress_ptr cinfo);
boolean jpeg_input_complete (j_decompress_ptr cinfo);
void jpeg_new_colormap (j_decompress_ptr cinfo);
int jpeg_consume_input (j_decompress_ptr cinfo);
void jpeg_calc_output_dimensions (j_decompress_ptr cinfo);
void jpeg_save_markers (j_decompress_ptr cinfo, int marker_code, unsigned int length_limit);
void jpeg_set_marker_processor (j_decompress_ptr cinfo, int marker_code, jpeg_marker_parser_method routine);
jvirt_barray_ptr * jpeg_read_coefficients (j_decompress_ptr cinfo);
void jpeg_write_coefficients (j_compress_ptr cinfo, jvirt_barray_ptr * coef_arrays);
void jpeg_copy_critical_parameters (j_decompress_ptr srcinfo, j_compress_ptr dstinfo);
void jpeg_abort_compress (j_compress_ptr cinfo);
void jpeg_abort_decompress (j_decompress_ptr cinfo);
void jpeg_abort (j_common_ptr cinfo);
void jpeg_destroy (j_common_ptr cinfo);
boolean jpeg_resync_to_restart (j_decompress_ptr cinfo, int desired);
]]

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

	--create a skip buffer.
	--TODO: give user the option to provide skip(n) or read(nil, len).
	local skip_buf_sz, skip_buf = 1/0
	skip_buf_sz = opt.skip_buffer_size or 64 * 1024
	skip_buf    = opt.skip_buffer or u8a(skip_buf_sz)

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

--returns a thread with a `decode(buf, len) -> nil,'more' | bmp` function
--to be called repeatedly while `nil,'more'` is returned and then a bitmap
--is returned.
function jpeg_decoder()
	require'sock'
	local thread = iterator(function(yield)
		local jp, err = try_jpeg_open(yield)
		if not jp then return nil, err end
		local bmp = jp:load()
		jp:free()
		return true, bmp
	end)
	local buf, sz = thread.next()
	if not buf then return nil, sz end
	function thread.decode(p, len)
		while len > 0 do
			local n = min(len, sz)
			copy(buf, p, n)
			buf, sz = thread.next(n)
			if buf == true then return sz end --return bmp
			if not buf then return nil, sz end --error
			len = len - n
			p = p + n
		end
		return nil, 'more' --signal "need more data"
	end
	return thread
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
