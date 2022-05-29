require'glue'
require'jpeg'
require'fs'

local function test_load_save()
	local infile = 'jpeg_test/progressive.jpg'
	local outfile = 'jpeg_test/test.jpg'
	local f = assert(open(infile))
	local img = assert(jpeg_open(function(buf, sz)
		return assert(f:read(buf, sz))
	end))
	local bmp = assert(img:load())
	assert(f:close())

	local f2 = assert(open(outfile, 'w'))
	local function write(buf, sz)
		return f2:write(buf, sz)
	end
	jpeg_save{bitmap = bmp, write = write}
	img:free()
	assert(f2:close())

	local f = assert(open(outfile))
	local img = assert(jpeg_open{
		read = function(buf, sz)
			return assert(f:read(buf, sz))
		end,
		partial_loading = false, --break on errors
	})
	local bmp2 = assert(img:load())
	img:free()
	assert(f:close())
	assert(rmfile(outfile))
	assert(bmp.w == bmp2.w)
	assert(bmp.h == bmp2.h)
	print'ok'
end

test_load_save()

