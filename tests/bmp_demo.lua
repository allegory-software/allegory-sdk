local bmp_format = require'bmp'
local ffi = require'ffi'
local fs = require'fs'
local nw = require'nw'
local bitmap = require'bitmap'

local app = nw:app()
local win = app:window{w = 1150, h = 1000, visible = false}

local function perr(fname, err)
	print(string.format('%-46s %s', fname, err))
end

local function reader(f)
	return function(buf, sz)
		assert(sz > 0)
		if buf then
			return assert(f:read(buf, sz))
		else
			local pos0 = assert(f:seek())
			local pos1 = assert(f:seek(sz))
			return pos1 - pos0
		end
	end
end

function win:repaint()
	local wbmp = win:bitmap()
	local x, y = 10, 10
	local maxh = 0

	local function show(fname)
		local f = fs.open(fname)
		local bmp, err = bmp_format.open(reader(f))
		if not bmp then
			perr(fname, err)
		else
			if x + bmp.w + 10 > wbmp.w then
				x = 10
				y = y + maxh + 10
			end
			local ok, err = bmp:load(wbmp, x, y)
			if not ok then
				perr(fname, err)
			else
				--save a copy of the bitmap so we test the saving API too
				local f1 = fs.open(fname:gsub('%.bmp', '-saved.bmp'), 'w')
				local bmp_cut = bitmap.sub(wbmp, x, y, bmp.w, bmp.h)
				bmp_format.save(bmp_cut, function(buf, sz)
					assert(f1:write(buf, sz))
				end)
				f1:close()

				x = x + bmp.w + 10
				maxh = math.max(maxh, bmp.h)
			end
		end
		f:close()
	end

	local function show_iter(fname)
		local f = fs.open(fname)
		local bmp, err = bmp_format.open(reader(f))
		if bmp then
			if x + bmp.w + 10 > wbmp.w then
				x = 10
				y = y + maxh + 10
			end
			local ok, err = pcall(function()
				for j, row_bmp in bmp:rows('bgr8', nil, true) do
					bitmap.paint(wbmp, row_bmp, x, y + j)
				end
			end)
			if not ok then
				perr(fname, err)
			else
				x = x + bmp.w + 10
				maxh = math.max(maxh, bmp.h)
			end
		end
		f:close()
	end

	for i,d in ipairs{'good', 'bad', 'questionable'} do
		for f in fs.dir('media/bmp/'..d) do
			if f:find'%.bmp$' and not f:find'%-saved' then
				local f = 'media/bmp/'..d..'/'..f
				show(f)
				show_iter(f)
			end
		end
		y = y + maxh + 40
		x = 10
	end

end

win:show()
app:run()
