require'glue'
require'jpeg'
require'fs'

local function test_load_save()
	local infile = 'jpeg_test/progressive.jpg'
	local outfile = 'jpeg_test/test.jpg'
	local f = open(infile)
	local img = jpeg_open(f:unbuffered_reader())
	local bmp = img:load()
	f:close()

	local f2 = open(outfile, 'w')
	local function write(buf, sz)
		return f2:write(buf, sz)
	end
	jpeg_save{bitmap = bmp, write = write}
	img:free()
	f2:close()

	local f = open(outfile)
	local img = jpeg_open{
		read = f:unbuffered_reader(),
		partial_loading = false, --break on errors
	}
	local bmp2 = img:load()
	img:free()
	f:close()
	rmfile(outfile)
	assert(bmp.w == bmp2.w)
	assert(bmp.h == bmp2.h)
	print'ok'
end

test_load_save()
