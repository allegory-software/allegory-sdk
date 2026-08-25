
--schema types and flags for mdbx databases.
--Written by Cosmin Apreutesei. Public Domain.

--if not ... then require'schema_test'; return end

require'glue'
require'lang' --format_timeago(), format_timeofday(), format_duration()
require'schema'

--NOTE: locals clash with words in the schema definition below so we name
--them so they can't be field types or flags!
local
	memoize, format_kbytes, format_kcount =
	memoize, format_kbytes, format_kcount

local
	format_timeago, format_timeofday, format_duration =
	format_timeago, format_timeofday, format_duration

local format_date = date

local string_format = format
local string_cat    = cat
local math_floor    = floor

local _G = _G
local function restore_env(self, fn)
	if getfenv(fn) == self.env then setfenv(fn, _G) end
	return fn
end

local function expr_fn_flag(name, v, attrs)
	local is_fn = isfunc(v)
	assertf(is_fn or isstr(v), '%s expression or function expected', name)
	return function(self)
		local t = update({}, attrs)
		t[name..(is_fn and '_fn' or '_expr')] = v
		if is_fn then restore_env(self, v) end
		return t
	end
end

local function install_trigger_helpers(self)
	for _, event in ipairs{
		'before_insert', 'after_insert',
		'before_update', 'after_update',
		'before_delete', 'after_delete',
	} do
		self.env[event] = function(arg1, arg2)
			if isstr(arg1) then --standalone: before_insert('usr', fn)
				local tbl = assertf(self.tables[arg1],
					'unknown table for trigger: %s', arg1)
				local fn = assertf(isfunc(arg2) and arg2,
					'function expected for %s.%s', arg1, event)
				add(attr(attr(tbl, 'triggers'), event), restore_env(self, fn))
			else --inline: before_insert(fn) -- returns a table-level flag
				local fn = assertf(isfunc(arg1) and arg1,
					'function expected for trigger %s', event)
				return function(sc, tbl)
					add(attr(attr(tbl, 'triggers'), event), restore_env(sc, fn))
				end
			end
		end
	end
end

local env = {}
do
	local
		tonumber, cat =
		tonumber, cat

	--text ordered by the declared order and restricted to it by a check.
	--values come as words or, when a value contains spaces, as a table.
	--enum('open closed', {open = 'Open', closed = 'Closed'}) -> english labels
	function env.enum(vals, labels)
		vals = collect(words(vals))
		local maxlen, checks = 0, {}
		for i, v in ipairs(vals) do
			assertf(not v:find('\0', 1, true),
				'enum value with an embedded zero: %s', v)
			if #v > maxlen then maxlen = #v end
			checks[i] = _('v == %q', v)
		end
		if labels then
			local vals_set = index(vals)
			for v in pairs(labels) do
				assertf(vals_set[v], 'unknown enum value in labels: %s', v)
			end
		end
		return {
			type = 'enum', enum_values = vals, en_enum_labels = labels,
			mdbx_type = 'utf8', maxlen = maxlen, nozero = true,
			mdbx_collation = 'list\0'..cat(vals, '\0'),
			check_expr = cat(checks, ' or '),
			check_error = 'enum',
		}
	end

	function env.sort_order(vals) --order values by their declared order
		vals = collect(words(vals))
		for _, v in ipairs(vals) do
			assertf(not v:find('\0', 1, true),
				'collation value with an embedded zero: %s', v)
		end
		return {mdbx_collation = 'list\0'..cat(vals, '\0')}
	end

	function env.hash(size) --small + fixed size makes it indexable
		return function()
			return {type = 'binary', mdbx_type = 'binary',
				fixed = true, maxlen = size}
		end
	end

	function env.maxlen(n)
		return function()
			return {maxlen = n}
		end
	end

	--Typed client-side value with an optional server-side expression or fn.
	function env.default(v, server_default)
		if server_default ~= nil then
			return expr_fn_flag('default', server_default, {client_default = v})
		end
		return function() return {client_default = v} end
	end

	function env.check(expr, error_message)
		return expr_fn_flag('check', expr, {check_error = error_message})
	end

	function env.row_check(expr, error_message)
		local flag = expr_fn_flag('row_check', expr,
			{row_check_error = error_message})
		return function(self, tbl)
			update(tbl, flag(self))
		end
	end

	function env.on_update(expr)
		return expr_fn_flag('on_update', expr)
	end

	function env.as(gen_fn_version, expr)
		if expr == nil then gen_fn_version, expr = nil, gen_fn_version end
		assertf(not isstr(gen_fn_version), 'as(expr) does not take a version')
		return expr_fn_flag('gen', expr, {gen_fn_version = gen_fn_version})
	end

end

return function()

	import(env)
	install_trigger_helpers(self)

	--table-level marker: place before the fields or as a field flag.
	--mdbx_query reads a virtual table's fields from the paper schema
	--directly and never opens it as a physical table.
	function virtual(self, tbl) tbl.virtual = true end

	flags.hidden   = {hidden = true}
	flags.not_null = {not_null = true}
	flags.autoinc  = {auto_increment = true, readonly = true}
	flags.nozero   = {nozero = true} --no embedded zeroes allowed
	flags.fixed    = {fixed = true} --fixed size: allows indexing without nozero
	flags.ai_ci    = {mdbx_collation = 'utf8_ai_ci'}

	--non-indexable varsize types
	types.text   = {type = 'text', mdbx_type = 'utf8', maxlen = 4096}
	types.binary = {type = 'binary', mdbx_type = 'binary', maxlen = 64*1024^2}
	--indexable varsize types (must be nozero or fixed)
	types.str    = {text, maxlen = 200, nozero}
	types.name   = {str, ai_ci}

	types.bool  = {type = 'bool', w = 20, align = 'center', mdbx_type = 'bool'}
	types.bool0 = {bool , not_null, default(false, 'false')}
	types.bool1 = {bool , not_null, default(true , 'true' )}

	types.i8  = {type = 'number', align = 'right', decimals = 0, min = -2^ 7, max = 2^ 7-1, mdbx_type = 'i8'}
	types.i16 = {type = 'number', align = 'right', decimals = 0, min = -2^15, max = 2^15-1, mdbx_type = 'i16'}
	types.i32 = {type = 'number', align = 'right', decimals = 0, min = -2^31, max = 2^31-1, mdbx_type = 'i32'}
	types.i52 = {type = 'number', align = 'right', decimals = 0, min = -(2^52-1), max = 2^52-1, mdbx_type = 'f64'}
	types.u8  = {i8 , min = 0, max = 2^ 8-1, mdbx_type = 'u8' }
	types.u16 = {i16, min = 0, max = 2^16-1, mdbx_type = 'u16'}
	types.u32 = {i32, min = 0, max = 2^32-1, mdbx_type = 'u32'}
	types.u52 = {i52, min = 0, max = 2^52-1, mdbx_type = 'f64'}
	types.f32 = {type = 'number' , align = 'right', mdbx_type = 'f32'}
	types.f64 = {type = 'number' , align = 'right', mdbx_type = 'f64'}

	types.id   = {u32, w = 40}
	types.idpk = {id, pk, autoinc}
	types.pos  = {id, en_label = 'Position in List'}

	--for money and qty, scale can be dynamic and taken from currency / unit
	--of measure, though some apps can normalize on a single scale.
	--min and max are in scaled units!
	types.money    = {f64, scale = 10^4, decimals = 2, min = -(10^15-1), max = 10^15-1} --  99 999 999 999 . 9999
	types.qty      = {f64, scale = 10^6, decimals = 6, min = -(10^15-1), max = 10^15-1} --     999 999 999 . 999999
	types.percent  = {f64, type = 'percent', scale = 10^2, decimals = 2, min = -(10^8-1), max = 10^8-1} -- 999 999 . 99
	types.count    = {u52, type = 'count', default(0, '0')}
	types.filesize = {u52, type = 'filesize', align = 'right'}

	--unix timestamps. max is the last second of year 9999.
	types.time     = {u52, type = 'datetime', align = 'center', w = 140, precision = 'm',
		min = 0, max = 253402300799}
	types.time_s   = {time, w = 160, precision = 's'}
	types.time_ms  = {time, w = 200, precision = 'ms'}
	types.timeago  = {time_s, timeago = true}
	types.date     = {time, type = 'date', w = 80, precision = 'd'}
	--seconds since midnight.
	types.timeofday = {u52, type = 'timeofday', align = 'center',
		min = 0, max = 24*3600-1}
	types.timeofday_s = {timeofday, precision = 's'}
	types.duration  = {u52, type = 'duration', align = 'right'}

	types.ctime = {time, not_null, readonly = true, default(nil, 'now()'),
		en_label = 'Created At'}
	types.mtime = {time, not_null, readonly = true,
		default(nil, 'now()'), on_update'now()',
		en_label = 'Last Modified At'}
	types.atime = {time, not_null, readonly = true, default(nil, 'now()'),
		en_label = 'Last Accessed At'}

	types.lang      = {str, maxlen = 2, fixed}
	types.currency  = {str, maxlen = 3, fixed}
	types.country   = {str, maxlen = 2, fixed}

	types.secret_key  = {text, type = 'secret_key' , maxlen = 8192}
	types.public_key  = {text, type = 'public_key' , maxlen = 8192}
	types.private_key = {text, type = 'private_key', maxlen = 8192}
	types.url   = {text, type = 'url', maxlen = 4096}
	types.email = {str, type = 'email', maxlen = 128, ai_ci}
	types.phone = {str, type = 'phone', maxlen = 32}
	types.password = {text, type = 'password', maxlen = 128}
	types.color = {str, type = 'color', maxlen = 32} --css color
	types.icon  = {str, type = 'icon' , maxlen = 32} --icon name
	types.col   = {str, type = 'col'  , maxlen = 64} --col name
	types.tags  = {text, type = 'tags'} --space-separated words
	types.place = {str, type = 'place', maxlen = 200} --google maps place id
	types.button = {type = 'button'}

	--field-type-based formatting ---------------------------------------------

	function type_attrs.bool.to_text(b)
		return b and 'Y' or b ~= nil and 'N' or ''
	end

	function type_attrs.binary.to_text(s)
		local hex = {}
		for i = 1, #s do
			hex[i] = string_format('%02x', s:byte(i))
		end
		return string_cat(hex)
	end

	local decfmt = memoize(function(dec)
		return '%.'..dec..'f' or '%.0f'
	end)
	--a scaled col stores the value times its scale, so displaying it divides.
	function type_attrs.number.to_text(n, f)
		if f.scale then n = n / f.scale end
		return string_format(f.decimals and decfmt(f.decimals) or '%0.15g', n)
	end

	function type_attrs.count.to_text(n, f)
		return format_kcount(n, f.magnitude_decimals, f.magnitude)
	end

	function type_attrs.timeofday.to_text(s, f)
		return format_timeofday(s, f.precision)
	end

	function type_attrs.time.to_text(t, f)
		if f.timeago then
			return format_timeago(t)
		elseif f.precision == 'ms' then
			--os.date() has no fractional seconds so append them.
			local s = format_date('%Y-%m-%d %H:%M:%S', t)
			local frac = t - math_floor(t)
			if frac == 0 then
				return s
			else
				return s..(string_format('%.6f', frac):sub(2):gsub('0+$', ''))
			end
		else
			return format_date(
				f.precision == 's' and '%Y-%m-%d %H:%M:%S'
				or f.precision == 'd' and '%Y-%m-%d'
				or '%Y-%m-%d %H:%M', t)
		end
	end

	function type_attrs.duration.to_text(n, f)
		return format_duration(n, f.duration_format)
	end

	function type_attrs.filesize.to_text(n, f)
		return format_kbytes(n, f.magnitude_decimals, f.magnitude)
	end

	local decfmt = memoize(function(dec)
		return '%.'..dec..'f%%' or '%.0f%$'
	end)
	function type_attrs.percent.to_text(p, f)
		return string_format(decfmt(f.decimals), p / f.scale)
	end

end
