require'rowset'
require'proc'
require'ipv6'

rowset.os_explorer_processes = virtual_rowset(function(rs)
	rs.fields = {
		{name = 'name', label = 'Process'},
		{
			name = 'pid', label = 'PID', type = 'number',
			not_null = true, readonly = true,
		},
		{name = 'ppid', label = 'Parent PID', type = 'number'},
		{name = 'state', label = 'State'},
		{name = 'rss', label = 'Memory', type = 'filesize'},
		{name = 'cpu_time', label = 'CPU time', type = 'duration'},
	}
	rs.pk = 'pid'
	rs.id_col = 'pid'
	rs.parent_col = 'ppid'
	rs.tree_col = 'name'
	rs.can_move_rows = false
	function rs:load_rows(res)
		res.rows = {} -- [{name, pid, ppid, state, rss, cpu_time}]
		for name in ls'/proc' do
			if name:match'^%d+$' then
				local process = proc_info(tonumber(name)) -- process attributes
				if process then
					add(res.rows, {
						process.comm, process.pid, process.ppid,
						process.state or null, process.rss,
						process.utime + process.stime,
					})
				end
			end
		end
	end
end)

--scanned trees, kept until the process exits and never updated.
local trees = {} -- {root folder path -> {root_row =, child_rows =}}

--a folder's row, with no size yet: scan_tree() adds the sizes of the
--files under it.
local function folder_row(dir)
	local attrs = checkfound(file_attr(dir, nil, true)) -- folder attrs
	checkarg(attrs.type == 'dir', 'not a folder: %s', dir)
	return { -- {name, path, parent_path, type, size, percent, mtime,
		--   has_children}
		dir == '/' and '/' or basename(dir), dir, null,
		attrs.type, 0, 10000, attrs.mtime, false,
	}
end

local function cmp_rows(row1, row2) -- folders first, then by name
	local is_dir1 = row1[4] == 'dir' -- row1 is a folder
	local is_dir2 = row2[4] == 'dir' -- row2 is a folder
	if is_dir1 ~= is_dir2 then
		return is_dir1
	end
	return row1[1] < row2[1]
end

--sort the folder's children and set their share of the root's size.
--the percent type stores 50% as 5000.
local function sort_child_rows(child_rows, dir_row, root_size)
	local rows = child_rows[dir_row[2]] -- the folder's children
	if rows then
		sort(rows, cmp_rows)
		for _, row in ipairs(rows) do
			row[6] = root_size > 0
				and floor(row[5] / root_size * 10000 + .5) or 0
			if row[4] == 'dir' then
				sort_child_rows(child_rows, row, root_size)
			end
		end
	end
end

--[[
scan the whole subtree of root. a folder's size is the sum of the sizes of
the files under it. scandir() returns a folder before its contents, so
dir_rows holds the rows of the folders that contain the current entry.
]]
local function scan_tree(root)
	local root_row = folder_row(root) -- the root folder's row
	local child_rows = {} -- {folder path -> [row, ...]}: folders first
	local dir_rows = {root_row} -- {depth -> row of the folder at that depth}
	for sc in scandir(root) do -- recursive directory iterator
		local depth = sc:depth() -- 1 for the folder's direct children
		local attrs = sc:attr(nil, false) -- file attributes
		if attrs then
			local is_dir = attrs.type == 'dir'
			local size = is_dir and 0 or attrs.size -- file size; 0 for folders
			local parent_row = dir_rows[depth] -- row of the entry's folder
			parent_row[8] = true
			for i = 1, depth do
				local row = dir_rows[i] -- row of a folder containing the entry
				row[5] = row[5] + size
			end
			local row = { -- see folder_row()
				sc:name(), sc:path(), parent_row[2],
				attrs.type, size, 0, attrs.mtime, false,
			}
			add(attr(child_rows, parent_row[2]), row)
			if is_dir then
				dir_rows[depth + 1] = row
			end
		end
	end
	sort_child_rows(child_rows, root_row, root_row[5])
	return {root_row = root_row, child_rows = child_rows}
end

--add the folder's children, or all its descendants if recursive.
local function add_child_rows(rows, child_rows, dir, recursive)
	local dir_child_rows = child_rows[dir] -- the folder's children, or nil
	if dir_child_rows then
		for _, row in ipairs(dir_child_rows) do
			add(rows, row)
			if recursive and row[4] == 'dir' then
				add_child_rows(rows, child_rows, row[2], true)
			end
		end
	end
end

rowset.os_explorer_files = virtual_rowset(function(rs)
	rs.fields = {
		{name = 'name', label = 'Name'},
		{
			name = 'path', label = 'Path', not_null = true,
			readonly = true, hidden = true,
		},
		{name = 'parent_path', label = 'Parent path'},
		{name = 'type', label = 'Type'},
		{name = 'size', label = 'Size', type = 'filesize'},
		{name = 'percent', label = 'Percent', type = 'percent'},
		{name = 'mtime', label = 'Modified', type = 'date'},
		{name = 'has_children', type = 'bool', internal = true},
	}
	rs.pk = 'path'
	rs.id_col = 'path'
	rs.parent_col = 'parent_path'
	rs.has_children_col = 'has_children'
	rs.params = 'folder'
	rs.tree_col = 'name'
	rs.can_move_rows = false
	function rs:load_rows(res, params)
		local folder = checkarg( -- requested folder path
			params['param:filter'][1], 'folder required')
		if folder:sub(1, 2) == '~/' then
			folder = indir(homedir(), folder:sub(3))
		end
		folder = path_normalize(abspath(folder), false, false)
		local tree = trees[folder] -- the folder's scanned tree
		if not tree then
			tree = scan_tree(folder)
			trees[folder] = tree
		end
		local rows = {} -- [row, ...]: see folder_row()
		local recursive = params['param:recursive'] -- load whole subtrees
		--the parents of the rows to load, null for the root; the root alone
		--when the client sends no parents.
		for _, parent_path in ipairs(params['param:parent_ids'] or {null}) do
			if parent_path == null then
				add(rows, tree.root_row)
				if recursive then
					add_child_rows(rows, tree.child_rows, folder, true)
				end
			else
				add_child_rows(rows, tree.child_rows, parent_path, recursive)
			end
		end
		res.rows = rows
	end
end)

local address_words = ctype'uint32_t[4]'() -- native-endian address words

local function format_address(address)
	for i = 1, #address / 8 do -- address word index
		address_words[i-1] = tonumber(address:sub(i*8-7, i*8), 16)
	end
	if #address == 8 then
		return format('%d.%d.%d.%d', str(address_words, 4):byte(1, 4))
	else
		return ipv6_tostring(str(address_words, 16), true)
	end
end

local protocols = {'tcp', 'tcp6', 'udp', 'udp6'} -- /proc/net file names

rowset.os_explorer_ports = virtual_rowset(function(rs)
	rs.fields = {
		{name = 'protocol', label = 'Protocol', not_null = true},
		{name = 'address', label = 'Address'},
		{name = 'port', label = 'Port', type = 'number'},
		{name = 'inode', label = 'Socket inode', not_null = true,
			hidden = true},
	}
	rs.pk = 'protocol inode'
	rs.can_move_rows = false
	function rs:load_rows(res)
		res.rows = {} -- [{protocol, address, port, inode}]
		for _, protocol in ipairs(protocols) do
			local contents = load('/proc/net/'..protocol) -- socket table text
			if contents then
				for address, port, state, inode in contents:gmatch(
					'%d+:%s+(%x+):(%x+)%s+%x+:%x+%s+(%x+)'
					..'%s+%S+%s+%S+%s+%S+%s+%d+%s+%d+%s+(%d+)[^\n]*'
				) do
					port = tonumber(port, 16)
					if port ~= 0 and (protocol:sub(1, 3) == 'udp'
						or state == '0A')
					then
						add(res.rows, {
							protocol, format_address(address), port, inode,
						})
					end
				end
			end
		end
	end
end)
