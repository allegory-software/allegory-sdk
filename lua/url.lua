--[=[

	URL parsing and formatting.
	Written by Cosmin Apreutesei. Public Domain.

	url_parse(s, [t], [is_local]) -> t  parse URL
	url_format(t) -> s                  format URL

	url_escape(s, [reserved], [unreserved]) -> s   escape URL fragment
	url_unescape(s) -> s                unescape URL fragment
	url_parse_args(s) -> t              parse the URL query part
	url_format_args(t) -> s             format the URL query part
	url_parse_path(s) -> t              parse the URL path part
	url_format_path(t) -> s             format the URL path part
	url_resolve(base, ref) -> t         resolve a relative URL against a base URL

url_format(t) -> s

	Format a URL from a table containing the fields:

		scheme, user, pass, host, port, path|segments, query|args, fragment.

	* `segments` is a list of strings representing the path components which
	can contain slashes; `segments` take priority over `path`.

	* `args` can be {k->v} (convenient) or {k1, v1, ...} (allows duplicate
	keys and preserves key order); keys and values can contain `&=?#`; value
	`true` formats the key without `=`; value `false` skips the key entirely;
	`args` take priority over `query`.

url_parse(s, [t], [is_local]) -> t

	Parse a URL of form:

		[scheme:](([//[user[:pass]@]host[:port][/path])|path)[?query][#fragment]

	into its components (including `segments` and `args`; `args` has both
	its array part and its hash part populated).

	Some edge cases and how they're handled:

		foo?a=b&a=c   {path='foo', args={a='c', 'a', 'b', 'a', 'c'}}
		foo?a=        {path='foo', args={a='', 'a', ''}}
		foo?=b        {path='foo', args={[''] = 'b', '', 'b'}}
		foo?a         {path='foo', args={a=true, 'a', true}}
		foo?=         {path='foo', args={[''] = '', '', ''}}
		foo?          {path='foo', args={[''] = true, '', true}}
		foo           {path='foo'}

	Note that `://:@/;?#` is a valid URL.

url_escape(s, [reserved], [unreserved]) -> s

	Escape all characters except the URL spec `unreserved` and `sub-delims`
	characters, and the characters in the unreserved list, plus the
	characters in the reserved list, if any.

url_unescape(s) -> s

	Unescape escaped characters in the URL.

]=]

if not ... then require'url_test'; return end

require'glue'

--formatting -----------------------------------------------------------------

--escape all characters except `unreserved`, `sub-delims` and the characters
--in the unreserved list, plus the characters in the reserved list.
local function gsub_esc(c)
	return ('%%%02x'):format(c:byte())
end
local function esc(s, reserved, unreserved)
	s = s:gsub('[^A-Za-z0-9%-%._~!%$&\'%(%)%*%+,;='..(unreserved or '')..']', gsub_esc)
	if reserved and reserved ~= '' then
		s = s:gsub('['..reserved..']', gsub_esc)
	end
	return s
end
url_escape = esc

local function format_arg(t, k, v)
	k = k:gsub(' ', '+')
	k = esc(k, '&=')
	if v == true then
		add(t, k)
	elseif v then
		v = tostring(v):gsub(' ', '+')
		add(t, k .. '=' .. esc(v, '&'))
	end
end

function url_format_args(t)
	local dt = {}
	if #t > 0 then --list form
		for i = 1, #t, 2 do
			local k, v = t[i], t[i+1]
			format_arg(dt, k, v)
		end
	else
		for k, v in sortedpairs(t) do
			format_arg(dt, k, v)
		end
	end
	return concat(dt, '&')
end

function url_format_path(t)
	local dt = {}
	for i = 1, #t do
		dt[i] = esc(t[i] or '', '/')
	end
	return concat(dt, '/')
end

--args override query; segments override path.
function url_format(t)
	if isstr(t) then return t end
	local scheme = (t.scheme and esc(t.scheme) .. ':' or '')
	local pass = t.pass and ':' .. esc(t.pass) or ''
	local user = t.user and esc(t.user) .. pass .. '@' or ''
	local port = t.port and ':' .. esc(t.port) or ''
	local host = t.host
	local host = host and (host:find':' and '['..host..']' or esc(host)) --ipv6
	local host = host and '//' .. user .. host .. port or ''
	local path = t.segments and url_format_path(t.segments)
		or t.path and esc(t.path, '', '/') or ''
	local query = t.args and (next(t.args) and '?' .. url_format_args(t.args) or '')
		or t.query and '?' .. esc((t.query:gsub(' ', '+'))) or ''
	local fragment = t.fragment and '#' .. esc(t.fragment) or ''
	return scheme .. host .. path .. query .. fragment
end

--parsing --------------------------------------------------------------------

local function unesc(s)
	return (s:gsub('%%(%x%x)', function(hex)
		return char(tonumber(hex, 16))
	end))
end
url_unescape = unesc

function url_parse_path(s) --[segment[/segment...]]
	local t = {}
	for s in split(s, '/') do
		add(t, unesc(s))
	end
	return t
end

--argument order is retained if putting the keys and values in the array part.
function url_parse_args(s) --var[=[val]]&|;...
	local t = {}
	for s in split(s, '[&;]+') do
		local k, eq, v = s:match'^([^=]*)(=?)(.*)$'
		k = unesc(k:gsub('+', ' '))
		v = unesc(v:gsub('+', ' '))
		if eq == '' then v = true end
		t[k] = v
		add(t, k)
		add(t, v)
	end
	return t
end

--[scheme:](([//[user[:pass]@]host[:port][/path])|path)[?query][#fragment]
--NOTE: t.query is unusable if args names/values contain `&` or `=`.
--NOTE: t.path is unusable if the path segments contain `/`.
--NOTE: the `is_local` flag is because the URL `//` is ambiguous.
function url_parse(s, t, is_local)
	if istab(s) then return s end --pass-through parsed url
	t = t or {}
	s = not is_local and s:gsub('^([a-zA-Z%+%-%.]*):', function(s)
		t.scheme = unesc(s)
		return ''
	end) or s
	s = s:gsub('#(.*)', function(s)
		t.fragment = unesc(s)
		return ''
	end)
	s = s:gsub('%?(.*)', function(s)
		t.query = unesc(s)
		t.args = url_parse_args(s)
		return ''
	end)
	s = not is_local and s:gsub('^//([^/]*)', function(s)
		t.host = unesc(s)
		return ''
	end) or s
	if t.host then
		t.host = t.host:gsub('^(.-)@', function(s)
			t.user = unesc(s)
			return ''
		end)
		t.host = t.host:gsub(':([^:%]]*)$', function(s)
			t.port = unesc(s)
			return ''
		end)
		t.host = t.host:match'^%[(.+)%]$' or t.host --ipv6
		if t.user then
			t.user = t.user:gsub(':(.*)', function(s)
				t.pass = unesc(s)
				return ''
			end)
		end
	end
	if s ~= '' then
		t.segments = url_parse_path(s)
		t.path = unesc(s)
	end
	return t
end

--resolving ------------------------------------------------------------------

--RFC 3986 Section 5.2.4: remove `.` and `..` segments from a path.
local function remove_dot_segments(path)
	local segs = {}
	for seg in split(path, '/') do
		segs[#segs+1] = seg
	end
	local t = {}
	for i = 1, #segs do
		local seg = segs[i]
		if seg == '.' then
			if i == #segs then t[#t+1] = '' end --trailing slash
		elseif seg == '..' then
			if #t > 1 then --keep leading empty segment (leading `/`)
				t[#t] = nil
			end
			if i == #segs then t[#t+1] = '' end --trailing slash
		else
			t[#t+1] = seg
		end
	end
	return concat(t, '/')
end

--RFC 3986 Section 5.2.3: merge a relative path with a base path.
local function merge_paths(base, rel_path)
	if base.host and (not base.path or base.path == '') then
		return '/' .. rel_path
	end
	return base.path and base.path:gsub('[^/]*$', '') .. rel_path or rel_path
end

--RFC 3986 Section 5.2.2: resolve a relative URL reference against a base URL.
--Both `base` and `ref` can be strings or parsed URL tables.
--Returns a new parsed URL table.
function url_resolve(base, ref)
	base = url_parse(base)
	ref  = url_parse(ref)
	local t = {}
	if ref.scheme then -- scheme://host/path
		update(t, ref)
		t.path = remove_dot_segments(t.path or '')
	elseif ref.host then -- //host/path
		update(t, ref)
		t.scheme = base.scheme
		t.path = remove_dot_segments(t.path or '')
	elseif not ref.path or ref.path == '' then -- ?query#fragment
		update(t, base)
		if ref.query then
			t.query = ref.query
			t.args  = ref.args
		end
		t.fragment = ref.fragment
	else -- relpath?query#fragment
		update(t, base)
		t.path = ref.path:sub(1, 1) == '/'
			and remove_dot_segments(ref.path)
			or  remove_dot_segments(merge_paths(base, ref.path))
		t.query    = ref.query
		t.args     = ref.args
		t.fragment = ref.fragment
	end
	if t.path then
		t.segments = url_parse_path(t.path)
	end
	return t
end
