--[[

	JPEG-LS decoding & encoding based on CharLS.
	Written by Cosmin Apreutesei. Public Domain.

	charls.open(buf, sz) -> d
	d:dest_size([stride]) -> sz
	d:decode(buf, sz, [stride])
	d:free()

]]

local ffi = require'ffi'
local C = ffi.load'charls'

ffi.cdef[[
typedef int charls_jpegls_errc;

typedef enum {
	CHARLS_INTERLEAVE_MODE_NONE = 0,
	CHARLS_INTERLEAVE_MODE_LINE = 1,
	CHARLS_INTERLEAVE_MODE_SAMPLE = 2
} charls_interleave_mode;

typedef enum {
	CHARLS_ENCODING_OPTIONS_NONE = 0,
	CHARLS_ENCODING_OPTIONS_EVEN_DESTINATION_SIZE = 1,
	CHARLS_ENCODING_OPTIONS_INCLUDE_VERSION_NUMBER = 2,
	CHARLS_ENCODING_OPTIONS_INCLUDE_PC_PARAMETERS_JAI = 4
} charls_encoding_options;

typedef enum {
	CHARLS_COLOR_TRANSFORMATION_NONE = 0,
	CHARLS_COLOR_TRANSFORMATION_HP1 = 1,
	CHARLS_COLOR_TRANSFORMATION_HP2 = 2,
	CHARLS_COLOR_TRANSFORMATION_HP3 = 3
} charls_color_transformation;

typedef enum {
	CHARLS_SPIFF_PROFILE_ID_NONE = 0,
	CHARLS_SPIFF_PROFILE_ID_CONTINUOUS_TONE_BASE = 1,
	CHARLS_SPIFF_PROFILE_ID_CONTINUOUS_TONE_PROGRESSIVE = 2,
	CHARLS_SPIFF_PROFILE_ID_BI_LEVEL_FACSIMILE = 3,
	CHARLS_SPIFF_PROFILE_ID_CONTINUOUS_TONE_FACSIMILE = 4
} charls_spiff_profile_id;

typedef enum {
	CHARLS_SPIFF_COLOR_SPACE_BI_LEVEL_BLACK = 0,
	CHARLS_SPIFF_COLOR_SPACE_YCBCR_ITU_BT_709_VIDEO = 1,
	CHARLS_SPIFF_COLOR_SPACE_NONE = 2,
	CHARLS_SPIFF_COLOR_SPACE_YCBCR_ITU_BT_601_1_RGB = 3,
	CHARLS_SPIFF_COLOR_SPACE_YCBCR_ITU_BT_601_1_VIDEO = 4,
	CHARLS_SPIFF_COLOR_SPACE_GRAYSCALE = 8,
	CHARLS_SPIFF_COLOR_SPACE_PHOTO_YCC = 9,
	CHARLS_SPIFF_COLOR_SPACE_RGB = 10,
	CHARLS_SPIFF_COLOR_SPACE_CMY = 11,
	CHARLS_SPIFF_COLOR_SPACE_CMYK = 12,
	CHARLS_SPIFF_COLOR_SPACE_YCCK = 13,
	CHARLS_SPIFF_COLOR_SPACE_CIE_LAB = 14,
	CHARLS_SPIFF_COLOR_SPACE_BI_LEVEL_WHITE = 15
} charls_spiff_color_space;

typedef enum {
	CHARLS_SPIFF_COMPRESSION_TYPE_UNCOMPRESSED = 0,
	CHARLS_SPIFF_COMPRESSION_TYPE_MODIFIED_HUFFMAN = 1,
	CHARLS_SPIFF_COMPRESSION_TYPE_MODIFIED_READ = 2,
	CHARLS_SPIFF_COMPRESSION_TYPE_MODIFIED_MODIFIED_READ = 3,
	CHARLS_SPIFF_COMPRESSION_TYPE_JBIG = 4,
	CHARLS_SPIFF_COMPRESSION_TYPE_JPEG = 5,
	CHARLS_SPIFF_COMPRESSION_TYPE_JPEG_LS = 6
} charls_spiff_compression_type;

typedef enum {
	CHARLS_SPIFF_RESOLUTION_UNITS_ASPECT_RATIO = 0,
	CHARLS_SPIFF_RESOLUTION_UNITS_DOTS_PER_INCH = 1,
	CHARLS_SPIFF_RESOLUTION_UNITS_DOTS_PER_CENTIMETER = 2
} charls_spiff_resolution_units;

typedef enum {
	CHARLS_SPIFF_ENTRY_TAG_TRANSFER_CHARACTERISTICS = 2,
	CHARLS_SPIFF_ENTRY_TAG_COMPONENT_REGISTRATION = 3,
	CHARLS_SPIFF_ENTRY_TAG_IMAGE_ORIENTATION = 4,
	CHARLS_SPIFF_ENTRY_TAG_THUMBNAIL = 5,
	CHARLS_SPIFF_ENTRY_TAG_IMAGE_TITLE = 6,
	CHARLS_SPIFF_ENTRY_TAG_IMAGE_DESCRIPTION = 7,
	CHARLS_SPIFF_ENTRY_TAG_TIME_STAMP = 8,
	CHARLS_SPIFF_ENTRY_TAG_VERSION_IDENTIFIER = 9,
	CHARLS_SPIFF_ENTRY_TAG_CREATOR_IDENTIFICATION = 10,
	CHARLS_SPIFF_ENTRY_TAG_PROTECTION_INDICATOR = 11,
	CHARLS_SPIFF_ENTRY_TAG_COPYRIGHT_INFORMATION = 12,
	CHARLS_SPIFF_ENTRY_TAG_CONTACT_INFORMATION = 13,
	CHARLS_SPIFF_ENTRY_TAG_TILE_INDEX = 14,
	CHARLS_SPIFF_ENTRY_TAG_SCAN_INDEX = 15,
	CHARLS_SPIFF_ENTRY_TAG_SET_REFERENCE = 16
} charls_spiff_entry_tag;

typedef struct charls_jpegls_pc_parameters {
    int32_t maximum_sample_value;
    int32_t threshold1;
    int32_t threshold2;
    int32_t threshold3;
    int32_t reset_value;
} charls_jpegls_pc_parameters;

typedef struct charls_spiff_header {
	charls_spiff_profile_id profile_id;   // P: Application profile, type I.8
	int32_t component_count;              // NC: Number of color components, range [1, 255], type I.8
	uint32_t height;                      // HEIGHT: Number of lines in image, range [1, 4294967295], type I.32
	uint32_t width;                       // WIDTH: Number of samples per line, range [1, 4294967295], type I.32
	charls_spiff_color_space color_space; // S: Color space used by image data, type is I.8
	int32_t bits_per_sample;              // BPS: Number of bits per sample, range (1, 2, 4, 8, 12, 16), type is I.8
	charls_spiff_compression_type compression_type; // C: Type of data compression used, type is I.8
	charls_spiff_resolution_units resolution_units; // R: Type of resolution units, type is I.8
	uint32_t vertical_resolution;   // VRES: Vertical resolution, range [1, 4294967295], type can be F or I.32
	uint32_t horizontal_resolution; // HRES: Horizontal resolution, range [1, 4294967295], type can be F or I.32
} charls_spiff_header;

typedef struct charls_frame_info {
	uint32_t width;
	uint32_t height;
	int32_t bits_per_sample;
	int32_t component_count;
} charls_frame_info;

typedef struct charls_jpegls_decoder charls_jpegls_decoder;
const char* charls_get_error_message(charls_jpegls_errc error_value);

charls_jpegls_decoder* charls_jpegls_decoder_create();
void charls_jpegls_decoder_destroy(const charls_jpegls_decoder* decoder);

charls_jpegls_errc charls_jpegls_decoder_set_source_buffer(charls_jpegls_decoder* decoder, const void* source_buffer, size_t source_size_bytes);
charls_jpegls_errc charls_jpegls_decoder_read_spiff_header(charls_jpegls_decoder* decoder, charls_spiff_header* spiff_header, int32_t* header_found);
charls_jpegls_errc charls_jpegls_decoder_read_header(charls_jpegls_decoder* decoder);
charls_jpegls_errc charls_jpegls_decoder_get_frame_info(const charls_jpegls_decoder* decoder, charls_frame_info* frame_info);
charls_jpegls_errc charls_jpegls_decoder_get_near_lossless(const charls_jpegls_decoder* decoder, int32_t component, int32_t* near_lossless);
charls_jpegls_errc charls_jpegls_decoder_get_interleave_mode(const charls_jpegls_decoder* decoder, charls_interleave_mode* interleave_mode);
charls_jpegls_errc charls_jpegls_decoder_get_preset_coding_parameters(const charls_jpegls_decoder* decoder, int32_t reserved, charls_jpegls_pc_parameters* preset_coding_parameters);
charls_jpegls_errc charls_jpegls_decoder_get_color_transformation(const charls_jpegls_decoder* decoder, charls_color_transformation* color_transformation);
charls_jpegls_errc charls_jpegls_decoder_get_destination_size(const charls_jpegls_decoder* decoder, uint32_t stride, size_t* destination_size_bytes);
charls_jpegls_errc charls_jpegls_decoder_decode_to_buffer(charls_jpegls_decoder* decoder, void* destination_buffer, size_t destination_size_bytes, uint32_t stride);
]]

local M = {}

local decoder = {}

decoder.free = C.charls_jpegls_decoder_destroy

local function check(ret)
	if ret == 0 then return true end
	return nil, ffi.string(C.charls_get_error_message(ret))
end

function decoder:dest_size(stride)
	local sz = ffi.new'size_t[1]'
	local ret, err = check(C.charls_jpegls_decoder_get_destination_size(self, stride or 0, sz))
	if not ret then return nil, err end
	return sz[0]
end

function decoder:decode(buf, sz, stride)
	return check(C.charls_jpegls_decoder_decode_to_buffer(self, buf, sz, stride or 0))
end

function M.open(buf, sz)
	local self = C.charls_jpegls_decoder_create()
	assert(self ~= nil)
	assert(C.charls_jpegls_decoder_set_source_buffer(self, buf, sz) == 0)
	local ret, err = check(C.charls_jpegls_decoder_read_header(self))
	if not ret then
		self:free()
		return nil, err
	end
	return self
end

ffi.metatype('struct charls_jpegls_decoder', {__index = decoder})

return M
