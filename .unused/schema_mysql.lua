
--schema mysql library.
--Written by Cosmin Apreutesei. Public Domain.

--adds the mysql attrs on top of the types that schema_std declares, so that
--each type keeps one declaration. import this instead of schema_std.

require'glue'
require'schema'

--NOTE: locals clash with words in the schema definition below so we name
--them so they can't be field types or flags!

local datetime_to_timestamp = function(s) return mysql_datetime_to_timestamp(s) end
local timestamp_to_datetime = function(t) return mysql_timestamp_to_datetime(t) end
local time_to_seconds       = function(t) return mysql_time_to_seconds(t) end
local seconds_to_time       = function(s) return mysql_seconds_to_time(s) end

local format_timeago   = timeago
local format_timeofday = timeofday

local env = {}
do
	local
		type, cat, outdent, trim, index =
		type, cat, outdent, trim, index

	function env.enum(...) --mysql-specific `enum` type
		local vals = collect(words(cat({...}, ' ')))
		return {is_type = true,
			type = 'enum', enum_values = vals, charset = 'ascii', collation = 'ascii_ci',
			enum_indices = index(vals),
			mysql_type = 'enum', mysql_collation = 'ascii_general_ci',
			tarantool_type = 'string',
			tarantool_collation = 'none',
			mdbx_type = 'u8',
		}
	end

	function env.set(...) --mysql-specific `set` type
		local vals = collect(words(cat({...}, ' ')))
		return {is_type = true, type = 'set', mysql_type = 'set', set_values = vals,
			charset = 'ascii', collation = 'ascii_general_ci' , mysql_collation = 'ascii_general_ci'}
	end

	function env.mysql(s) --mysql code for triggers and stored procs.
		return {mysql_body = _('begin\n%s\nend',
			outdent(trim(outdent((s:gsub('\r\n', '\n')))), '\t'))}
	end

	function env.date_to_sql(v, field, spp)
		if type(v) == 'number' then --timestamp
			return _('from_unixtime(%0.17g)', v)
		end
		return spp:sqlval(v)
	end

	function env.bool_to_lua(v)
		if v == nil then return nil end
		return tonumber(v) ~= 0
	end

end

local current_timestamp_symbol = setmetatable({'current_timestamp'}, {
	__tostring = function() return 'current timestamp' end,
})

return function()

	import'schema_std'
	import(env)

	current_timestamp = current_timestamp_symbol

	flags.ascii_ci   = {charset = ascii, collation = 'ascii_ci'  , mysql_collation = 'ascii_general_ci'  }
	flags.ascii_bin  = {charset = ascii, collation = 'ascii_bin' , mysql_collation = 'ascii_bin'        }
	flags.utf8_ci    = {charset = utf8 , collation = 'utf8_ci'   , mysql_collation = 'utf8mb4_0900_as_ci'}
	flags.utf8_bin   = {charset = utf8 , collation = 'utf8_bin'  , mysql_collation = 'utf8mb4_0900_bin' }

	types.blob       = {type = 'binary', mdbx_type = 'u8'}
	types.longtext   = {str, maxlen = 0xffffffff}
	types.dec        = {type = 'number', mysql_type = 'decimal'}

	flags.utf8_ai_ci = {}
	flags.utf8_ai_ci.charset         = utf8
	flags.utf8_ai_ci.collation       = 'utf8_ai_ci'
	flags.utf8_ai_ci.mysql_collation = 'utf8mb4_0900_ai_ci'
	flags.str.mysql_type             = 'varchar'

	types.bool.size                = 1
	types.bool.unsigned            = true
	types.bool.decimals            = 0
	types.bool.mysql_type          = 'tinyint'
	types.bool.mysql_to_lua        = bool_to_lua
	types.bool.mysql_to_tarantool  = bool_to_lua
	types.bool0.mysql_default      = '0'
	types.bool1.mysql_default      = '1'

	types.int8.size           = 1
	types.int16.size          = 2
	types.int32.size          = 4
	types.int52.size          = 8
	types.double.size         = 8
	types.float.size          = 4
	types.uint8.unsigned      = true
	types.uint16.unsigned     = true
	types.uint32.unsigned     = true
	types.uint52.unsigned     = true

	types.int8.mysql_type     = 'tinyint'
	types.int16.mysql_type    = 'smallint'
	types.int32.mysql_type    = 'int'
	types.int52.mysql_type    = 'bigint'
	types.double.mysql_type   = 'double'
	types.float.mysql_type    = 'float'
	types.dec.mysql_type      = 'decimal'

	types.money.digits        = 15
	types.qty.digits          = 15
	types.percent.digits      = 8

	types.bin.mysql_type      = 'varbinary'
	types.text.mysql_type     = 'text'
	types.longtext.mysql_type = 'longtext'
	types.chr.mysql_type      = 'char'
	types.blob.mysql_type     = 'mediumblob'
	types.blob.size           = 0xffffff

	--column sizes and per-column collations, which schema_std's string types
	--no longer carry: a positional flag such as utf8_ci cannot be added to a
	--type list from here, so the attrs it stood for are set directly.
	types.text.size      = 0xffff     ; types.text.mysql_collation      = 'utf8mb4_0900_bin'
	types.longtext.size  = 0xffffffff ; types.longtext.mysql_collation  = 'utf8mb4_0900_bin'
	types.name.size      =  256       --collation comes from its own ai_ci flag
	types.strid.size     =   64       ; types.strid.mysql_collation     = 'ascii_general_ci'
	types.longstrid.size = 2048       ; types.longstrid.mysql_collation = 'ascii_bin'
	types.email.size     =  512       ; types.email.mysql_collation     = 'utf8mb4_0900_as_ci'
	types.hash.size      =   64       ; types.hash.mysql_collation      = 'ascii_bin'
	types.url.size       = 2048       ; types.url.mysql_collation       = 'ascii_bin'
	types.b64key.size    = 8192       ; types.b64key.mysql_collation    = 'ascii_bin'
	types.lang.size      =    2       ; types.lang.mysql_collation      = 'ascii_general_ci'
	types.currency.size  =    3       ; types.currency.mysql_collation  = 'ascii_general_ci'
	types.country.size   =    2       ; types.country.mysql_collation   = 'ascii_general_ci'

	--mysql stores a clock time either as the TIME column type, whose value is
	--a string that to_number/from_number convert to and from seconds, or as a
	--plain double holding the seconds. mdbx has only the second one, so the
	--type for it lives here.
	types.timeofday.mysql_type  = 'time'
	types.timeofday.to_number   = time_to_seconds
	types.timeofday.from_number = seconds_to_time

	--a TIME value is already a string, so it displays as-is. this shadows
	--schema_std's timeofday.to_text, which formats a number of seconds.
	function type_attrs.timeofday.to_text(s)
		return s
	end

	types.timeofday_in_seconds = {
		type = 'timeofday_in_seconds',
		align = 'center', mysql_type = 'double',
	}
	types.timeofday_in_seconds_s = {timeofday_in_seconds}

	function type_attrs.timeofday_in_seconds.to_text(s, f)
		return format_timeofday(s, f.precision)
	end

	types.date.mysql_type         = 'date'
	types.date.mysql_to_sql       = date_to_sql
	types.date.mysql_to_tarantool = datetime_to_timestamp
	types.date.to_number          = datetime_to_timestamp
	types.date.from_number        = timestamp_to_datetime
	types.datetime.mysql_type     = 'datetime'

	--NOTE: do not use `timestamp` as it's prone to Y2038 in MySQL, use `datetime` instead,
	--which works the same as `timestamp` as long as you set the server timezone to UTC.
	--types.timestamp   = {datetime, mysql_type = 'timestamp', precision = 'm'}
	--types.timestamp_s = {datetime, mysql_type = 'timestamp', precision = 's'}

	types.atime.mysql_default   = current_timestamp
	types.ctime.mysql_default   = current_timestamp
	types.mtime.mysql_default   = current_timestamp
	types.mtime.mysql_on_update = current_timestamp

	--schema_std's default() sets only `default`, so the types that use it
	--need their mysql literal spelled out here.
	types.count.mysql_default    = '0'
	types.bigcount.mysql_default = '0'

	--a DATE/DATETIME value is already a string, so it displays as-is unless
	--timeago asks for a relative time. this shadows schema_std's
	--date.to_text, which formats a timestamp.
	function type_attrs.date.to_text(d, f)
		if f.timeago then
			return format_timeago(datetime_to_timestamp(d))
		end
		return d
	end

end
