--[=[

	URI parsing and formatting.
	Written by Cosmin Apreutesei. Public Domain.

	uri.parse(s) -> t                   parse URI
	uri.format(t) -> s                  format URI

	uri.escape(s, [reserved], [unreserved]) -> s   escape URI fragment
	uri.unescape(s) -> s                unescape URI fragment
	uri.parse_args(s) -> t              parse the URI query part
	uri.format_args(t) -> s             format the URI query part
	uri.parse_path(s) -> t              parse the URI path part
	uri.format_path(t) -> s             format the URI path part

uri.format(t) -> s

	Format a URI from a table containing the fields:

		scheme, user, pass, host, port, path|segments, query|args, fragment.

	* `segments` is a list of strings representing the path components which
	can contain slashes; `segments` take priority over `path`.

	* `args` can be {k->v} (convenient) or {k1, v1, ...} (allows duplicate
	keys and preserves key order); keys and values can contain `&=?#`; value
	`true` formats the key without `=`; value `false` skips the key entirely;
	`args` take priority over `query`.

uri.parse(s) -> t

	Parse a URI of form:

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

uri.escape(s, [reserved], [unreserved]) -> s

	Escape all characters except the URI spec `unreserved` and `sub-delims`
	characters, and the characters in the unreserved list, plus the
	characters in the reserved list, if any.

uri.unescape(s) -> s

	Unescape escaped characters in the URI.

]=]

local glue = require'glue'
local add = table.insert

--formatting -----------------------------------------------------------------

--escape all characters except `unreserved`, `sub-delims` and the characters
--in the unreserved list, plus the characters in the reserved list.
local function esc(c)
	return ('%%%02x'):format(c:byte())
end
local function escape(s, reserved, unreserved)
	s = s:gsub('[^A-Za-z0-9%-%._~!%$&\'%(%)%*%+,;=' .. (unreserved or '').. ']', esc)
	if reserved and reserved ~= '' then
		s = s:gsub('[' .. reserved .. ']', esc)
	end
	return s
end

local function format_arg(t, k, v)
	k = k:gsub(' ', '+')
	k = escape(k, '&=')
	if v == true then
		add(t, k)
	elseif v then
		v = tostring(v):gsub(' ', '+')
		add(t, k .. '=' .. escape(v, '&'))
	end
end

local function format_args(t)
	local dt = {}
	if #t > 0 then --list form
		for i = 1, #t, 2 do
			local k, v = t[i], t[i+1]
			format_arg(dt, k, v)
		end
	else
		for k, v in glue.sortedpairs(t) do
			format_arg(dt, k, v)
		end
	end
	return table.concat(dt, '&')
end

local function format_path(t)
	local dt = {}
	for i = 1, t.n or #t do
		dt[i] = escape(t[i] or '', '/')
	end
	return table.concat(dt, '/')
end

--args override query; segments override path.
local function format_url(t)
	local scheme = (t.scheme and escape(t.scheme) .. ':' or '')
	local pass = t.pass and ':' .. escape(t.pass) or ''
	local user = t.user and escape(t.user) .. pass .. '@' or ''
	local port = t.port and ':' .. escape(t.port) or ''
	local host = t.host
	local host = host and (host:find':' and '['..host..']' or escape(host)) --ipv6
	local host = host and '//' .. user .. host .. port or ''
	local path = t.segments and format_path(t.segments)
		or t.path and escape(t.path, '', '/') or ''
	local query = t.args and (next(t.args) and '?' .. format_args(t.args) or '')
		or t.query and '?' .. escape((t.query:gsub(' ', '+'))) or ''
	local fragment = t.fragment and '#' .. escape(t.fragment) or ''
	return scheme .. host .. path .. query .. fragment
end

--parsing --------------------------------------------------------------------

local function unescape(s)
	return (s:gsub('%%(%x%x)', function(hex)
		return string.char(tonumber(hex, 16))
	end))
end

local function parse_path(s) --[segment[/segment...]]
	local t = {}
	for s in glue.gsplit(s, '/') do
		add(t, unescape(s))
	end
	return t
end

--argument order is retained if putting the keys and values in the array part.
local function parse_args(s) --var[=[val]]&|;...
	local t = {}
	for s in glue.gsplit(s, '[&;]+') do
		local k, eq, v = s:match'^([^=]*)(=?)(.*)$'
		k = unescape(k:gsub('+', ' '))
		v = unescape(v:gsub('+', ' '))
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
local function parse_url(s, t)
	t = t or {}
	s = s:gsub('^([a-zA-Z%+%-%.]*):', function(s)
		t.scheme = unescape(s)
		return ''
	end)
	s = s:gsub('#(.*)', function(s)
		t.fragment = unescape(s)
		return ''
	end)
	s = s:gsub('%?(.*)', function(s)
		t.query = unescape(s)
		t.args = parse_args(s)
		return ''
	end)
	s = s:gsub('^//([^/]*)', function(s)
		t.host = unescape(s)
		return ''
	end)
	if t.host then
		t.host = t.host:gsub('^(.-)@', function(s)
			t.user = unescape(s)
			return ''
		end)
		t.host = t.host:gsub(':([^:%]]*)$', function(s)
			t.port = unescape(s)
			return ''
		end)
		t.host = t.host:match'^%[(.+)%]$' or t.host --ipv6
		if t.user then
			t.user = t.user:gsub(':(.*)', function(s)
				t.pass = unescape(s)
				return ''
			end)
		end
	end
	if s ~= '' then
		t.segments = parse_path(s)
		t.path = unescape(s)
	end
	return t
end

return {
	escape = escape,
	format = format_url,
	parse = parse_url,
	unescape = unescape,
	format_args = format_args,
	parse_args = parse_args,
	format_path = format_path,
	parse_path = parse_path,
}
