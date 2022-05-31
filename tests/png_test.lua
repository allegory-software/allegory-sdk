
require'glue'
require'png'
require'fs'

local function load(file)
	local f = open(file)
	local img = png_open{read = f:buffered_reader()}
	local bmp = img:load{accept = {bgra8 = true}}
	f:close()
	return img, bmp
end

local function save(bmp, file)
	local f = open(file, 'w')
	png_save{
		bitmap = bmp,
		write = function(buf, sz)
			return f:write(buf, sz)
		end,
	}
	f:close()
end

local img, bmp = load'png_test/good/z09n2c08.png'
save(bmp, 'png_test/good/z09n2c08_1.png')
local img2, bmp2 = load'png_test/good/z09n2c08_1.png'
rmfile'png_test/good/z09n2c08_1.png'
assert(bmp.size == bmp2.size)
for i=0,bmp.size-1 do
	assert(bmp.data[i] == bmp2.data[i])
end
print'ok'
