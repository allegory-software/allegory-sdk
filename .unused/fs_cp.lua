--[[

	[try_]cp(src_file, dst_file, [async])

]]

function try_cp(src_file, dst_file)
	local sf, err = try_open(src_file, 'r')
	if not sf then return nil, err end
	local df, err = try_open(dst_file, 'w')
	if not df then
		sf:close()
		return nil, err
	end
	local bufsize = 64 * 1024
	local buf = u8a(bufsize)
	while true do
		local n, err = sf:try_read(buf, bufsize)
		if not n then
			sf:close(); df:close()
			return nil, err
		end
		if n == 0 then break end
		local ok, err = df:try_write(buf, n)
		if not ok then
			sf:close(); df:close()
			return nil, err
		end
	end
	sf:close()
	df:close()
	log('note', 'fs', 'cp', 'src: %s\ndst: %s', src_file, dst_file)
	return true
end
function cp(src_file, dst_file, async)
	local ok, err = try_cp(src_file, dst_file, async)
	check('fs', 'cp', ok, '%s -> %s: %s', src_file, dst_file, err)
end
