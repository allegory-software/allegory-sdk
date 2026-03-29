--TODO: remove this or incorporate into ls() ?
function ls_dir(path, patt, min_mtime, create, order_by, recursive)
	if istab(path) then
		local t = path
		path, patt, min_mtime, create, order_by, recursive =
			t.path, t.find, t.min_mtime, t.create, t.order_by, t.recursive
	end
	local t = {}
	local create = create or function(file) return {} end
	if recursive then
		for sc in scandir(path) do
			local file, err = sc:name()
			if not file and err == 'not_found' then break end
			check('fs', 'dir', file, 'dir listing failed for %s: %s', sc:path(-1), err)
			if     (not min_mtime or sc:attr'mtime' >= min_mtime)
				and (not patt or file:find(patt))
			then
				local f = create(file, sc)
				if f then
					f.name    = file
					f.path    = sc:path()
					f.relpath = sc:relpath()
					f.type    = sc:attr'type'
					f.mtime   = sc:attr'mtime'
					t[#t+1] = f
				end
			end
		end
	else
		for file, d in ls(path) do
			if not file and d == 'not_found' then break end
			check('fs', 'dir', file, 'dir listing failed for %s: %s', path, d)
			if     (not min_mtime or d:attr'mtime' >= min_mtime)
				and (not patt or file:find(patt))
			then
				local f = create(file, d)
				if f then
					f.name    = file
					f.path    = d:path()
					f.relpath = file
					f.type    = d:attr'type'
					f.mtime   = d:attr'mtime'
					t[#t+1] = f
				end
			end
		end
	end
	sort(t, cmp(order_by or 'mtime path'))
	log('', 'fs', 'dir', '%-20s %5d files%s%s', path,
		#t,
		patt and '\n  match: '..patt or '',
		min_mtime and '\n  mtime >= '..date('%d-%m-%Y %H:%M', min_mtime) or '')
	local i = 0
	return function()
		i = i + 1
		return t[i]
	end
end
