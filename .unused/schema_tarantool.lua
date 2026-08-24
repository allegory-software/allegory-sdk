
--schema tarantool library.
--Written by Cosmin Apreutesei. Public Domain.

--adds the tarantool attrs on top of the types that schema_std declares, so
--that each type keeps one declaration. import this instead of schema_std.

require'glue'
require'schema'

return function()

	import'schema_std'

	flags.ascii_ci   = {charset = ascii, collation = 'ascii_ci'  , tarantool_collation = 'unicode_ci'}
	flags.ascii_bin  = {charset = ascii, collation = 'ascii_bin' , tarantool_collation = 'binary'    }
	flags.utf8_ci    = {charset = utf8 , collation = 'utf8_ci'   , tarantool_collation = 'unicode_ci'}
	flags.utf8_bin   = {charset = utf8 , collation = 'utf8_bin'  , tarantool_collation = 'binary'    }

	flags.utf8_ai_ci.tarantool_collation = 'unicode_ci'
	flags.str.tarantool_type             = 'string'

	--per-column collations, which schema_std's string types no longer carry:
	--a positional flag such as utf8_ci cannot be added to a type list from
	--here, so the attr it stood for is set directly.
	types.text.tarantool_collation      = 'binary'
	types.longtext.tarantool_collation  = 'binary'
	types.name.tarantool_collation      = 'unicode_ci'
	types.strid.tarantool_collation     = 'unicode_ci'
	types.longstrid.tarantool_collation = 'binary'
	types.email.tarantool_collation     = 'unicode_ci'
	types.hash.tarantool_collation      = 'binary'
	types.url.tarantool_collation       = 'binary'
	types.b64key.tarantool_collation    = 'binary'
	types.lang.tarantool_collation      = 'unicode_ci'
	types.currency.tarantool_collation  = 'unicode_ci'
	types.country.tarantool_collation   = 'unicode_ci'

	types.bool.tarantool_type     = 'boolean'
	types.bool0.tarantool_default = false
	types.bool1.tarantool_default = true

	types.int8.tarantool_type   = 'integer'
	types.int16.tarantool_type  = 'integer'
	types.int32.tarantool_type  = 'integer'
	types.int52.tarantool_type  = 'integer'
	types.double.tarantool_type = 'number'
	types.float.tarantool_type  = 'number'
	types.dec.tarantool_type    = 'number'

	types.bin.tarantool_type       = 'string'
	types.blob.tarantool_type      = 'string'
	types.blob.tarantool_collation = 'none'

	types.timeofday.tarantool_type            = 'number'
	types.date.tarantool_type                 = 'number'
	types.time_date.tarantool_type            = 'number'

	--schema_std's default() sets only `default`, so the types that use it
	--need their tarantool value spelled out here.
	types.count.tarantool_default    = 0
	types.bigcount.tarantool_default = 0

end
