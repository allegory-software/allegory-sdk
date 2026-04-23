--[=[

	Path manipulation for UNIX paths.
	Written by Cosmin Apreutesei. Public Domain.

	path_normalize(s, [remove_double_dots], [remove_endsep]) -> s|nil
	basename(s) -> s|nil                   get the last component of a path
	dirname(s[, levels=1]) -> s|nil        get the path without last component(s)
	path_nameext(s) -> name|nil, ext|nil   split `basename(s)` into name and extension
	path_ext(s) -> s|nil                   return only the extension from `nameext(s)`
	indir(dir, ...) -> path                combine path with one or more sub-paths
	path_commonpath(p1, p2) -> p|nil       common path prefix between two paths
	relpath(s, pwd) -> s|nil               convert absolute path to relative

]=]

if not ... then require'path_test'; return end

require'glue'
local
	typeof, select, assertf, tostring =
	typeof, select, assertf, tostring

--Get the last path component of a path. Returns '' for 'a/'.
function basename(s)
	return s:match'[^/]*$'
end

--Normalize path by collapsing `//`, removing `/./` and `foo/..`, and fixing end `/`.
--NOTE: returns nil if path results in `/../foo` which is invalid.
--NOTE: Removing `..` breaks the path if there are symlinks involved!
function path_normalize(s, rm_double_dots, rm_add_endsep)
	if s == '' then s = '.' end --important or it turns into `/` later on.
	--remove empty components
	s = s:gsub('//+', '/')  -- // -> /
	--remove `.` components
	local s0
	repeat  -- a/././b -> a/./b -> a/b
		s0 = s
		s = s:gsub('/%./', '/')
	until s == s0
	if s ~= './' then
		s = s:gsub('^%./', '') -- './a' -> 'a' but './' -> './'
	end
	if s ~= '/.' then
		s = s:gsub('/%.$', '') -- 'a/.' -> 'a' but '/.' -> '/'
	else
		s = '/'
	end
	--remove `a/..` components (this only works if no `.` components are left).
	if rm_double_dots then
		local endsep = s:sub(-1) == '/'
		if not endsep then s = s .. '/' end --add end `/` temporarily
		local s0
		repeat -- `a/../` -> ''
			s0 = s
			s = s:gsub('([^/]+)/%.%./', function(parent)
				if parent == '..' then return nil end --keep leading `..`
				return ''
			end)
		until s == s0
		if s:starts'/../' then --can't go above / on abs paths
			return nil
		elseif s == '' then --removed too much, path got ambiguous
			s = endsep and './' or '.'
		elseif not endsep and s ~= '/' then --remove temp `/`
			s = s:sub(1, -2)
		end
	end
	--add or remove end `/`
	if rm_add_endsep == true and s:sub(-1) ~= '/' then --add
		s = s .. '/'
	elseif rm_add_endsep == false and s ~= '/' and s:sub(-1) == '/' then --remove
		s = s:sub(1, -2)
	end
	return s
end

--Get the parent directory of a path.
--Returns nil for '', '/' and '.'; returns '.' for simple filenames.
--Trailing slashes are stripped first so 'a/' -> '.' (not 'a').
--Semantics chosen so that recursive dirname() always ends in nil.
--NOTE: paths with '.' components circumvent the semantics of "going up"
--so remove those before computing dirname.
function dirname(s, levels)
	levels = levels or 1
	while levels > 0 do
		s = s:match'^(.-)/*$' --strip trailing slashes
		if s == '' or s == '/' or s == '.' then return nil end
		s = s:match'^(.*)/' or '.' -- /a/b/c -> /a/b; /a -> ''; a -> .
		if s == '' then return '/' end -- /a -> /
		levels = levels - 1
	end
	return s
end

--Split a path's last component into the name and extension parts like so:
--   a.txt    -> a        , txt
--   .bashrc  -> .bashrc  , nil
--   a        -> a        , nil
--   a.       -> a        , ''
function path_nameext(s)
	local patt = '^(.-)%.([^%./]*)$'
	local file = basename(s)
	if not file then
		return nil, nil
	end
	local name, ext = file:match(patt)
	if not name or name == '' then -- 'dir' or '.bashrc'
		return file, nil
	end
	return name, ext
end

function path_ext(s)
	return (select(2, path_nameext(s)))
end

--Make a path by combining dir with one or more relative sub-paths.
--Being extra-careful here because usage bugs can wipe out the drive.
function indir(dir, s, ...)
	local t = typeof(dir)
	assertf(t == 'string' or t == 'number', 'indir: invalid dir arg type: %s', t)
	dir = tostring(dir)
	local t = typeof(s)
	assertf(t == 'number' or t == 'string', 'indir: invalid file arg type: %s', t)
	s = tostring(s)
	assertf(not s:starts'/', 'indir: invalid file: %s', s) --appending abs path
	assertf(dir ~= '', 'indir: empty dir')
	assertf(s ~= '', 'indir: empty file')
	local s = dir:gsub('/*$', '/') .. s
	return select('#', ...) > 0 and indir(s, ...) or s
end

--Get the common path prefix of two paths, including the end separator if both
--paths share it, or nil if the paths don't have anything in common.
--Returns '' if both are relative paths with nothing in common.
function path_commonpath(p1, p2)
	local p = #p1 <= #p2 and p1 or p2
	if p == '' then return nil end
	local sep = ('/'):byte(1)
	local si = 0 --index where the last common separator was found
	for i = 1, #p + 1 do --going 1 byte beyond the end where we "see" a sep
		local c1 = p1:byte(i)
		local c2 = p2:byte(i)
		local sep1 = c1 == nil or c1 == sep
		local sep2 = c2 == nil or c2 == sep
		if sep1 and sep2 then
			si = i
		elseif c1 ~= c2 then
			break
		end
	end
	if si == 0 then
		local abs1 = p1:byte(1) == sep
		local abs2 = p2:byte(1) == sep
		if abs1 ~= abs2 then return nil end  --paths with nothing in common
		return '' --both relative, implicit shared base
	end
	return p:sub(1, si)
end

---number of non-empty path components, excluding prefixes.
local function path_depth(p)
	local n = 0
	for _ in p:gmatch'()[^/]+' do -- () prevents creating a string that we don't need
		n = n + 1
	end
	return n
end

--Convert a path (abs or rel) into a rel path that is relative to pwd.
--Returns nil if the paths don't have a base path in common. The ending slash
--is preserved if present.
function relpath(s, pwd)
	local prefix = path_commonpath(s, pwd)
	if not prefix then return nil end
	local endsep = s:match'/*$'
	local pwd_suffix = pwd:sub(#prefix + 1)
	local n = path_depth(pwd_suffix)
	local p1 = ('../'):rep(n - 1) .. (n > 0 and '..' or '')
	local p2 = s:sub(#prefix + 1)
	local p2 = p2:gsub('^/+', '')
	local p2 = p2:gsub('/+$', '')
	local p2 = p1 == '' and p2 == '' and '.' or p2
	return p1 .. (p1 ~= '' and p2 ~= '' and '/' or '') .. p2 .. endsep
end
