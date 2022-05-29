
--floating point RGBA bitmap types for HDR storage and internal processing.
require'bitmap'
require'glue'
local conv = bitmap_converters

bitmap_colortypes.rgbaf = {channels = 'rgba', max = 1}

bitmap_formats.rgbaf = merge({bpp = 32 * 4, ctype = typeof'float',
	colortype = 'rgbaf', bitmap_formats.rgba8})

bitmap_formats.rgbad = merge({bpp = 64 * 4, ctype = typeof'double',
	colortype = 'rgbaf', bitmap_formats.rgba8})

conv.rgbaf = {}

function conv.rgbaf.rgba8(r, g, b, a)
	return r * 255, g * 255, b * 255, a * 255
end

function conv.rgba8.rgbaf(r, g, b, a)
	return r * (1 / 255), g * (1 / 255), b * (1 / 255), a * (1 / 255)
end

function conv.rgbaf.rgba16(r, g, b, a)
	return r * 65535, g * 65535, b * 65535, a * 65535
end

function bitmap_converters.rgba16.rgbaf(r, g, b, a)
	return r * (1 / 65535), g * (1 / 65535), b * (1 / 65535), a * (1 / 65535)
end

function conv.rgbaf.ga8(r, g, b, a)
	return bitmap_rgb2g(r, g, b) * 255, a
end

function conv.ga8.rgbaf(g, a)
	g = g / 255
	a = a / 255
	return g, g, g, a
end

function conv.rgbaf.ga16(r, g, b, a)
	return bitmap_rgb2g(r, g, b) * 65535, a
end

function conv.ga16.rgbaf(g, a)
	g = g / 65535
	a = a / 65535
	return g, g, g, a
end

function conv.cmyk8.rgbaf(c, m, y, k)
	return c * k / 65535, m * k / 65535, y * k / 65535, 1
end

function conv.ycck8.rgbaf(y, cb, cr, k)
	return
		(y                        + 1.402   * (cr - 128)) / 255,
		(y - 0.34414 * (cb - 128) - 0.71414 * (cr - 128)) / 255,
      (y + 1.772   * (cb - 128)                       ) / 255,
		1
end
