--[=[

	BMP file load/save.
	Written by Cosmin Apreutesei. Public Domain.

	Supports all file header versions, color depths and pixel formats and
	encodings except very rare ones (embedded JPEGs, embedded PNGs, OS/2
	headers, RLE deltas). Supports progressive loading, yielding from the
	reader and writer functions and saving in bgra8 format.

	bmp_open(read) -> b | nil,err          open a BMP file and read it's header
	  read(buf, len) -> len|0|nil          read function (can yield)
	b.w, bmp.h                             bitmap dimensions
	b.bpp                                  bits per pixel
	b:load(bmp[, x, y]) -> bmp | nil,err   load/paint the pixels into a given bitmap
	b:load(format, ...) -> bmp | nil,err   load the pixels into a new bitmap
	b:rows(bmp | format,...) -> iter() -> i, bmp   iterate the rows over a 1-row bitmap
	[try_]bmp_save(bmp, write) -> ok | nil,err   save a bitmap using a write function

bmp_open(read) -> b | nil,err

	Open a BMP file. The read function can yield and it can signal I/O errors
	by returning `nil, err`. It will only be asked to read a positive number
	of bytes and it can return less bytes than asked, including zero which
	signals EOF.

b:load(bmp[, x, y]) -> bmp | nil,err

	Load and paint the bmp's pixels into a given bitmap, optionally at a
	specified position within the bitmap. All necessary format conversions and
	clipping are done via the bitmap module.

b:load(format, ...) -> bmp | nil,err

	Load the bmp's pixels into a new bitmap of a specified format.
	Extra arguments are passed to `bitmap.new()`.

b:rows(bmp | format,...) -> iter() -> i, bmp

	Iterate the bmp's rows over a new or provided 1-row bitmap. The row index
	is decreasing if the bitmap is bottom-up. Unlike `b:load()`, this method
	and the returned iterator are not protected (they raise errors).

[try_]bmp_save(bmp, write) -> true | nil, err

	Save bmp file using a `write(buf, size)` function to write the bytes.
	The write function should accept any size >= 0 and it should raise an error
	if it can't write all the bytes.

Low-level API

	b.bottom_up`                       are the rows stored bottom up?
	b.compression`                     encoding type
	b.transparent`                     does it use the alpha channel?
	b.palettized`                      does it use a palette?
	b.bitmasks`                        RGBA bitmasks (BITFIELDS encoding)
	b.rle`                             is it RLE-encoded?
	b:load_pal() -> ok|nil,err`        load the palette
	b:pal_entry(index) -> r, g, b, a`  palette lookup (loads the palette)
	b.pal_count -> n`                  palette color count

]=]

if not ... then require'bmp_test'; return end

require'glue'
require'bitmap'

local
	shr, shl, bor, band, bnot =
	shr, shl, bor, band, bnot

--BITMAPFILEHEADER
local file_header = typeof[[struct __attribute__((__packed__)) {
	char     magic[2]; // 'BM'
	uint32_t size;
	uint16_t reserved1;
	uint16_t reserved2;
	uint32_t image_offset;
	uint32_t header_size;
}]]

--BITMAPCOREHEADER, Windows 2.0 or later
local core_header = typeof[[struct __attribute__((__packed__)) {
	// BITMAPCOREHEADER
	uint16_t w;
	uint16_t h;
	uint16_t planes;       // 1
	uint16_t bpp;          // 1, 4, 8, 24
}]]

--BITMAPINFOHEADER, Windows NT, 3.1x or later
local info_header = typeof[[struct __attribute__((__packed__)) {
	int32_t  w;
	int32_t  h;
	uint16_t planes;       // 1
	uint16_t bpp;          // 0, 1, 4, 8, 16, 24, 32; 64 (GDI+)
	uint32_t compression;  // 0-6
	uint32_t image_size;   // 0 for BI_RGB
	uint32_t dpi_v;
	uint32_t dpi_h;
	uint32_t palette_colors; // 0 = 2^n
	uint32_t palette_colors_important; // ignored
}]]

--BITMAPV2INFOHEADER, undocumented, Adobe Photoshop
local v2_header = typeof([[struct __attribute__((__packed__)) {
	$;
	uint32_t mask_r;
	uint32_t mask_g;
	uint32_t mask_b;
}]], info_header)

--BITMAPV3INFOHEADER, undocumented, Adobe Photoshop
local v3_header = typeof([[struct __attribute__((__packed__)) {
	$;
	uint32_t mask_a;
}]], v2_header)

--BITMAPV4HEADER, Windows NT 4.0, 95 or later
local v4_header = typeof([[struct __attribute__((__packed__)) {
	$;
	uint32_t cs_type;
	struct { int32_t rx, ry, rz, gx, gy, gz, bx, by, bz; } endpoints;
	uint32_t gamma_r;
	uint32_t gamma_g;
	uint32_t gamma_b;
}]], v3_header)

--BITMAPV5HEADER, Windows NT 5.0, 98 or later
local v5_header = typeof([[struct __attribute__((__packed__)) {
	$;
	uint32_t intent;
	uint32_t profile_data;
	uint32_t profile_size;
	uint32_t reserved;
}]], v4_header)

local rgb_triple = typeof[[struct __attribute__((__packed__)) {
	uint8_t b;
	uint8_t g;
	uint8_t r;
}]]

local rgb_quad = typeof([[struct __attribute__((__packed__)) {
	$;
	uint8_t a;
}]], rgb_triple)

local compressions = {[0] = 'rgb', 'rle8', 'rle4', 'bitfields',
	'jpeg', 'png', 'alphabitfields'}

local valid_bpps = {
	rgb = index{1, 2, 4, 8, 16, 24, 32, 64},
	rle4 = index{4},
	rle8 = index{8},
	bitfields = index{16, 32},
	alphabitfields = index{16, 32},
	jpeg = index{0},
	png = index{0},
}

local function check(ret, err)
	if ret then return ret end
	raise(2, 'bmp', '%s', err)
end

try_bmp_open = protect('bmp', function(read_bytes)

	--wrap the reader so we can count the bytes read
	local bytes_read = 0
	local function read(buf, sz)
		if sz == 0 then return buf end
		local sz = sz or sizeof(buf)
		local readsz = check(read_bytes(buf, sz))
		check(readsz == sz, 'eof')
		bytes_read = bytes_read + sz
		return buf
	end

	--load the file header and validate it
	local fh = read(file_header())
	check(str(fh.magic, 2) == 'BM', 'not a bmp')

	--load the DIB header
	local z = fh.header_size - 4
	local core --the ancient core header is more restricted
	local alpha_mask = true --bitfields can contain a mask for alpha or not
	local quad_pal = true --palette entries are quads except for core header
	local ext_bitmasks = false
	local h
	if z == sizeof(core_header) then
		core = true
		quad_pal = false
		h = read(core_header())
	elseif z == sizeof(info_header) then
		alpha_mask = false --...unless comp == 'alphabitfields', see below
		ext_bitmasks = true --bitfield masks are right after the header
		h = read(info_header())
	elseif z == sizeof(v2_header) then
		alpha_mask = false
		h = read(v2_header())
	elseif z == sizeof(v3_header) then
		h = read(v3_header())
	elseif z == sizeof(v4_header) then
		h = read(v4_header())
	elseif z == sizeof(v5_header) then
		h = read(v5_header())
	elseif z == 64 + 4 then
		check(false, 'OS22XBITMAPHEADER is not supported')
	else
		check(false, 'invalid info header size')
	end

	--validate it and extract info from it
	check(h.planes == 1, 'invalid number of planes')
	local comp = core and 0 or h.compression
	local comp = check(compressions[comp], 'invalid compression type')
	alpha_mask = alpha_mask or comp == 'alphabitfields' --Windows CE
	local bpp = h.bpp
	check(valid_bpps[comp][bpp], 'invalid bpp')
	local rle = comp:find'^rle'
	local bitfields = comp:find'bitfields$'
	local palettized = bpp >=1 and bpp <= 8
	local width = h.w
	local height = abs(h.h)
	local bottom_up = h.h > 0
	check(width  >= 1 and width  <= 10000, 'invalid width' )
	check(height >= 1 and height <= 10000, 'invalid height')

	--load the channel masks for bitfield bitmaps
	local bitmasks, has_alpha
	if bitfields then
		bitmasks = u32a(4)
		local masks_size = (alpha_mask and 4 or 3) * 4
		if ext_bitmasks then
			read(bitmasks, masks_size)
		else
			local masks_ptr = cast('uint8_t*', h) + offsetof(h, 'mask_r')
			copy(bitmasks, masks_ptr, masks_size)
		end
		has_alpha = bitmasks[3] > 0
	end

	--make a one-time palette loader and indexer
	local load_pal
	local pal_size = fh.image_offset - bytes_read
	check(pal_size >= 0, 'invalid image offset')
	local function noop() end
	local function skip_pal()
		read(nil, pal_size) --null-read to pixel data
		load_pal = noop
	end
	load_pal = skip_pal
	local pal_count = 0
	local pal
	if palettized then
		local pal_entry_ct = quad_pal and rgb_quad or rgb_triple
		local pal_ct = typeof('$[?]', pal_entry_ct)
		pal_count = floor(pal_size / sizeof(pal_entry_ct))
		pal_count = min(pal_count, 2^bpp)
		if pal_count > 0 then
			function load_pal()
				pal = read(pal_ct(pal_count))
				read(nil, pal_size - sizeof(pal)) --null-read to pixel data
				load_pal = noop
			end
		end
	end
	local function pal_entry(i)
		load_pal()
		check(i < pal_count, 'palette index out of range')
		return pal[i].r, pal[i].g, pal[i].b, 0xff
	end

	--make a row loader iterator and a bitmap loader
	local row_iterator, load_rows
	local function init_load()

		check(not row_iterator, 'already loaded')

		if comp == 'jpeg' then
			check(false, 'jpeg not supported')
		elseif comp == 'png' then
			check(false, 'png not supported')
		end

		--decide on the row bitmap format and if needed make a pixel converter
		local format, convert_pixel, dst_colorspace
		if bitfields then --packed, standard or custom format

			--compute the shift distance and the number of bits for each mask
			local function mask_shr_bits(mask)
				if mask == 0 then
					return 0, 0
				end
				local shift = 0
				while band(mask, 1) == 0 do --lowest bit not reached yet
					mask = shr(mask, 1)
					shift = shift + 1
				end
				local bits = 0
				while mask > 0 do --highest bit not cleared yet
					mask = shr(mask, 1)
					bits = bits + 1
				end
				return shift, bits
			end

			--build a standard format name based on the bitfield masks
			local t = {} --{shr1, ...}
			local tc = {} --{shr -> color}
			local tb = {} --{shr -> bits}
			for ci, color in ipairs{'r', 'g', 'b', 'a'} do
				local shr, bits = mask_shr_bits(bitmasks[ci-1])
				if bits > 0 then
					t[#t+1] = shr
					tc[shr] = color
					tb[shr] = bits
				end
			end
			--NOTE: 16bit rgb bitmap formats have their color letters named
			--in little-endian order, so we need to reverse the color order.
			table.sort(t, bpp == 16 and function(a, b) return a > b end or nil)
			local tc2, tb2 = {}, {}
			for i,shr in ipairs(t) do
				tc2[i] = tc[shr]
				tb2[i] = tb[shr]
			end
			format = table.concat(tc2)..table.concat(tb2)
			format = format:gsub('([^%d])8?888$', '%18')

			--make a custom pixel converter if the bitfields do not represent
			--a standard format implemented in the `bitmap` module.
			if not bitmap_formats[format] then
				format = 'raw'..bpp
				dst_colorspace = 'rgba8'
				local r_and = bitmasks[0]
				local r_shr = mask_shr_bits(r_and)
				local g_and = bitmasks[1]
				local g_shr = mask_shr_bits(g_and)
				local b_and = bitmasks[2]
				local b_shr = mask_shr_bits(b_and)
				local a_and = bitmasks[3]
				local a_shr = mask_shr_bits(a_and)
				function convert_pixel(x)
					return
						shr(band(x, r_and), r_shr),
						shr(band(x, g_and), g_shr),
						shr(band(x, b_and), b_shr),
						has_alpha and shr(band(x, a_and), a_shr) or 0xff
				end
			end

		elseif bpp <= 8 then --palettized, using custom converter

			format = 'g'..bpp --using gray<1,2,4,8> as the base format
			dst_colorspace = 'rgba8'
			if bpp == 1 then
				function convert_pixel(g8)
					return pal_entry(shr(g8, 7))
				end
			elseif bpp == 2 then
				function convert_pixel(g8)
					return pal_entry(shr(g8, 6))
				end
			elseif bpp == 4 then
				function convert_pixel(g8)
					return pal_entry(shr(g8, 4))
				end
			elseif bpp == 8 then
				convert_pixel = pal_entry
			else
				check(false, 'invalid bpp')
			end

		else --packed, standard format

			local formats = {
				[16] = 'rgb0555',
				[24] = 'bgr8',
				[32] = 'bgrx8',
				[64] = 'bgrx16',
			}
			format = check(formats[bpp], 'invalid bpp')

		end

		--make a row reader: either a RLE decoder or a straight buffer reader
		local function row_reader(row_bmp)
			if rle then

				local read_pixels, fill_pixels

				local rle_buf = u8a(2)
				local p = cast(u8p, row_bmp.data)

				if bpp == 8 then --RLE8

					function read_pixels(i, n)
						read(p + i, n)
						--read the word-align padding
						local n2 = band(n + 1, bnot(1)) - n
						if n2 > 0 then
							read(nil, n2)
						end
					end

					function fill_pixels(i, n, v)
						fill(p + i, n, v)
					end

				elseif bpp == 4 then --RLE4

					local function shift_back(i, n) --shift data back one nibble
						local i0 = floor(i)
						if i0 == i then return end --no need for shifting
						p[i0] = bor(band(p[i0], 0xf0), shr(p[i0+1], 4)) --stitch the first nibble
						for i = ceil(i), i0 + n do
							p[i] = bor(shl(p[i], 4), shr(p[i+1], 4))
						end
					end

					function read_pixels(i, n)
						local i = i * 0.5
						local n = ceil(n * 0.5)
						read(p + ceil(i), n)
						shift_back(i, n)
						--read the word-align padding
						local n2 = band(n + 1, bnot(1)) - n
						if n2 > 0 then
							read(nil, n2)
						end
					end

					function fill_pixels(i, n, v)
						local i = i * 0.5
						local n = ceil(n * 0.5)
						fill(p + ceil(i), n, v)
						shift_back(i, n)
					end

				else
					assert(false)
				end

				local j = 0
				return function()
					local i = 0
					while true do
						read(rle_buf, 2)
						local n = rle_buf[0]
						local k = rle_buf[1]
						if n == 0 then --escape
							if k == 0 then --eol
								check(i == width, 'RLE EOL too soon')
								j = j + 1
								break
							elseif k == 1 then --eof
								check(j == height-1, 'RLE EOF too soon')
								break
							elseif k == 2 then --delta
								read(rle_buf, 2)
								local x = rle_buf[0]
								local y = rle_buf[1]
								--we can't use a row-by-row loader with this code
								check(false, 'RLE delta not supported')
							else --absolute mode: k = number of pixels to read
								check(i + k <= width, 'RLE overflow')
								read_pixels(i, k)
								i = i + k
							end
						else --repeat: n = number of pixels to repeat, k = color
							check(i + n <= width, 'RLE overflow')
							fill_pixels(i, n, k)
							i = i + n
						end
					end
				end

			else
				return function()
					read(row_bmp.data, row_bmp.stride)
				end
			end
		end

		function row_iterator(arg, ...)

			local dst_bmp
			if istab(arg) and arg.data then --arg is a bitmap
				dst_bmp = arg
			else --arg is a format name or specifier
				dst_bmp = bitmap(width, 1, arg, ...)
			end

			--load row function: convert or direct copy
			local load_row
			local stride = bitmap_aligned_stride(bitmap_min_stride(format, width))
			if convert_pixel                 --needs pixel conversion
				or dst_bmp.format ~= format   --needs pixel conversion
				or dst_bmp.w < width          --needs clipping
				or dst_bmp.stride < stride    --can't copy whole stride
			then
				local row_bmp = bitmap(width, 1, format, false, true)
				local read_row = row_reader(row_bmp)
				function load_row()
					read_row()
					bitmap_paint(dst_bmp, row_bmp, 0, 0,
						convert_pixel, nil, dst_colorspace)
				end
			else --load row into dst_bmp directly
				load_row = row_reader(dst_bmp)
			end

			load_pal()

			--unprotected row iterator
			local j = bottom_up and height or -1
			local j1 = bottom_up and -1 or height
			local step = bottom_up and -1 or 1
			return function()
				j = j + step
				if j == j1 then return end
				load_row()
				return j, dst_bmp
			end
		end

		function load_rows(arg, ...)

			local dst_bmp, dst_x, dst_y
			if istab(arg) and arg.data then
				dst_bmp, dst_x, dst_y = arg, ...
			else
				dst_bmp = bitmap(width, height, arg, ...)
			end
			local dst_x = dst_x or 0
			local dst_y = dst_y or 0

			local row_bmp = bitmap(width, 1, format, false, true)
			local read_row = row_reader(row_bmp)

			local function load_row(j)
				read_row()
				bitmap_paint(dst_bmp, row_bmp, dst_x, dst_y + j,
					convert_pixel, nil, dst_colorspace)
			end

			load_pal()

			local j0 = bottom_up and height-1 or 0
			local j1 = bottom_up and 0 or height-1
			local step = bottom_up and -1 or 1
			for j = j0, j1, step do
				load_row(j)
			end

			return dst_bmp
		end

	end

	local function bool(x)
		return x and true or false
	end

	--gather everything in a bmp object
	local bmp = {}
	--dimensions and color depth
	bmp.w = width
	bmp.h = height
	bmp.bpp = bpp
	--encoding info
	bmp.bottom_up = bottom_up
	bmp.compression = comp
	bmp.transparent = bool(has_alpha)
	bmp.palettized = bool(palettized)
	bmp.bitmasks = bitmasks --uint32_t[4] or nil
	bmp.rle = bool(rle)
	--low-level info
	bmp.file_header = fh
	bmp.header = h
	--palette
	bmp.pal_count = pal_count
	function bmp:load_pal()
		local ok, err = pcall(load_pal)
		if ok then
			self.pal = pal
			return true
		else
			return nil, err
		end
	end
	function bmp:pal_entry(i)
		return pal_entry(i)
	end
	--loading
	bmp.rows = function(self, ...)
		init_load()
		return row_iterator(...)
	end
	bmp.try_load = protect('bmp', function(self, ...)
		init_load()
		return load_rows(...)
	end)
	bmp.load = function(self, ...)
		return assert(self:try_load(...))
	end

	return bmp
end)

function bmp_open(...)
	return assert(try_bmp_open(...))
end

function bmp_save(bmp, write)
	local fh = file_header()
	local h = info_header()
	local image_size = h.w * h.h * 4
	local masks =
		'\x00\x00\xff\x00'..  --R
		'\x00\xff\x00\x00'..  --G
		'\xff\x00\x00\x00'..  --B
		'\x00\x00\x00\xff'    --A
	copy(fh.magic, 'BM', 2)
	fh.image_offset = sizeof(fh) + sizeof(h) + #masks
	fh.size = fh.image_offset + image_size
	fh.header_size = sizeof(h) + 4
	h.w = bmp.w
	h.h = bmp.h
	h.planes = 1
	h.bpp = 32
	h.compression = 3 --bitfields so we can have alpha
	h.image_size = image_size
	write(fh, sizeof(fh))
	write(h, sizeof(h))
	write(masks, #masks)
	--save progressively line-by-line using a 1-row bitmap
	local row_bmp = bitmap(bmp.w, 1, 'bgra8')
	for j=bmp.h-1,0,-1 do
		local src_row_bmp = bitmap_sub(bmp, 0, j, bmp.w, 1)
		bitmap_paint(row_bmp, src_row_bmp)
		write(row_bmp.data, row_bmp.stride)
	end
end
try_bmp_save = protect(bmp_save)
