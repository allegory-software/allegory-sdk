
--schema standard library.
--Written by Cosmin Apreutesei. Public Domain.

if not ... then require'schema_test'; return end

local glue = require'glue'
local mysql = require'mysql'

local glue_kbytes = glue.kbytes
local glue_timeago = glue.timeago
local glue_duration = glue.duration
local datetime_to_timestamp = mysql.datetime_to_timestamp
local timestamp_to_datetime = mysql.timestamp_to_datetime
local time_to_seconds = mysql.time_to_seconds
local seconds_to_time = mysql.seconds_to_time

local datetime_to_timestamp = function(s) return datetime_to_timestamp(s) end
local timestamp_to_datetime = function(t) return timestamp_to_datetime(t) end
local time_to_seconds       = function(t) return time_to_seconds(t) end
local seconds_to_time       = function(s) return seconds_to_time(s) end

local M = {}
do
	local schema = require'schema'
	local cat = table.concat
	local names = glue.names
	local format = string.format
	local outdent = glue.outdent
	local trim = glue.trim
	local index = glue.index
	local _ = string.format

	function M.enum(...) --mysql-specific `enum` type
		local vals = names(cat({...}, ' '))
		return {is_type = true,
			type = 'enum', enum_values = vals, charset = 'ascii', collation = 'ascii_ci',
			enum_indices = index(vals),
			mysql_type = 'enum', mysql_collation = 'ascii_general_ci',
			tarantool_type = 'string',
			tarantool_collation = 'none',
		}
	end

	function M.set(...) --mysql-specific `set` type
		local vals = names(cat({...}, ' '))
		return {is_type = true, type = 'set', mysql_type = 'set', set_values = vals,
			charset = 'ascii', collation = 'ascii_general_ci' , mysql_collation = 'ascii_general_ci'}
	end

	function M.mysql(s) --mysql code for triggers and stored procs.
		return {mysql_body = _('begin\n%s\nend',
			outdent(trim(outdent((s:gsub('\r\n', '\n')))), '\t'))}
	end

	function M.bool_to_lua(v) --`to_lua` for the `bool` type stored as `tinyint`.
		if v == nil then return nil end
		return tonumber(v) ~= 0
	end

	function M.date_to_sql(v, field, spp)
		if type(v) == 'number' then --timestamp
			return format('from_unixtime(%0.17g)', v)
		end
		return spp:sqlval(v)
	end

	function M.default(v) --TODO: this only works for numbers and string constants.
		return function(self, tbl, fld)
			return {default = v, mysql_default = tostring(v), tarantool_default = v}
		end
	end

end

local current_timestamp_symbol = setmetatable({'current_timestamp'}, {
	__tostring = function() return 'current timestamp' end,
})

return function()

	import(M)

	current_timestamp = current_timestamp_symbol

	flags.not_null   = {not_null = true}
	flags.autoinc    = {auto_increment = true, readonly = true}
	flags.ascii_ci   = {charset = ascii, collation = 'ascii_ci'  , mysql_collation = 'ascii_general_ci'  , tarantool_collation = 'unicode_ci'}
	flags.ascii_bin  = {charset = ascii, collation = 'ascii_bin' , mysql_collation = 'ascii_bin'         , tarantool_collation = 'binary'}
	flags.utf8_ci    = {charset = utf8 , collation = 'utf8_ci'   , mysql_collation = 'utf8mb4_0900_as_ci', tarantool_collation = 'unicode_ci'}
	flags.utf8_ai_ci = {charset = utf8 , collation = 'utf8_ai_ci', mysql_collation = 'utf8mb4_0900_ai_ci', tarantool_collation = 'unicode_ci'}
	flags.utf8_bin   = {charset = utf8 , collation = 'utf8_bin'  , mysql_collation = 'utf8mb4_0900_bin'  , tarantool_collation = 'binary'}
	flags.str        = {type = 'text'  , mysql_type = 'varchar', tarantool_type = 'string'}

	types.bool      = {type = 'bool', mysql_type = 'tinyint', size = 1, unsigned = true, decimals = 0,
		mysql_to_lua = bool_to_lua, tarantool_type = 'boolean', mysql_to_tarantool = bool_to_lua}
	types.bool0     = {bool , not_null, default = false, mysql_default = '0', tarantool_default = false}
	types.bool1     = {bool , not_null, default = true , mysql_default = '1', tarantool_default = true}

	types.int8      = {type = 'number', size = 1, decimals = 0, mysql_type = 'tinyint'  , min = -(2^ 7-1), max = 2^ 7, tarantool_type = 'integer'}
	types.int16     = {type = 'number', size = 2, decimals = 0, mysql_type = 'smallint' , min = -(2^15-1), max = 2^15, tarantool_type = 'integer'}
	types.int       = {type = 'number', size = 4, decimals = 0, mysql_type = 'int'      , min = -(2^31-1), max = 2^31, tarantool_type = 'integer'}
	types.int52     = {type = 'number', size = 8, decimals = 0, mysql_type = 'bigint'   , min = -(2^52-1), max = 2^51, tarantool_type = 'integer'}
	types.uint8     = {int8 , unsigned = true, min = 0, max = 2^ 8-1}
	types.uint16    = {int16, unsigned = true, min = 0, max = 2^16-1}
	types.uint      = {int  , unsigned = true, min = 0, max = 2^32-1}
	types.uint52    = {int52, unsigned = true, min = 0, max = 2^52-1}

	types.double    = {type = 'number' , size = 8, mysql_type = 'double', tarantool_type = 'number'}
	types.float     = {type = 'number' , size = 4, mysql_type = 'float' , tarantool_type = 'number'}

	types.dec       = {type = 'decimal', mysql_type = 'decimal', tarantool_type = 'number'}

	types.bin       = {type = 'binary', mysql_type = 'varbinary', tarantool_type = 'string'}
	types.text      = {str, mysql_type = 'text', size = 0xffff, maxlen = 0xffff, utf8_bin}
	types.chr       = {str, mysql_type = 'char', padded = true}
	types.blob      = {type = 'binary', mysql_type = 'mediumblob', size = 0xffffff, tarantool_type = 'string', tarantool_collation = 'none'}

	types.timeofday = {type = 'timeofday', mysql_type = 'time', tarantool_type = 'number',
		to_number   = time_to_seconds,
		from_number = seconds_to_time,
	}
	types.date      = {type = 'date', mysql_type = 'date', tarantool_type = 'number',
		mysql_to_sql       = date_to_sql,
		mysql_to_tarantool = datetime_to_timestamp,
		to_number          = datetime_to_timestamp,
		from_number        = timestamp_to_datetime,
	}
	types.datetime  = {date, mysql_type = 'datetime', has_time = true}
	types.datetime_s= {datetime, has_seconds = true}
	--NOTE: do not use `timestamp` as it's prone to Y2038 in MySQL, use `time` instead.
	--types.timestamp   = {date, mysql_type = 'timestamp', has_time = true}
	--types.timestamp_s = {date, mysql_type = 'timestamp', has_time = true, has_seconds = true}
	types.time      = {double, type = 'time', tarantool_type = 'number'}
	types.time_s    = {double, type = 'time', tarantool_type = 'number', has_seconds = true}
	types.time_ms   = {double, type = 'time', tarantool_type = 'number', has_seconds = true, has_ms = true}

	types.id        = {uint}
	types.idpk      = {id, pk, autoinc}
	types.bigid     = {uint52}
	types.bigidpk   = {bigid, pk, autoinc}

	types.name      = {str, size = 256, maxlen = 64, utf8_ci}
	types.strid     = {str, size =  64, maxlen = 64, ascii_ci}
	types.strpk     = {strid, pk}
	types.email     = {str, size =  512, maxlen =  128, utf8_ci}
	types.hash      = {str, size =   64, maxlen =   64, ascii_bin} --enough for tohex(256-bit-hash)
	types.url       = {str, type = 'url', size = 2048, maxlen = 2048, ascii_bin}
	types.b64key    = {str, size = 8192, maxlen = 8192, ascii_bin}

	types.atime     = {datetime, not_null, mysql_default = current_timestamp, readonly = true}
	types.ctime     = {datetime, not_null, mysql_default = current_timestamp, readonly = true}
	types.mtime     = {datetime, not_null, mysql_default = current_timestamp, readonly = true, mysql_on_update = current_timestamp}

	types.ctime.text = Sf('ctime_text', 'Created At')
	types.mtime.text = Sf('mtime_text', 'Last Modified At')
	types.atime.text = Sf('atime_text', 'Last Accessed At')

	types.money     = {dec, digits = 15, decimals = 3} -- 999 999 999 999 . 999     (fits in a double)
	types.qty       = {dec, digits = 15, decimals = 6} --     999 999 999 . 999 999 (fits in a double)
	types.percent   = {dec, digits =  8, decimals = 2} --         999 999 . 99
	types.count     = {uint, not_null, default(0)}
	types.pos       = {uint}

	types.lang      = {chr, size = 2, maxlen = 2, ascii_ci}
	types.currency  = {chr, size = 3, maxlen = 3, ascii_ci}
	types.country   = {chr, size = 2, maxlen = 2, ascii_ci}
	types.timeago   = {datetime_s, to_text = function(d) return glue_timeago(datetime_to_timestamp(d)) end}
	types.filesize  = {uint52, type = 'filesize', to_text = function(n) return glue_kbytes(n) end}
	types.duration  = {uint, type = 'duration', to_text = function(n) return glue_duration(n, 'days') end}

end
