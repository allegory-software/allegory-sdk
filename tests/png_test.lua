
require'glue'
require'png'
require'fs'
require'pbuffer'

chdir(exedir()..'/../tests')

local _png_save = png_save
local function png_save(bmp, file)
	local f = open(file, 'w')
	_png_save{
		bitmap = bmp,
		write = function(buf, sz)
			return catch('io', f.write, f, buf, sz)
		end,
	}
	f:close()
end

local img, bmp = png_load'png_test/good/z09n2c08.png'
png_save(bmp, 'png_test/good/z09n2c08_1.png')
local img2, bmp2 = png_load'png_test/good/z09n2c08_1.png'
rmfile'png_test/good/z09n2c08_1.png'
assert(bmp.size == bmp2.size)
for i=0,bmp.size-1 do
	assert(bmp.data[i] == bmp2.data[i])
end
print'png ok'
