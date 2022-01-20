--[=[

	Fast image resampling based on Pillow SIMD.
	Written by Cosmin Apreutesei. Public Domain.

	pil.image(bmp) -> img         create an image object from a bitmap
	img:resize(w, h, [filter])    resize the image
	img:bitmap() -> bmp           get the image as a bitmap with bmp:free()
	img:free()                    free the image

]=]

local ffi = require'ffi'
local avx2 = require('cpu_supports')('avx2')
local C = ffi.load('pillow_simd'..(avx2 and '_avx2' or ''))

ffi.cdef[[

typedef struct _pillow_image_t pillow_image_t;

pillow_image_t* pillow_image_create_for_data(
	char *data, const char* mode, int w, int h, int stride, int bottom_up);

void pillow_image_free(pillow_image_t*);

int    pillow_image_width  (pillow_image_t* im);
int    pillow_image_height (pillow_image_t* im);
char*  pillow_image_mode   (pillow_image_t* im);
char** pillow_image_rows   (pillow_image_t* im);

pillow_image_t* pillow_resample(
	pillow_image_t* im, int w, int h, int filter);

]]

local pil = {}

local function ptr(p) return p ~= nil and p or nil end

local modes = {
	rgbx8 = 'RGB',
	rgba8 = 'RGBA',
	cmyk8 = 'CMYK',
	yccx8 = 'YCbCr', --not in bitmap module
	labx8 = 'Lab', --not in bitmap module
}

local formats = {}
for k,v in pairs(modes) do formats[v] = k end

function pil.image(bmp)
	local mode = assert(modes[bmp.format], 'unsupported format')
	return assert(ptr(C.pillow_image_create_for_data(
		bmp.data, mode, bmp.w, bmp.h, bmp.stride, bmp.bottom_up and 1 or 0)))
end

local filters = {
	box = 4,
	bilinear = 2,
	hamming = 5,
	bicubic = 3,
	lanczos = 1,
}
local function resize(im, w, h, filter)
	local filter = assert(filters[filter or 'bilinear'], 'unknown filter')
	return assert(ptr(C.pillow_resample(im, w, h, filter)))
end

local function to_bitmap(im)
	local w = im:width()
	local h = im:height()
	local stride = w * 4
	return {
		format = formats[im:mode()],
		w = w, h = h, stride = stride, size = stride * h,
		rows = im:rows(),
		free = function() im:free() end,
	}
end

ffi.metatype('pillow_image_t', {__index = {
	free   = C.pillow_image_free,
	rows   = C.pillow_image_rows,
	width  = C.pillow_image_width,
	height = C.pillow_image_height,
	mode   = function(im) return ffi.string(C.pillow_image_mode(im)) end,
	bitmap = to_bitmap,
	resize = resize,
}})

return pil
