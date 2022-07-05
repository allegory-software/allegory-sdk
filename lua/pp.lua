--[=[

	Pretty printer and serializer.
	Written by Cosmin Apreutesei. Public Domain.

	TIP: If you don't need human-readable or diff'able output, use the
	LuaJIT's built-in `string.buffer:encode()`[1].

	[1]: https://htmlpreview.github.io/?https://github.com/LuaJIT/LuaJIT/blob/v2.1/doc/ext_buffer.html

INPUT
	* all Lua types except coroutines, userdata, cdata and C functions.
	* the ffi `int64_t` and `uint64_t` types.
	* values featuring `__tostring` or `__pwrite` metamethods (eg. tuples).

OUTPUT
	* compact: no spaces, dot notation for identifier keys, minimal
	  quoting of strings, implicit keys for the array part of tables.
	* portable between LuaJIT 2, Lua 5.1, Lua 5.2: dot key notation only
	  for ascii identifiers, numbers are in decimal, NaN and ±Inf are written
	  as 0/0, 1/0 and -1/0 respectively.
	* portable between Windows, Linux, Mac: quoting of `\n` and `\r`
	  protects binary integrity when opening in text mode.
	* embeddable: can be copy-pasted into Lua source code: quoting
	  of `\0` and `\t` and all other control characters protects binary integrity
	  with code editors.
	* human readable: indentation (optional, configurable); array part
	  printed separately with implicit keys.
	* stream-based: the string bits are written with a writer function
	  to minimize the amount of string concatenation and memory footprint.
	* deterministic: table keys are sorted by default, so that the
	  output is usable with diff and checksum.
	* non-identical: object identity is not tracked and is not
	  preserved (table references are dereferenced).

LIMITATIONS
	* object identity is not preserved.
	* recursive: table nesting depth is stack-bound.
	* some fractions are not compact eg. the fraction 5/6 takes 19 bytes
	  vs 8 bytes in its native double format.
	* strings need escaping which could become noticeable with large strings
	  featuring many newlines, tabs, zero bytes, apostrophes, backslashes
	  or control characters.
	* loading back the output with the Lua interpreter is not safe.

API
	pp(v, opt...) -> s                      pretty-print v to a string.
	[try_]pp_save(f|write|path, v, opt...)  pretty-print v to file.

pp_write(write, v, opt...)

	Pretty-print a value using a supplied write function that takes a string.
	The options can be given in a table or as separate args:

	* `indent` - default is '\t', pass `false` to get compact, faster output.
	* `quote` - string quoting to use eg. `'"'` (default is "'").
	* `line_term` - line terminator to use (default is `'\n'`).
	* `onerror` - enable error handling eg. `function(err_type, v, depth)
	   error(err_type..': '..tostring(v)) end` (default is to add a comment).
	* `sort_keys` - sort keys to get deterministic output (default is `true`).
	* `filter` - filter and/or translate values.
	  `filter(v[, k]) -> passes, v`

	Defaults result in diff'able human-readable output that is good for both
	serialization and for inspecting.

]=]

if not ... then require'pp_test'; return end

local ffi = require'ffi'

local
	type, tostring, string_format, string_dump, math_huge, floor =
	type, tostring, string.format, string.dump, math.huge, math.floor

local sort   = table.sort
local concat = table.concat
local io_stdout = io.stdout

local int64  = ffi.typeof'int64_t'
local uint64 = ffi.typeof'uint64_t'

--pretty printing for non-structured types -----------------------------------

local escapes = { --don't add unpopular escapes here
	['\\'] = '\\\\',
	['\t'] = '\\t',
	['\n'] = '\\n',
	['\r'] = '\\r',
}

local function escape_byte_long(c1, c2)
	return string_format('\\%03d%s', c1:byte(), c2)
end
local function escape_byte_short(c)
	return string_format('\\%d', c:byte())
end
local function quote_string(s, quote)
	s = s:gsub('[\\\t\n\r]', escapes)
	s = s:gsub(quote, '\\%1')
	s = s:gsub('([^\32-\126])([0-9])', escape_byte_long)
	s = s:gsub('[^\32-\126]', escape_byte_short)
	return s
end

local function format_string(s, quote)
	return string_format('%s%s%s', quote, quote_string(s, quote), quote)
end

local function write_string(s, write, quote)
	write(quote); write(quote_string(s, quote)); write(quote)
end

local keywords = {}
for i,k in ipairs{
	'and',       'break',     'do',        'else',      'elseif',    'end',
	'false',     'for',       'function',  'goto',      'if',        'in',
	'local',     'nil',       'not',       'or',        'repeat',    'return',
	'then',      'true',      'until',     'while',
} do
	keywords[k] = true
end

local function metamethod(t, m)
	local mt = getmetatable(t)
	return mt and type(mt) == 'table' and rawget(mt, m)
end

local function is_stringable(v)
	return metamethod(v, '__tostring') and true or type(v) == 'string'
end

local function is_identifier(v)
	if is_stringable(v) then
		v = tostring(v)
		return not keywords[v] and v:find('^[a-zA-Z_][a-zA-Z_0-9]*$') ~= nil
	else
		return false
	end
end

local hasinf = math_huge == math_huge - 1
local function format_number(v)
	if v ~= v then
		return '0/0' --NaN
	elseif hasinf and v == math_huge then
		return '1/0' --writing 'math.huge' would not make it portable, just wrong
	elseif hasinf and v == -math_huge then
		return '-1/0'
	elseif v == floor(v) and v >= -2^31 and v <= 2^31-1 then
		return string_format('%d', v) --printing with %d is faster
	else
		return string_format('%0.15g', v)
	end
end

local function write_number(v, write)
	write(format_number(v))
end

local function is_dumpable(f)
	return type(f) == 'function' and debug.getinfo(f, 'Su').what ~= 'C'
end

local function format_function(f)
	return string_format('loadstring(%s)', format_string(string_dump(f, true)))
end

local function write_function(f, write, quote)
	write'loadstring('; write_string(string_dump(f, true), write, quote); write')'
end

local function is_int64(v)
	if type(v) ~= 'cdata' then return false end
	return ffi.istype(v, int64) or ffi.istype(v, uint64)
end

local function format_int64(v)
	return tostring(v)
end

local function write_int64(v, write)
	write(format_int64(v))
end

local function format_value(v, quote)
	quote = quote or "'"
	if v == nil or type(v) == 'boolean' then
		return tostring(v)
	elseif type(v) == 'number' then
		return format_number(v)
	elseif is_stringable(v) then
		return format_string(tostring(v), quote)
	elseif is_dumpable(v) then
		return format_function(v)
	elseif is_int64(v) then
		return format_int64(v)
	else
		assert(false)
	end
end

local function is_serializable(v)
	return type(v) == 'nil' or type(v) == 'boolean' or type(v) == 'number'
		or is_stringable(v) or is_dumpable(v) or is_int64(v)
end

local function write_value(v, write, quote)
	quote = quote or "'"
	if v == nil or type(v) == 'boolean' then
		write(tostring(v))
	elseif type(v) == 'number' then
		write_number(v, write)
	elseif is_stringable(v) then
		write_string(tostring(v), write, quote)
	elseif is_dumpable(v) then
		write_function(v, write, quote)
	elseif is_int64(v) then
		write_int64(v, write)
	else
		assert(false)
	end
end

--pretty-printing for tables -------------------------------------------------

local cache = setmetatable({}, {__mode = 'kv'})
local function cached_pp(v, parents)
	local s = cache[v]
	if not s then
		s = pp(v, nil, parents, nil, nil, nil, true)
		cache[v] = s
	end
	return s
end

local function virttype(v)
	return is_stringable(v) and 'string' or type(v)
end

local type_order = {
	boolean=1, number=2, string=3, table=4, thread=5, cdata=6, ['function']=7,
}
local function cmp_func(t, parents)
	local function cmp(a, b)
		local ta, tb = virttype(a), virttype(b)
		if ta == tb then
			if ta == 'boolean' then
				return (a and 1 or 0) < (b and 1 or 0)
			elseif ta == 'string' then
				return tostring(a) < tostring(b)
			elseif ta == 'number' then
				return a < b
			elseif a == nil then --can happen when comparing values
				return false
			else
				local sa = cached_pp(a, parents)
				local sb = cached_pp(b, parents)
				if sa == sb then --keys look the same serialized, compare values
					return cmp(t[a], t[b])
				else
					return sa < sb
				end
			end
		else
			return type_order[ta] < type_order[tb]
		end
	end
	return cmp
end

local function sortedpairs(t, parents)
	local keys = {}
	for k in pairs(t) do
		keys[#keys+1] = k
	end
	sort(keys, cmp_func(t, parents))
	local i = 0
	return function()
		i = i + 1
		return keys[i], t[keys[i]]
	end
end

local function is_array_index_key(k, maxn)
	return
		maxn > 0
		and type(k) == 'number'
		and k == floor(k)
		and k >= 1
		and k <= maxn
end

local function pretty(v, write, depth, wwrapper, indent,
	parents, quote, line_term, onerror, sort_keys, filter)

	local ok, v = filter(v)
	if not ok then return end

	if is_serializable(v) then

		write_value(v, write, quote)

	elseif metamethod(v, '__pwrite') then

		wwrapper = wwrapper or function(v)
			pretty(v, write, -1, wwrapper, nil,
				parents, quote, line_term, onerror, sort_keys, filter)
		end
		metamethod(v, '__pwrite')(v, write, wwrapper)

	elseif type(v) == 'table' then

		if indent == nil then indent = '\t' end

		parents = parents or {}
		if parents[v] then
			write(onerror and onerror('cycle', v, depth) or 'nil --[[cycle]]')
			return
		end
		parents[v] = true

		write'{'

		local first = true
		local t = v

		local maxn = 0
		for k,v in ipairs(t) do
			maxn = maxn + 1
			local ok, v = filter(v, k, t)
			if ok then
				if first then
					first = false
				else
					write','
				end
				if indent then
					write(line_term)
					write(indent:rep(depth))
				end
				pretty(v, write, depth + 1, wwrapper, indent,
					parents, quote, line_term, onerror, sort_keys, filter)
			end
		end

		local pairs = sort_keys ~= false and sortedpairs or pairs
		for k,v in pairs(t, parents) do
			if not is_array_index_key(k, maxn) then
				local ok, v = filter(v, k, t)
				if ok then
					if first then
						first = false
					else
						write','
					end
					if indent then
						write(line_term)
						write(indent:rep(depth))
					end
					if is_stringable(k) then
						k = tostring(k)
					end
					if is_identifier(k) then
						write(k); write'='
					else
						write'['
						pretty(k, write, depth + 1, wwrapper, indent,
							parents, quote, line_term, onerror, sort_keys, filter)
						write']='
					end
					pretty(v, write, depth + 1, wwrapper, indent,
						parents, quote, line_term, onerror, sort_keys, filter)
				end
			end
		end

		if indent then
			write(line_term)
			write(indent:rep(depth-1))
		end

		write'}'

		parents[v] = nil

	else
		write(onerror and onerror('unserializable', v, depth) or
			string_format('nil --[[unserializable %s]]', type(v)))
	end
end

local function nofilter(v) return true, v end

local function args(opt, ...)
	local
		indent, parents, quote, line_term, onerror,
		sort_keys, filter
	if type(opt) == 'table' then
		indent, parents, quote, line_term, onerror,
		sort_keys, filter =
			opt.indent, opt.parents, opt.quote, opt.line_term, opt.onerror,
			opt.sort_keys, opt.filter
	else
		indent, parents, quote, line_term, onerror,
		sort_keys, filter = opt, ...
	end
	line_term = line_term or '\n'
	filter = filter or nofilter
	return
		indent, parents, quote, line_term, onerror,
		sort_keys, filter
end

function try_pp_save(write, v, ...)
	if type(write) == 'string' then --path
		require'fs'
		local write_protected = assert(file_saver(write))
		function write(s)
			assert(write_protected(s))
		end
	elseif type(write) ~= 'function' then --assume io or fs file object
		local f = write
		function write(s)
			assert(f:write(s))
		end
	end
	write'return '
	return pcall(function(...)
		pretty(v, write, 1, nil, args(...))
		write()
		return true
	end, ...)
end

function pp_save(write, v, ...)
	assert(try_pp_save(write, v, ...))
end

function pp(v, ...)
	local buf = {}
	pretty(v, function(s) buf[#buf+1] = s end, 1, nil, args(...))
	return concat(buf)
end
