require'glue'
require'fs'
require'bitmap'
require'bmp'

local function perr(fname, err)
	printf('%-46s %s', fname, err)
end

local function show(fname)
	local f = open(fname)
	local reader = f:unbuffered_reader()
	local bmp, err = try_bmp_open(reader)
	if not bmp then
		perr(fname, err)
	else
		local wbmp, err = bmp:try_load'bgra8'
		if not wbmp then
			perr(fname, err)
		else
			--save a copy of the bitmap so we test the saving API too
			local f1 = open(fname:gsub('%.bmp', '-saved.bmp'), 'w')
			bmp_save(wbmp, function(buf, sz)
				assert(f1:write(buf, sz))
			end)
			f1:close()
		end
	end
	f:close()
end

local function show_iter(fname)
	local f = open(fname)
	local reader = f:unbuffered_reader()
	local bmp, err = try_bmp_open(reader)
	if bmp then
		local ok, err = pcall(function()
			for j, row_bmp in bmp:rows('bgr8', nil, true) do
				--bitmap_paint(wbmp, row_bmp)
			end
		end)
		if not ok then
			perr(fname, err)
		end
	end
	f:close()
end

for i,d in ipairs{'good', 'bad', 'questionable'} do
	for f in ls('bmp_test/'..d) do
		if f:find'%.bmp$' and not f:find'%-saved' then
			local f = 'bmp_test/'..d..'/'..f
			show(f)
			show_iter(f)
		end
	end
end
