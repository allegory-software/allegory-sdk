--[[

	webb_auth mdbx storage

]]

function auth_schema()

	import'schema_mdbx'

	tables.tenant = {
		tenant      , idpk,
		name        , name,
		host        , name, uk,
		active      , bool1,
		ctime       , ctime,
	}

	tables.usr = {
		usr         , idpk    ,
		anonymous   , bool1   ,
		email       , email   , uk,
		emailvalid  , bool0   ,
		pass        , str     , --bcrypt_hash() is ascii nozero 60 chars
		active      , bool1   ,
		title       , name    ,
		name        , name    ,
		phone       , str     ,
		phonevalid  , bool0   ,
		sex         , enum'M F O',
		birthday    , date    ,
		newsletter  , bool0   ,
		roles       , text    ,
		note        , text    ,
		theme       , str     ,
		auth_code   , str     , --six_digit_code()
		auth_code_created  , time ,
		auth_code_trycount , count, --capped by the auth_code_maxtry config
		auth_code_validates, enum'email phone',
		clientip    , str     , --when it was created
		atime       , atime   , --last access time
		ctime       , ctime   , --creation time
		mtime       , mtime   , --last modification time
	}

	tables.usr_tenant = {
		usr         , id, not_null, child_fk,
		tenant      , id, not_null, child_fk, pk(usr, tenant),
	}

	tables.sess = {
		--the session id is tohex() of 16 random bytes, so always 32 chars.
		sess        , {str, maxlen = 32, fixed}, not_null, pk,
		tenant      , id     , not_null, child_fk,
		usr         , id     , not_null, child_fk,
		clientip    , str    , --when it was created
		ctime       , ctime  ,
	}

	if _G.multilang() then

		import'lang'

		add_cols('usr after note', {
			lang        , lang    , weak_fk,
			country     , country , weak_fk,
		})

	end

end

require'schema'
require'webb_auth'
