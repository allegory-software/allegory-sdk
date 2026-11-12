require'views_os'

local rs = rowset.os_explorer_file
local dir = '/tmp/sdk_file_editor_'..uuid()
mkdir(dir)
currentthread():ownenv().http_request = {response_headers = {}}

local function expect_error(message, f)
	local ok, err = catch('http_response', f)
	assert(not ok)
	assert(err.status == 400)
	assert(err.content == message, err.content)
end

local ok, err = xpcall(function()
	assert(#rs:load{}.rows == 0)
	assert(#rs:load{path = null}.rows == 0)
	local path = indir(dir, 'text.txt')
	local text = 'first\tline\nUTF-8: \195\169\n'
	save({path = path, file_perms = tonumber('755', 8)}, text)
	local inode = file_attr(path, 'inode')
	local perms = file_attr(path, 'perms')
	local result = rs:load{path = path}
	assert(#result.rows == 1)
	assert(result.rows[1][1] == path)
	assert(result.rows[1][2] == text)
	assert(result.params.path.lookup_rowset_name == 'os_explorer_files')
	assert(result.params.path.lookup_cols == 'path')
	assert(result.params.path.accept_many == false)
	assert(result.fields[2].maxlen == 16 * 1024^2)

	local changes = {rows = {{type = 'update', values = {
		['path:old'] = path, contents = 'updated\n',
	}}}}
	local saved = rs:apply_changes(changes, {path = '/unrelated'})
	assert(not saved.rows[1].error)
	assert(load(path) == 'updated\n')
	assert(file_attr(path, 'inode') ~= inode)
	assert(file_attr(path, 'perms') == perms)
	assert(saved.rows[1].values[2] == 'updated\n')

	rs:update_row{['path:old'] = path, contents = null}
	assert(load(path) == '')
	assert(rs:load{path = path}.rows[1][2] == null)
	assert(#rs:load{path = dir}.rows == 0)
	assert(#rs:load{path = indir(dir, 'absent')}.rows == 0)
	local link = indir(dir, 'link')
	symlink(link, path)
	assert(#rs:load{path = link}.rows == 0)
	expect_error('not a regular file', function()
		rs:update_row{['path:old'] = link, contents = 'no'}
	end)
	assert(file_attr(link, 'type', false) == 'symlink')

	save(path, 'binary\0data')
	expect_error('binary file', function() rs:load{path = path} end)
	expect_error('binary file', function()
		rs:update_row{['path:old'] = path, contents = '\0'}
	end)
	assert(load(path) == 'binary\0data')

	local max_size = 16 * 1024^2
	local large = ('a'):rep(max_size)
	save(path, large)
	assert(#rs:load{path = path}.rows[1][2] == max_size)
	expect_error('file exceeds 16 MiB', function()
		rs:update_row{['path:old'] = path, contents = large..'a'}
	end)
	save(path, large..'a')
	expect_error('file exceeds 16 MiB', function()
		rs:load{path = path}
	end)
end, debug.traceback)

rm_rf(dir)
assert(ok, err)
print('file rowset: load, atomic save, permissions, empty files, exclusions,'
	..' limits')
