--[[

	webb_auth mdbx storage

]]

function auth_schema()

	import'schema_std'

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
		pass        , hash    ,
		active      , bool1   ,
		title       , name    ,
		name        , name    ,
		phone       , strid   ,
		phonevalid  , bool0   ,
		sex         , enum'M F O',
		birthday    , date    ,
		newsletter  , bool0   ,
		roles       , text    ,
		note        , text    ,
		theme       , strid   ,
		auth_code   , strid   ,
		auth_code_created  , time ,
		auth_code_trycount , int  ,
		auth_code_validates, enum'email phone',
		clientip    , strid   , --when it was created
		atime       , atime   , --last access time
		ctime       , ctime   , --creation time
		mtime       , mtime   , --last modification time
	}

	tables.usr_tenant = {
		usr         , id, not_null, child_fk,
		tenant      , id, not_null, chilk_fk, pk(usr, tenant),
	}

	tables.sess = {
		sess        , hash   , not_null, pk,
		tenant      , id     , not_null, child_fk,
		usr         , id     , not_null, child_fk,
		clientip    , strid  , --when it was created
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
