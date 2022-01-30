
local bitmap = require'bitmap'
local glue = require'glue'
require'unit'
io.stdout:setvbuf'no'

bitmap.dumpinfo()
print()
local w, h = 1921, 1081
if os.getenv'AUTO' then w, h = 13, 17 end --make it faster

local n = 0
for src_format in glue.sortedpairs(bitmap.formats) do

	print(string.format('%-6s %-4s %-10s %-10s %9s %9s %7s %13s',
			'time', '', 'src', 'dst', 'src size', 'dst size', 'stride', 'r+w speed'))

	jit.flush()
	for dst_format in bitmap.conversions(src_format) do
		local src = bitmap.new(w, h, src_format)
		local dst = bitmap.new(w, h, dst_format, 'flipped', true)

		timediff()
		bitmap.paint(dst, src)
		local dt = timediff()

		local flag = src_format == dst_format and '*' or ''
		print(string.format('%-6.4f %-4s %-10s %-10s %6.2f MB %6.2f MB   %-7s %6d MB/s',
				dt, flag, src.format, dst.format, src.size / 1024^2, dst.size / 1024^2, src.stride,
				(src.size + dst.size) / 1024^2 / dt))

	end
	n = n + 1
end
print('bitmap conversions:', n)
