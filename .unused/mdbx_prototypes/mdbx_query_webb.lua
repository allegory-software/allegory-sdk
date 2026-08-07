--[[


	get('val_col1 ...', key_val1, ...) -> val_col1_val, ...
	list()

	atomic(['w', ]f, ...) -> f(tx, ...)

]]

require'mdbx_schema'

function dbname(ns)
	return pconfig(ns, 'db_name')
		or pconfig(ns, 'db_name', scriptname..(ns and '_'..ns or ''))
end

do
local _db
function db()
	if not _db then
		assert(config('db_engine', 'mdbx') == 'mdbx')
		local db_dir = config('db_dir', vardir())
		local db_file = config('db_name', scriptname)..'.mdbx'
		local db_path = indir(db_dir, db_file)
		_db = mdbx_open(db_path)
		_db.schema = app.schema
	end
	return _db
end
end

do
local function abort(tx, ...)
	tx:abort()
	return ...
end
function get(...)
	local tx = db():tx()
	return abort(tx, tx:get(...))
end
end

function put(...)
	local tx = db():txw()
	tx:put(...)
	tx:commit()
end

function atomic(...)
	return db():atomic(...)
end
