--[=[

	Path manipulation for Windows and UNIX paths.
	Written by Cosmin Apreutesei. Public Domain.

	Parses all Windows path formats including long paths (`\\?\`),
	device paths (`\\.\`) and UNC paths.

	The only paths that are portable between Windows and UNIX (Linux, OSX)
	without translation are relative paths using forward slashes only which
	are no longer than 259 bytes and which don't contain any control characters
	(code 0-31) or the symbols `<>:"|%?*\`.

	path.platform -> 'win'|'unix'                       get the current platform
	path.platform_sep -> '\'|'/'                        get the path separator for this plaform
	path.default_sep([pl]) -> '\'|'/'                   get the default separator for a platform
	path.dev_alias(s) -> s|nil                          check if a path is a Windows device alias
	path.type(s, [pl]) -> type                          get the path type
	path.parse(s, [pl]) -> type, path[, drv|srv]        break down a path to its basic parts
	path.format(type, path, [drv|srv], pl) -> s         put together a path from parsed parts
	path.isabs(s, [pl]) -> is_abs, is_empty, is_valid   check if path is absolute, empty and valid
	path.endsep(s, [pl], [sep], [dsep]) -> s, ok        get/add/remove the ending separator
	path.sep(s, [pl], [sep], ...) -> s                  detect/set the path separator
	path.long(s, [pl], [long]) -> s|nil                 get/set a Windows long absolute path
	path.file(s, [pl]) -> s                             get the last component of a path
	path.nameext(s, [pl]) -> name, ext                  split `path.file(s)` into name and extension
	path.ext(s, [pl]) -> s                              return only the extension from `path.nameext(s)`
	path.dir(s, [pl]) -> s|nil                          get the path without the last component
	path.gsplit(s, [pl], [full]) ->iter() -> s, sep     iterate over path's components
	path.normalize(s, [pl], [opt]) -> s                 normalize a path in various ways
	path.commonpath(s1, s2, [pl]) -> s|nil              get the common prefix of two paths
	path.depth(s, [pl]) -> n                            get the number of non-empty path components
	path.combine(s1, s2, [pl], [sep], [dsep]) -> s|nil  combine two paths if possible
	path.abs(dir, s, [pl], [sep], [dsep]) -> s|nil,err  convert relative path to absolute
	path.indir(dir, ...) -> path                        combine path with one or more components
	path.rel(s, pwd, [pl], [sep], [dsep]) -> s|nil      convert absolute path to relative
	path.filename(s, [pl], [repl]) -> s|nil,err,code    validate/make-valid filename

	`pl` stands for platform and defaults to path.platform.

]=]

if not ... then require'path_test'; return end

local path = {}
setmetatable(path, path)

path.platform_sep = package.config:sub(1, 1)
path.platform = path.platform_sep and 'win' or 'unix'

local function win(pl) --check if pl (or current platform) is Windows
	if pl == nil then pl = path.platform end
	assert(pl == 'unix' or pl == 'win', 'invalid platform')
	return pl == 'win'
end

function path.default_sep(pl)
	return win(pl) and '\\' or '/'
end

--device aliases are file names that are found _in any directory_.
local dev_aliases = {
	CON=1, PRN=1, AUX=1, NUL=1,
	COM1=1, COM2=1, COM3=1, COM4=1, COM5=1, COM6=1, COM7=1, COM8=1, COM9=1,
	LPT1=1, LPT2=1, LPT3=1, LPT4=1, LPT5=1, LPT6=1, LPT7=1, LPT8=1, LPT9=1,
}

--check if a path refers to a device alias and return that alias.
function path.dev_alias(s)
	s = s:match'[^\\/]+$' --basename (dev aliases are present in all dirs)
	s = s and s:match'^[^%.]+' --strip extension (they can have any extension)
	s = s and s:upper() --they're case-insensitive
	return s and dev_aliases[s] and s
end

--get the path type which can be:
--	* 'abs'          `C:\path` or `/path`             Windows or UNIX
--	* 'rel'          `a/b`                            Windows and UNIX
--	* 'abs_long'     `\\?\C:\path`                    Windows
--	* 'abs_nodrive'  `\path`                          Windows
--	* 'rel_drive'    `C:a\b`                          Windows
--	* 'unc'          `\\server\share\path`            Windows
--	* 'unc_long'     `\\?\UNC\server\share\path`      Windows
--	* 'global'       `\\?\path`                       Windows
--	* 'dev'          `\\.\path`                       Windows
--	* 'dev_alias'    `CON`, `c:\path\nul.txt`, etc.   Windows
--NOTE: The empty path ('') comes off as type 'rel'.
function path.type(s, pl)
	if win(pl) then
		if s:find'^\\\\' then
			if s:find'^\\\\%?\\' then
				if s:find'^\\\\%?\\%a:\\' then
					return 'abs_long'
				elseif s:find'^\\\\%?\\[uU][nN][cC]\\' then
					return 'unc_long'
				else
					return 'global'
				end
			elseif s:find'^\\\\%.\\' then
				return 'dev'
			else
				return 'unc'
			end
		elseif path.dev_alias(s) then
			return 'dev_alias'
		elseif s:find'^%a:' then
			return s:find'^..[\\/]' and 'abs' or 'rel_drive'
		else
			return s:find'^[\\/]' and 'abs_nodrive' or 'rel'
		end
	else
		return s:byte(1) == ('/'):byte(1) and 'abs' or 'rel'
	end
end

--Split a path into its local path component (i.e. the part containing only
--directories and files, eg. `\path` for `C:\path` or for `\\server\path`)
--and, depending on the path type, the drive letter or server name.
--UNC paths are not validated and can have an empty server or share path.
function path.parse(s, pl)
	local type = path.type(s, pl)
	if win(pl) then
		if type == 'rel' or type == 'abs_nodrive' then
			return type, s -- nothing to split
		elseif type == 'abs' or type == 'rel_drive' then
			return type, s:sub(3), s:sub(1,1) -- \path, drive
		elseif type == 'abs_long' then
			return type, s:sub(3+4), s:sub(1+4,1 +4) -- \path, drive
		elseif type == 'unc' then
			local server, path = s:match'^..([^\\]*)(.*)$'
			return type, path, server
		elseif type == 'unc_long' then
			local server, path = s:match'^........([^\\]*)(.*)$'
			return type, path, server
		elseif type == 'dev' then
			return type, s:sub(4) -- \path
		elseif type == 'dev_alias' then
			return type, s -- CON, NUL, ...
		elseif type == 'global' then
			return type, s:sub(4) -- \path
		end
	else
		return type, s --unix path: nothing to split
	end
end

--put together a path from its broken-down components (no validation).
function path.format(type, path, drive, pl)
	if win(pl) and type == 'abs' or type == 'rel_drive' then
		return drive .. ':' .. path
	elseif type == 'abs_long' then
		return '\\\\?\\' .. drive .. ':' .. path
	elseif type == 'unc' then
		return '\\\\' .. drive .. path
	elseif type == 'unc_long' then
		return '\\\\?\\UNC\\' .. drive .. path
	elseif type == 'dev' then
		return '\\\\.' .. path
	elseif type == 'global' then
		return '\\\\?' .. path
	else --abs/unix, rel, abs_nodrive, dev_alias
		return path
	end
end

--Check if a path is an absolute path or not, if it's empty (i.e. root) or not,
--and if it's valid or not. Absolute paths for which their local path
--is '' are actually invalid (currently only UNC paths can be invalid and
--still parse); for those paths the third return value will be false.
local function isabs(type, p, win)
	if type == 'rel' or type == 'rel_drive' or type == 'dev_alias' then
		return false, p == '', true
	elseif p == '' then
		return true, true, false --invalid absolute path
	else
		local isroot = p:find(win and '^[\\/]+$' or '^/+$') and true or false
		return true, isroot, true
	end
end
function path.isabs(s, pl)
	local type, p = path.parse(s, pl)
	return isabs(type, p, win(pl))
end

--determine a path's separator if possible.
local function detect_sep(p, win)
	if win then
		local fws = p:find'[^/]*/'
		local bks = p:find'[^\\/]*\\'
		if not fws == not bks then
			return nil --can't determine
		end
		return fws and '/' or '\\'
	else
		return '/'
	end
end

--[[
Get/add/remove an ending separator of a path. `sep` can be:

* nil or missing  : the ending separator is returned (nil is returned
                    if the path has no ending separator).
* true, '\\', '/' : the path is returned with an ending separator added
                    (true means use path's own separator if it has one and
                    failing that, use dsep or the default platform separator).
* false or ''     : the path without its ending separator is returned.

`success` is `false` if trying to add or remove the ending separator from
an empty path (note that even when that happens, the path can still be
concatenated directly to a relative path and result in a valid path).

Multiple consecutive separators are treated as one in that they are returned
together and are replaced together.
]]
local function set_endsep(type, p, win, sep, default_sep)
	local _, isempty = isabs(type, p, win)
	if isempty then --refuse to change empty paths
		return
	elseif sep == false or sep == '' then --remove it
		return p:gsub(win and '[\\/]+$' or '/+$', '')
	elseif p:find(win and '[\\/]$' or '/$') then --add it/already set
		return p
	else
		if sep == true then
			sep = detect_sep(p, win) or default_sep or (win and '\\' or '/')
		end
		assert(sep == '\\' or sep == '/', 'invalid separator')
		return p .. sep
	end
end
function path.endsep(s, pl, sep, default_sep)
	local win = win(pl)
	local type, p, drive = path.parse(s, pl)
	if sep == nil then
		return p:match(win and '[\\/]+$' or '/+$')
	else
		local p = set_endsep(type, p, win, sep, default_sep)
		return p and path.format(type, p, drive, pl) or s, p and true or false
	end
end

--[[
Detect or set a path's separator (for Windows paths only).

`sep` can be:

	* nil   : detect.
	* true  : set to default_sep.
	* false : set to default_sep if both `\` and `/` are found in the path.
	* '\\' or '/' : set specifically.
	* nil when empty_names is explicitly false: collapse duplicate separators only.

`default_sep` defaults to the platform separator. Unless `empty_names` is `true`,
consecutive separators are collapsed into the first one.

Setting the separator as `\` on a UNIX path may result in an invalid path
because `\` is a valid character in UNIX filenames.
]]
local function set_sep(p, win, sep, default_sep, empty_names)
	local dsep = default_sep or (win and '\\' or '/')
	if sep == true then --set to default
		sep = dsep
	elseif sep == false then --set to default only if mixed
		sep = detect_sep(p, win) or dsep
	elseif sep == nil then --collapse only
		sep = '%1'
	else
		assert(sep == '\\' or sep == '/', 'invalid separator')
	end
	if empty_names then
		return p:gsub(win and '[\\/]' or '/', sep)
	else
		return p:gsub(win and '([\\/])[\\/]*' or '(/)/*', sep)
	end
end
function path.sep(s, pl, sep, default_sep, empty_names)
	local win = win(pl)
	local type, p, drive = path.parse(s, pl)
	if sep == nil and empty_names == nil then
		return detect_sep(p, win)
	else
		p = set_sep(p, win, sep, default_sep, empty_names)
		return path.format(type, p, drive, pl)
	end
end

--[[
Get/set a Windows long absolute path (one starting with `\\?\C:\`). If
`long` is `nil`, returns whether the path is a long or short Windows absolute
path (returns `nil` for all other kinds of paths). Otherwise it converts the
path, in which case `long` can be `true` (convert to long path), `false`
(convert to short path) or `'auto'` (convert to long style if too long,
or to short style if short enough).
]]
function path.long(s, pl, long)
	local type, p, drive = path.parse(s, pl)
	local is_long = type == 'abs_long' or type == 'unc_long'
	local is_short = (win(pl) and type == 'abs') or type == 'unc'
	if long == nil then
		if is_long then
			return true
		elseif is_short then
			return false
		else
			return nil --does not apply
		end
	end
	if
		is_short and (long == true or (long == 'auto' and #s > 259))
	then
		p = p:gsub('/+', '\\') --NOTE: this might create a smaller path
		local long_type = type == 'abs' and 'abs_long' or 'unc_long'
		s = path.format(long_type, p, drive, pl)
	elseif
		is_long and (long == false or (long == 'auto' and #s <= 259 + 4))
	then
		local short_type = type == 'abs_long' and 'abs' or 'unc'
		s = path.format(short_type, p, drive, pl)
	end
	return s
end

--Get the last path component of a path.
--Returns `''` if the path is empty or ends with a separator.
function path.file(s, pl)
	local _, p = path.parse(s, pl)
	return p:match(win(pl) and '[^\\/]*$' or '[^/]*$')
end

--[[
Split a path's last component into the name and extension parts like so:

	* a.txt'     -> 'a', 'txt'
	* '.bashrc'  -> '.bashrc', nil
	* 'a'        -> 'a', nil
	* 'a.'       -> 'a', ''

]]
function path.nameext(s, pl)
	local patt = win(pl) and '^(.-)%.([^%.\\/]*)$' or '^(.-)%.([^%./]*)$'
	local file = path.file(s, pl)
	local name, ext = file:match(patt)
	if not name or name == '' then -- 'dir' or '.bashrc'
		name, ext = file, nil
	end
	return name, ext
end

function path.ext(s, pl)
	return (select(2, path.nameext(s, pl)))
end

--Get a path without the last component and separator. If the path ends with
--a separator then it returns the whole path without the separator. Multiple
--consecutive separators are treated as one. Returns `nil` for `''`, `'.'`,
--`'C:'`, `'/'`, `'C:\\'` and `\\server\`. Returns `'.'` for simple filenames.
function path.dir(s, pl)
	local type, p, drive = path.parse(s, pl)
	if p == '' or p == '.' then --current dir has no dir
		return nil
	end
	local i1, i2, i3 = p:match(win(pl)
		and '()[\\/]*()[^\\/]*()$' or '()/*()[^/]*()$')
	if i1 == 1 and i3 == i2 then --root dir has no dir
		return nil
	end
	local i = i1 == 1 and i2 or i1
	local s = path.format(type, p:sub(1, i-1), drive, pl)
	return s == '' and '.' or s --fix '' as '.'
end

--[[
Iterate over a path's components (that is excluding prefixes like `\\server`
or `C:`) and separators. Pass `true` to the `full` arg to iterate over the
whole unparsed path. For absolute paths, the first iteration is
`'', <root_separator>`. Empty names are not iterated. Instead, consecutive
separators are returned together. Concatenating all the iterated path
components and separators always results in the exact original path.
]]
function path.gsplit(s, pl, full)
	local win = win(pl)
	local p = full and s or select(2, path.parse(s, pl))
	local root_sep = p:match(win and '^[\\/]+' or '^/+')
	local next_pc = p:gmatch(win and '([^\\/]+)([\\/]*)' or '([^/]+)(/*)')
	local started = not root_sep
	return function()
		if not started then
			started = true
			return '', root_sep
		elseif started then
			return next_pc()
		end
	end
end

local function repl(x, v, r)
	if x == v then return r else return x end
end

--[[
Normalize a path. `opt` can contain:

 * dot_dirs     : keep `.` dirs (false).
 * dot_dot_dirs : keep unnecessary `..` dirs (true).
   WARNING: removing `..` breaks the path if there are symlinks involved!
 * sep (false), default_sep, empty_names : args for path.sep(). use 'leave' to skip.
 * endsep (false) : sep arg for path.endsep(). use 'leave' to skip.
 * long ('auto')  : long arg for path.long(). use 'leave' to skip.

If normalization results in the empty relative path '', then '.' is returned.
]]
function path.normalize(s, pl, opt)
	opt = opt or {}
	local win = win(pl)
	local type, p, drive = path.parse(s, pl)

	local t = {} --{dir1, sep1, ...}
	local lastsep --last separator that was not added to the list
	for s, sep in path.gsplit(p, pl, true) do
		if s == '.' and not opt.dot_dirs then
			--skip adding the `.` dir and the separator following it
			lastsep = sep
		elseif s == '..' and opt.dot_dot_dirs ~= false and #t > 0 then
			--find the last dir past any `.` dirs, in case opt.dot_dirs = true.
			local i = #t-1
			while t[i] == '.' do
				i = i - 2
			end
			--remove the last dir (and the separator following it)
			--that's not `..` and it's not the root element.
			if i > 0 and ((i > 1 or t[i] ~= '') and t[i] ~= '..') then
				table.remove(t, i)
				table.remove(t, i)
				lastsep = sep
			elseif #t == 2 and t[1] == '' then
				--skip any `..` after the root slash
				lastsep = sep
			else
				table.insert(t, s)
				table.insert(t, sep)
			end
		else
			table.insert(t, s)
			table.insert(t, sep)
			lastsep = nil
		end
	end
	if type == 'rel' and #t == 0 then
		--rel path '' is invalid. fix that.
		table.insert(t, '.')
		table.insert(t, lastsep)
	elseif lastsep == '' and (#t > 2 or t[1] ~= '') then
		--if there was no end separator originally before removing path
		--components, remove the left over end separator now.
		table.remove(t)
	end
	p = table.concat(t)

	if opt.sep ~= 'leave' then
		p = set_sep(p, win, repl(opt.sep, nil, false),
			opt.default_sep, opt.empty_names)
	end

	if opt.endsep ~= 'leave' then
		p = set_endsep(type, p, win, repl(opt.endsep, nil, false),
			opt.default_sep) or p
	end

	s = path.format(type, p, drive, pl)

	if win and opt.long ~= 'leave' then
		s = path.long(s, pl, repl(opt.long, nil, 'auto'))
	end

	return s
end

--[[
Get the common path prefix of two paths, including the end separator if both
paths share it, or `nil` if the paths don't have anything in common.

Note that `path.commonpath('C:', 'C:\\', 'win') == nil` because the paths are
of different type even if they look like they share a common prefix.

BUG: The case-insensitive comparison for Windows doesn't work with
paths with non-ASCII characters because it's made with `string.lower()`.
Proper lowercase your paths before using this function, or patch
`string.lower()` to support utf8 lowercasing. This is not an issue if both
paths are in the original letter case (eg. they come from the same API).
]]
function path.commonpath(s1, s2, pl)
	local win = win(pl)
	local t1, p1, d1 = path.parse(s1, pl)
	local t2, p2, d2 = path.parse(s2, pl)
	local t, p, d
	if #p1 <= #p2 then --pick the smaller/first path when formatting
		t, p, d = t1, p1, d1
	else
		t, p, d = t2, p2, d2
	end
	if win then --make the search case-insensitive and normalize separators
		d1 = d1 and d1:lower()
		d2 = d2 and d2:lower()
		p1 = p1:lower():gsub('/', '\\')
		p2 = p2:lower():gsub('/', '\\')
	end
	if t1 ~= t2 or d1 ~= d2 then
		return nil
	elseif p1 == '' or p2 == '' then
		return path.format(t, p, d, pl)
	end
	local sep = (win and '\\' or '/'):byte(1)
	local si = 0 --index where the last common separator was found
	for i = 1, #p + 1 do
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
	p = p:sub(1, si)
	return path.format(t, p, d, pl)
end

--Get the number of non-empty path components, excluding prefixes
--like `C:\`, `\\server\`, etc.
local function depth(p, win)
	local n = 0
	for _ in p:gmatch(win and '()[^\\/]+' or '()[^/]+') do
		n = n + 1
	end
	return n
end
function path.depth(s, pl)
	local _, p = path.parse(s, pl)
	return depth(p, win(pl))
end

--[[
Combine two paths if possible (return `nil, err` if not). Supported
combinations are between anything except between `dev_alias` and `rel` paths,
between `abs_nodrive` and `rel_drive`, and between `rel_drive` and `abs`
or `abs_long`. When the paths can only be combined in one way, paths can be
given in any order. The separator with which paths are combined is either
`sep` or if `sep` is nil it's detected and if that fails `default_sep` or the
default separator is used.
]]
local function combinable(type1, type2)
	if type2 == 'rel' then             -- any + c/d -> any/c/d
		return type1 ~= 'dev_alias'
	elseif type2 == 'abs_nodrive' then -- C:a/b + /c/d -> C:/c/d/a/b
		return type1 == 'rel_drive'
	elseif type2 == 'rel_drive' then   -- C:/a/b + C:c/d -> C:/a/b/c/d
		return type1 == 'abs' or type1 == 'abs_long'
	end
end
function path.combine(s1, s2, pl, sep, default_sep)
	local type1, p1, drive1 = path.parse(s1, pl)
	local type2, p2, drive2 = path.parse(s2, pl)
	if not combinable(type1, type2) then
		if combinable(type2, type1) then
			type1, type2, s1, s2, p1, p2, drive1, drive2 =
			type2, type1, s2, s1, p2, p1, drive2, drive1
		else
			return nil, ('cannot combine %s and %s paths'):format(type1, type2)
		end
	end
	if s2 == '' then -- any + '' -> any
		return s1
	elseif type2 == 'rel' or type2 == 'abs_nodrive' then
		local win = win(pl)
		local sep = sep or detect_sep(p1, win) or detect_sep(p2, win)
			or default_sep or (win and '\\' or '/')
		if type2 == 'rel' then -- any + c/d -> any/c/d
			p1 = set_endsep(type1, p1, win, sep) or p1
			return path.format(type1, p1 .. s2, drive1, pl)
		elseif type2 == 'abs_nodrive' then -- C:a/b + /d/e -> C:/d/e/a/b
			p2 = set_endsep(type2, p2, win, sep) or p2
			return path.format(type1, p2 .. p1, drive1, pl)
		end
	elseif type2 == 'rel_drive' then -- C:/a/b + C:d/e -> C:/a/b/d/e
		if drive1 ~= drive2 then
			return nil, 'path drives are different'
		end
		return path.combine(s1, p2, pl)
	end
end

--Convert a relative path into an absolute path given a base dir.
path.abs = path.combine

--make a path by combining dir with one or more path components.
function path.indir(dir, file, ...)
	if not file then return dir end
	local p, err = path.combine(dir, file)
	if not p then return nil, err end
	return path.indir(p, ...)
end

--Convert an absolute path into a relative path which is relative to `pwd`.
--Returns `nil` if the paths are of different types or don't have a base path
--in common. The ending (back)slash is preserved if present.
function path.rel(s, pwd, pl, sep, default_sep)
	local prefix = path.commonpath(s, pwd, pl)
	if not prefix then return nil end
	local type, p, drive = path.parse(s, pl)
	local win = win(pl)
	local sep = sep or detect_sep(pwd, win) or detect_sep(p, win)
		or default_sep or (win and '\\' or '/')
	local endsep = p:match(win and '[\\/]*$' or '/*$')
	local pwd_suffix = pwd:sub(#prefix + 1)
	local n = depth(pwd_suffix, win)
	local p1 = ('..' .. sep):rep(n - 1) .. (n > 0 and '..' or '')
	local p2 = p:sub(#prefix + 1)
	local p2 = p2:gsub(win and '^[\\/]+' or '^/+', '')
	local p2 = p2:gsub(win and '[\\/]+$' or '/+$', '')
	local p2 = p1 == '' and p2 == '' and '.' or p2
	local p3 = p1 .. (p1 ~= '' and p2 ~= '' and sep or '') .. p2 .. endsep
	return path.format(type, p3, drive, pl)
end

--[[
Validate a filename or apply a replacement function on it in order to make it
valid. `repl` can be a `function(match, err) -> repl_str` that receives the
problematic match and an error code indicating the problem which can be one
of '', '.', '..', 'dev_alias', 'char', 'length', 'evil' and it should return
a replacement string or `false/nil` if it cannot do the replacement
(`'evil'` errors should generally be replaced with `''`).
--NOTE: If repl isn't itself escaped then duplicate filenames can result.
]]
function path.filename(s, pl, repl, break_on_err)
	local win = win(pl)

	local function check(err, msg)
		if not repl or err == break_on_err then
			return nil, msg, err
		end
		local s = repl(s, err)
		if not s then
			return nil, msg, err
		end
		return path.filename(s, pl, repl, err) --tail call
	end

	function subcheck(patt, err, msg)
		if repl then
			local user_repl = repl
			function repl(s, err)
				local s, repl_count = s:gsub(patt, function(c)
					return user_repl(c, err) --returning nil/false means no repl.
				end)
				return repl_count > 0 and s
			end
		end
		return check(err, msg)
	end

	local invalid_chars = win and '[%z\1-\31<>:"|%?%*\\/]' or '[%z/]'
	local empty

	if s == '' then
		return check(s, 'empty filename')
	elseif s == '.' or s == '..' then
		return check(s, 'filename is `.` or `..`')
	elseif win and path.dev_alias(s) then
		return check('dev_alias', 'filename is a Windows device alias')
	elseif win and s:find(invalid_chars) then
		return subcheck(invalid_chars, 'char', 'invalid characters in filename')
	elseif #s > 255 then --same maximum for Windows and Linux
		return check('length', 'filename too long')
	elseif s:find' +$' then
		return subcheck(' +$', 'evil', 'filename ends with spaces')
	elseif s:find'^ +' then
		return subcheck('^ +', 'evil', 'filename begins with spaces')
	elseif s:find'%.+$' then
		return subcheck('%.+$', 'evil', 'filename ends with a dot')
	end
	return s
end

return path

