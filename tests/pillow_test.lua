
local glue = require'glue'
local fs = require'fs'
local libjpeg = require'libjpeg'
local pil = require'pillow'

local function resize_image(src_path, dst_path, max_w, max_h)

	--load.
	local f = assert(fs.open(src_path, 'r'))
	local read = f:buffered_read()
	local img = assert(libjpeg.open{read = read})
	local w, h = glue.fitbox(img.w, img.h, max_w, max_h)
	local sn = math.ceil(glue.clamp(math.max(w / img.w, h / img.h) * 8, 1, 8))
	bmp = assert(img:load{
		accept = {rgba8 = true},
		scale_num = sn,
		scale_denom = 8,
	})
	f:close()

	--resize.
	local w, h = glue.fitbox(bmp.w, bmp.h, max_w, max_h)
	local img1 = pil.image(bmp)
	local img2 = img1:resize(w, h, 'lanczos')
	img1:free()
	local bmp = img2:bitmap()
	pr(bmp)

	--save.
	local f = assert(fs.open(dst_path, 'w'))
	local function write(buf, len)
		return assert(f:write(buf, len))
	end
	assert(libjpeg.save{
		bitmap = bmp,
		write = write,
		quality = 90,
	})
	f:close()

	print'done'
end

resize_image(
	'pillow_test/birds.jpg',
	'pillow_test/birds-small.jpg',
	345, 234)
