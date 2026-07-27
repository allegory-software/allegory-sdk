require'mdbx_schema'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_mdbx_schema_test_'..name..'_'..uuid()..'.mdb'
end

local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

--run f(db, file) against a fresh isolated db.
local function with_db(name, f)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(f, debug.traceback, db, file)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--populate via build(db), close, reopen (so schema is loaded from $schema),
--then verify via check(db).
local function with_db_reopen(name, build, check)
	local file = test_file(name)
	cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		build(db)
		db:close()
		db = mdbx_open(file)
		check(db)
		db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
end

--deep-equal for scalars, strings and array tables (treats nil == nil).
local function valeq(a, b)
	if istab(a) and istab(b) then
		if #a ~= #b then return false end
		for i=1,#a do if a[i] ~= b[i] then return false end end
		return true
	end
	return a == b
end

local function S(v) --printable form for assert messages.
	if istab(v) then return '{'..cat(imap(v, tostring), ',')..'}' end
	return tostring(v)
end

local function try_mutation(db, f, ...)
	return catch('row field', db.atomic, db, 'w', f, db, ...)
end

local function try_schema(db, f, ...)
	return catch('schema', db.atomic, db, 'w', f, db, ...)
end

local function check_row_error(err, event, tab, message)
	assert(iserror(err, 'row'), tostring(err))
	assert(err.event == event, tostring(err.event))
	assert(err.table == tab, tostring(err.table))
	if message then assert(err.message == message, tostring(err.message)) end
end

local function is_row_error(err, message)
	return iserror(err, 'row')
		and (not message or err.message:find(message, 1, true))
end

--schema-graph consistency invariants, checked against the persisted $schema
--catalog (reloaded fresh). meant to catch DDL that leaves the schema in a
--half-updated state. invariants:
--  * catalog <-> $schema: every live table has a $schema row and vice-versa;
--  * every index table is in its value table's runtime index graph;
--  * runtime indexes cover every `ixs` declaration and fk index link;
--  * fk <-> ref_fks are bidirectionally consistent (and ref_table matches).
local function assert_consistent(db, ctx)
	ctx = ctx and (ctx..': ') or ''
	local function E(cond, msg) assert(cond, ctx..msg) end
	local tables = {} --live tables from the catalog, minus the $schema meta table.
	for name in db:each_table() do
		if name ~= '$schema' then tables[name] = true end
	end
	if db:table_exists'$schema' then --every $schema row must map to a live table.
		for _, k, k_sz in db:each_raw'$schema' do
			local tname = str(k, k_sz)
			E(tables[tname], '$schema row with no table: '..tname)
		end
	end
	for name in pairs(tables) do
		local is_ix = name:find('/', 1, true) ~= nil
		local sch = db:load_table_schema(name)
		E(sch, 'table with no $schema: '..name)
		if is_ix then
			E(sch.is_index, 'index $schema not is_index: '..name)
			local vt = sch.val_table
			E(vt and tables[vt], 'index val_table missing: '..name)
			local v = db:load_table_schema(vt)
			E(v.indexes and v.indexes[name],
				'index missing from value table runtime graph: '..name)
		else
			local live = {}
			for _, ix in ipairs(sch.indexes or {}) do
				E(ix.val_table == name, 'index val_table mismatch: '..ix.name)
				E(sch.indexes[ix.name] == ix, 'index missing from name map: '..ix.name)
				E(tables[ix.name], 'missing index table: '..ix.name..' (for '..name..')')
				E(not live[ix.name], 'duplicate runtime index: '..ix.name)
				live[ix.name] = true
			end
			for ix_name in pairs(sch.ixs or {}) do
				E(live[ix_name], 'declared index missing from runtime graph: '..ix_name)
			end
			for fk_name, fk in pairs(sch.fks or {}) do
				E(fk.index and live[fk.index.name],
					'fk index missing from runtime graph: '..name..'/'..fk_name)
				E(sch.indexes[fk.index.name] == fk.index,
					'fk index differs from runtime name map: '..name..'/'..fk_name)
			end
			if sch.fks then --forward: each fk has a reverse ref on its parent.
				for fkn, fk in pairs(sch.fks) do
					local p = db:load_table_schema(fk.ref_table)
					E(p, 'fk parent missing: '..fk.ref_table..' (fk '..fkn..')')
					E(p.ref_fks and p.ref_fks[name..'/'..fkn],
						'fk has no reverse ref: '..name..'/'..fkn)
				end
			end
			if sch.ref_fks then --back: each reverse ref maps to a live child fk.
				for key in pairs(sch.ref_fks) do
					local tbl, fk_name = key:match'^([^/]+)/(.+)$'
					local c = db:load_table_schema(tbl)
					E(c and c.fks and c.fks[fk_name], 'dangling ref_fks: '..key)
					E(c.fks[fk_name].ref_table == name, 'ref_fks target mismatch: '..key)
				end
			end
		end
	end
end

-- numeric keys and values ---------------------------------------------------

--ascending value lists per type, as exact-typed cdata so encode/decode is
--checked with exact == (no FP/precision surprises). lists are sorted ascending.
local num_vals = {
	u8  = {0, 1, 2, 0xff},
	u16 = {0, 1, 2, 0xffff},
	u32 = {0, 1, 2, 0xffffffff},
	i8  = {-128, -2, -1, 0, 1, 2, 127},
	i16 = {-32768, -2, -1, 0, 1, 2, 32767},
	i32 = {-2147483648, -2, -1, 0, 1, 2, 2147483647},
	f32 = {cast('float', -1e9), -2, -1, cast('float', -0.5), 0, cast('float', 0.5), 1, 2, cast('float', 1e9)},
	f64 = {-1e15, -2, -1, -0.5, 0, 0.5, 1, 2, 1e15},
}

--single numeric key + two numeric vals at fixed offsets, asc and desc.
--checks: value round-trip and key ordering for every scalar type.
function test.numeric_keys_and_values()
	with_db('numeric_keys_and_values', function(db)
		db:begin'w'
		for typ in words'u8 u16 u32 i8 i16 i32 f32 f64' do
			local ct = ctype(typ)
			local vals = imap(num_vals[typ], function(v) return ct(v) end)
			for order in words'asc desc' do
				local name = typ..':'..order
				local desc = order == 'desc'
				db:create_table(name, {
					name = name,
					fields = {
						{col = 'k' , mdbx_type = typ, not_null = true},
						{col = 'v1', mdbx_type = typ},
						{col = 'v2', mdbx_type = typ},
					},
					pk = {'k', desc = {desc}},
				})
				local recs = imap(vals, function(v) return {v, v, v} end)
				db:put_records(name, '[k v1 v2]', recs)

				local exp = extend({}, vals)
				if desc then reverse(exp) end
				local i = 0
				for cur, k, v1, v2 in db:each(name) do
					i = i + 1
					assertf(k  == exp[i], '%s.k[%d]: %s ~= %s' , name, i, S(k ), S(exp[i]))
					assertf(v1 == exp[i], '%s.v1[%d]: %s ~= %s', name, i, S(v1), S(exp[i]))
					assertf(v2 == exp[i], '%s.v2[%d]: %s ~= %s', name, i, S(v2), S(exp[i]))
				end
				assertf(i == #exp, '%s: row count %d ~= %d', name, i, #exp)
			end
		end
		db:commit()
	end)
end

--bool key + two bool vals, asc and desc. checks round-trip (false/true) and ordering.
function test.bool_keys_and_values()
	with_db('bool_keys_and_values', function(db)
		db:begin'w'
		local vals = {false, true}
		for order in words'asc desc' do
			local name = 'bool:'..order
			local desc = order == 'desc'
			db:create_table(name, {
				name = name,
				fields = {
					{col = 'k' , mdbx_type = 'bool', not_null = true},
					{col = 'v1', mdbx_type = 'bool'},
					{col = 'v2', mdbx_type = 'bool'},
				},
				pk = {'k', desc = {desc}},
			})
			local recs = imap(vals, function(v) return {v, v, v} end)
			db:put_records(name, '[k v1 v2]', recs)

			local exp = extend({}, vals)
			if desc then reverse(exp) end
			local i = 0
			for cur, k, v1, v2 in db:each(name) do
				i = i + 1
				assertf(k  == exp[i], '%s.k[%d]: %s ~= %s' , name, i, S(k ), S(exp[i]))
				assertf(v1 == exp[i], '%s.v1[%d]: %s ~= %s', name, i, S(v1), S(exp[i]))
				assertf(v2 == exp[i], '%s.v2[%d]: %s ~= %s', name, i, S(v2), S(exp[i]))
			end
			assertf(i == #exp, '%s: row count %d ~= %d', name, i, #exp)
		end
		db:commit()
	end)
end

-- varsize keys --------------------------------------------------------------

--single utf8 varsize key + varsize val at a fixed offset, asc and desc.
function test.varsize_key_single()
	with_db('varsize_key_single', function(db)
		db:begin'w'
		for order in words'asc desc' do
			local name = 'vk1:'..order
			local desc = order == 'desc'
			db:create_table(name, {
				name = name,
				fields = {
					{col = 's', mdbx_type = 'utf8', maxlen = 100, nozero = true, not_null = true},
					{col = 'v', mdbx_type = 'utf8', maxlen = 100},
				},
				pk = {'s', desc = {desc}},
			})
			local t = {{'a','b'}, {'bb',nil}, {'aa','bb'}, {'b',nil}}
			db:put_records(name, '[]', t)
			sort(t, function(r1, r2)
				if desc then return r2[1] < r1[1] else return r1[1] < r2[1] end
			end)
			local i = 0
			for cur, row in db:each(name, '[]') do
				i = i + 1
				assertf(row[1] == t[i][1], '%s.s[%d]: %s ~= %s', name, i, S(row[1]), S(t[i][1]))
				assertf(row[2] == t[i][2], '%s.v[%d]: %s ~= %s', name, i, S(row[2]), S(t[i][2]))
			end
			assertf(i == #t, '%s: row count %d ~= %d', name, i, #t)
		end
		db:commit()
	end)
end

--composite utf8 varsize key (2 cols) + 2 varsize vals at dyn offsets, with
--nulls. checks ordering for all asc/desc combos, dyn-offset val layout, nulls.
function test.varsize_key_composite()
	with_db('varsize_key_composite', function(db)
		db:begin'w'
		for o1 in words'asc desc' do
		for o2 in words'asc desc' do
			local name = ('vk2:%s:%s'):format(o1, o2)
			local s1_desc = o1 == 'desc'
			local s2_desc = o2 == 'desc'
			db:create_table(name, {
				name = name,
				fields = {
					{col = 's1', mdbx_type = 'utf8', maxlen = 100, nozero = true, not_null = true},
					{col = 's2', mdbx_type = 'utf8', maxlen = 100, nozero = true, not_null = true},
					{col = 's3', mdbx_type = 'utf8', maxlen = 100},
					{col = 's4', mdbx_type = 'utf8', maxlen = 100},
				},
				pk = {'s1', 's2', desc = {s1_desc, s2_desc}},
			})
			local t = {
				{'a' , 'b'  , 'a' , nil },
				{'a' , 'a'  , 'a' , 'a' },
				{'a' , 'aaa', 'a' , 'aaa'},
				{'a' , 'bbb', 'a' , nil },
				{'aa', 'a'  , 'aa', 'a' },
				{'aa', 'b'  , 'aa', nil },
				{'bb', 'a'  , nil , 'a' },
				{'bb', 'aa' , nil , 'aa'},
				{'bb', 'bb' , nil , nil },
				{'aa', 'bb' , 'aa', nil },
				{'b' , 'a'  , nil , 'a' },
				{''  , 'a'  , ''  , 'a' },
				{'a' , ''   , 'a' , ''  },
				{'xx', 'y'  , 'z' , 'zz'},
			}
			db:put_records(name, t)
			sort(t, function(r1, r2)
				local c1; if s1_desc then c1 = r2[1] < r1[1] else c1 = r1[1] < r2[1] end
				local c2; if s2_desc then c2 = r2[2] < r1[2] else c2 = r1[2] < r2[2] end
				if r1[1] == r2[1] then return c2 else return c1 end
			end)
			local i = 0
			for cur, s1, s2, s3, s4 in db:each(name) do
				i = i + 1
				assert(db:is_null(name, 's3', s1, s2) == (s3 == nil))
				assert(db:is_null(name, 's4', s1, s2) == (s4 == nil))
				assertf(valeq(s1, t[i][1]), '%s.s1[%d]: %s ~= %s', name, i, S(s1), S(t[i][1]))
				assertf(valeq(s2, t[i][2]), '%s.s2[%d]: %s ~= %s', name, i, S(s2), S(t[i][2]))
				assertf(valeq(s3, t[i][3]), '%s.s3[%d]: %s ~= %s', name, i, S(s3), S(t[i][3]))
				assertf(valeq(s4, t[i][4]), '%s.s4[%d]: %s ~= %s', name, i, S(s4), S(t[i][4]))
			end
			assertf(i == #t, '%s: row count %d ~= %d', name, i, #t)
			--spot-check a point lookup of dyn-offset vals.
			local s3, s4 = db:find(name, 's3 s4', 'xx', 'y')
			assert(s3 == 'z' and s4 == 'zz')
		end
		end
		db:commit()
	end)
end

-- value layout edge cases ---------------------------------------------------

--padded fixed-size array placed (by col order) between two varsize vals.
--regression guard for the val-field sort bug (fixed-size col must not land
--in the dynamic-offset region and break the offset chain).
function test.padded_array_value()
	with_db('padded_array_value', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 's1', mdbx_type = 'utf8', maxlen = 8},
				{col = 'a' , mdbx_type = 'u8'  , maxlen = 4, padded = true},
				{col = 's2', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s1 = 'hello', a = {10,20,30,40}, s2 = 'world'})
		local r = db:find('t', '{s1 a s2}', 1)
		assert(r.s1 == 'hello', S(r.s1))
		assert(r.s2 == 'world', S(r.s2))
		assert(valeq(r.a, {10,20,30,40}), S(r.a))
		db:commit()
	end)
end

--variable-size (non-utf8) array value: round-trip, empty, and max-len.
function test.varsize_array_value()
	with_db('varsize_array_value', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'a' , mdbx_type = 'u16', maxlen = 4},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, a = {100, 200, 300}})
		db:insert('t', '{}', {id = 2, a = {}})
		db:insert('t', '{}', {id = 3, a = {1,2,3,4}})
		assert(valeq(db:find('t', 'a', 1), {100,200,300}), S(db:find('t','a',1)))
		assert(valeq(db:find('t', 'a', 2), {}), S(db:find('t','a',2)))
		assert(valeq(db:find('t', 'a', 3), {1,2,3,4}), S(db:find('t','a',3)))
		db:commit()
	end)
end

--nullable scalar value: null and non-null + is_null().
function test.nullable_scalar_value()
	with_db('nullable_scalar_value', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'num', mdbx_type = 'i32'},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, num = -7})
		db:insert('t', '{}', {id = 2, num = nil})
		assert(db:find('t', 'num', 1) == -7)
		assert(db:is_null('t', 'num', 1) == false)
		assert(db:find('t', 'num', 2) == nil)
		assert(db:is_null('t', 'num', 2) == true)
		db:commit()
	end)
end

--fixed scalar + several varsize vals with interleaved nulls: exercises the
--dynamic-offset chain when some dyn-offset values are null.
function test.mixed_layout_nulls()
	with_db('mixed_layout_nulls', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'num', mdbx_type = 'i16'},
				{col = 's1' , mdbx_type = 'utf8', maxlen = 16},
				{col = 's2' , mdbx_type = 'utf8', maxlen = 16},
				{col = 's3' , mdbx_type = 'utf8', maxlen = 16},
			},
			pk = {'id'},
		})
		local rows = {
			{id=1, num=5  , s1='aa' , s2='bb' , s3='cc' },
			{id=2, num=nil, s1='a'  , s2=nil  , s3='ccc'},
			{id=3, num=9  , s1=nil  , s2='bbb', s3=nil  },
			{id=4, num=nil, s1=nil  , s2=nil  , s3=nil  },
		}
		for _,r in ipairs(rows) do db:insert('t', '{}', r) end
		for _,r in ipairs(rows) do
			local g = db:find('t', '{num s1 s2 s3}', r.id)
			for _,col in ipairs{'num','s1','s2','s3'} do
				assertf(valeq(g[col], r[col]), 'id=%d %s: %s ~= %s',
					r.id, col, S(g[col]), S(r[col]))
			end
		end
		db:commit()
	end)
end

--table with no val fields (only pk): insert/exists/each must work.
function test.only_pk_table()
	with_db('only_pk_table', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1})
		db:insert('t', '{}', {id = 2})
		assert(db:exists('t', 1))
		assert(not db:exists('t', 3))
		local n = 0
		for cur, id in db:each('t') do n = n + 1; assert(id == n) end
		assert(n == 2)
		db:commit()
	end)
end

--table with a single varsize val field: exercises schema_val_add_start where
--the first (and only) val col must be at a fixed offset.
function test.single_varsize_value()
	with_db('single_varsize_value', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 32},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s = ''})
		db:insert('t', '{}', {id = 2, s = 'hi'})
		assert(db:find('t', 's', 1) == '')
		assert(db:find('t', 's', 2) == 'hi')
		db:commit()
	end)
end

--field validation errors raise structured field errors.
function test.truncation_errors()
	with_db('truncation_errors', function(db)
		db:begin'w'
		local function check_err(err, event, tab, col, msg)
			assert(iserror(err, 'field'), tostring(err))
			assert(err.event == event, tostring(err.event))
			assert(err.table == tab, tostring(err.table))
			assert(err.col == col, tostring(err.col))
			assert(err.message == msg, tostring(err.message))
		end
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 4},
			},
			pk = {'id'},
		})
		local ok, err = try_mutation(db, db.insert,
			't', '{}', {id = 1, s = 'abcdefgh'})
		assert(not ok)
		check_err(err, 'insert', 't', 's', 'too_long')

		db:create_table('tk', {
			name = 'tk',
			fields = {
				{col = 'k', mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
				{col = 'v', mdbx_type = 'utf8', maxlen = 4},
			},
			pk = {'k'},
		})
		ok, err = try_mutation(db, db.insert,
			'tk', '{}', {k = 'abcde', v = 'x'})
		assert(not ok)
		check_err(err, 'insert', 'tk', 'k', 'too_long')
		db:insert('tk', '{}', {k = 'abcd', v = 'x'})
		ok, err = try_mutation(db, db.find, 'tk', 'v', 'abcde')
		assert(not ok)
		check_err(err, 'get', 'tk', 'k', 'too_long')

		ok, err = try_mutation(db, db.insert, 'tk', '{}', {v = 'x'})
		assert(not ok)
		check_err(err, 'insert', 'tk', 'k', 'null_key')

		db:create_table('tv', {
			name = 'tv',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'utf8', maxlen = 4, not_null = true},
			},
			pk = {'id'},
		})
		ok, err = try_mutation(db, db.insert, 'tv', '{}', {id = 1})
		assert(not ok)
		check_err(err, 'insert', 'tv', 'v', 'not_null')
		db:commit()
	end)
end

--unwrapped row and field failures abort the current transaction before raising.
function test.direct_mutation_errors_abort_transaction()
	with_db('direct_mutation_errors_abort_transaction', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
			{col = 'v' , mdbx_type = 'utf8', maxlen = 4},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 'one', v = '1'})
		db:commit()

		db:begin'w'
		db:insert('t', '{}', {id = 'two', v = '2'})
		local ok, err = catch('row', db.insert, db,
			't', '{}', {id = 'one', v = 'x'})
		assert(not ok)
		check_row_error(err, 'insert', 't', 'already_exists')
		assert(err.target == db)
		assert(db.txn == nil)

		db:begin'r'
		assert(not db:exists('t', 'two'))
		db:commit()

		db:begin'w'
		db:insert('t', '{}', {id = 'two', v = '2'})
		ok, err = catch('field', db.insert, db,
			't', '{}', {id = 'bad', v = 'too long'})
		assert(not ok and iserror(err, 'field'), tostring(err))
		assert(db.txn == nil)

		db:begin'r'
		assert(not db:exists('t', 'two'))
		ok, err = catch('field', db.find, db, 't', 'v', 'oversize')
		assert(not ok and iserror(err, 'field'), tostring(err))
		assert(db.txn == nil)
	end)
end

--nozero is a persisted field contract; declared fields reject zero elements.
function test.nozero_field()
	with_db_reopen('nozero_field', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32' , not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 8, nozero = true},
				{col = 'a' , mdbx_type = 'u8'  , maxlen = 4, nozero = true},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s = 'abc', a = {1,2,3}})
		db:commit()
	end, function(db)
		db:begin'w'
		local function check_err(err, event, col, msg)
			assert(iserror(err, 'field'), tostring(err))
			assert(err.event == event, tostring(err.event))
			assert(err.table == 't', tostring(err.table))
			assert(err.col == col, tostring(err.col))
			assert(err.message == msg, tostring(err.message))
		end
		local r = db:find('t', '{s a}', 1)
		assert(r.s == 'abc', S(r.s))
		assert(valeq(r.a, {1,2,3}), S(r.a))

		local ok, err = try_mutation(db, db.insert,
			't', '{}', {id = 2, s = 'a\0b', a = {1,2}})
		assert(not ok)
		check_err(err, 'insert', 's', 'zero')

		ok, err = try_mutation(db, db.insert,
			't', '{}', {id = 3, s = 'abc', a = {1,0,2}})
		assert(not ok)
		check_err(err, 'insert', 'a', 'zero')

		db:commit()
	end)
end

--create + reopen so the schema is reconstructed from $schema (loaded path),
--then read back fixed, padded and varsize values.
function test.reopen_roundtrip()
	with_db_reopen('reopen_roundtrip', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'num', mdbx_type = 'i32'},
				{col = 'a'  , mdbx_type = 'u8'  , maxlen = 3, padded = true},
				{col = 's'  , mdbx_type = 'utf8', maxlen = 16},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, num = -3, a = {7,8,9}, s = 'hello'})
		db:commit()
	end, function(db)
		db:begin'r'
		local r = db:find('t', '{num a s}', 1)
		assert(r.num == -3, S(r.num))
		assert(valeq(r.a, {7,8,9}), S(r.a))
		assert(r.s == 'hello', S(r.s))
		db:commit()
	end)
end

-- composite key ordering ----------------------------------------------------

--composite fixed-size key (signed primary + unsigned secondary), all asc/desc
--combos: exercises sign-flip, byte-swap, per-field descending invert and
--field ordering in concatenated fixed keys.
function test.composite_fixed_keys()
	with_db('composite_fixed_keys', function(db)
		db:begin'w'
		for oa in words'asc desc' do
		for ob in words'asc desc' do
			local name = ('cfk:%s:%s'):format(oa, ob)
			local da, db_ = oa == 'desc', ob == 'desc'
			db:create_table(name, {
				name = name,
				fields = {
					{col = 'a', mdbx_type = 'i32', not_null = true},
					{col = 'b', mdbx_type = 'u16', not_null = true},
				},
				pk = {'a', 'b', desc = {da, db_}},
			})
			local rows = {{-2,1}, {-2,7}, {3,1}, {3,2}, {0,5}, {-2,0}}
			db:put_records(name, '[a b]', rows)
			local exp = extend({}, rows)
			sort(exp, function(r1, r2)
				local c1; if da  then c1 = r2[1] < r1[1] else c1 = r1[1] < r2[1] end
				local c2; if db_ then c2 = r2[2] < r1[2] else c2 = r1[2] < r2[2] end
				if r1[1] == r2[1] then return c2 else return c1 end
			end)
			local i = 0
			for cur, a, b in db:each(name) do
				i = i + 1
				assertf(num(a) == exp[i][1] and num(b) == exp[i][2],
					'%s row %d: (%s,%s) ~= (%s,%s)', name, i,
					S(a), S(b), S(exp[i][1]), S(exp[i][2]))
			end
			assertf(i == #rows, '%s: count %d ~= %d', name, i, #rows)
		end
		end
		db:commit()
	end)
end

--composite mixed fixed+varsize key (u32 then utf8): fixed field at a fixed
--offset, varsize field 0-terminated after it; ordering is (a, b) lexicographic.
function test.composite_mixed_keys()
	with_db('composite_mixed_keys', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'a', mdbx_type = 'u32' , not_null = true},
				{col = 'b', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
				{col = 'v', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'a', 'b'},
		})
		local rows = {
			{a=2, b='b' , v='2b' },
			{a=1, b='bb', v='1bb'},
			{a=1, b='a' , v='1a' },
			{a=2, b='a' , v='2a' },
			{a=1, b='aa', v='1aa'},
		}
		for _,r in ipairs(rows) do db:insert('t', '{}', r) end
		local exp = {{1,'a'}, {1,'aa'}, {1,'bb'}, {2,'a'}, {2,'b'}}
		local i = 0
		for cur, a, b, v in db:each('t') do
			i = i + 1
			assertf(num(a) == exp[i][1] and b == exp[i][2],
				'row %d: (%s,%s)', i, S(a), S(b))
		end
		assert(i == #rows)
		assert(db:find('t', 'v', 1, 'aa') == '1aa')
		db:commit()
	end)
end

--varsize keys must be declared nozero, so embedded \0 errors instead of
--truncating to a different key.
function test.key_embedded_zero_error()
	with_db('key_embedded_zero_error', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'k', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
				{col = 'v', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'k'},
		})
		local ok, err = try_mutation(db, db.insert,
			't', '{}', {k = 'a\0b', v = 'first'})
		assert(not ok)
		assert(iserror(err, 'field'), tostring(err))
		assert(err.event == 'insert' and err.table == 't' and err.col == 'k'
			and err.message == 'zero', tostring(err))
		ok, err = try_mutation(db, db.find, 't', 'v', 'a\0c')
		assert(not ok)
		assert(iserror(err, 'field'), tostring(err))
		assert(err.event == 'get' and err.table == 't' and err.col == 'k'
			and err.message == 'zero', tostring(err))
		local n = 0
		for cur, k in db:each('t') do n = n + 1 end
		assert(n == 0)
		db:commit()
	end)
end

--padded fixed-size array as a key field: round-trip, ordering, and reopen.
function test.padded_array_key()
	with_db_reopen('padded_array_key', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'a', mdbx_type = 'u8', maxlen = 4, padded = true, not_null = true},
				{col = 'v', mdbx_type = 'u32'},
			},
			pk = {'a'},
		})
		db:insert('t', '{}', {a = {1,2,3,4}, v = 10})
		db:insert('t', '{}', {a = {1,0,0,0}, v = 20})
		db:insert('t', '{}', {a = {1,2,0,0}, v = 30})
		db:commit()
	end, function(db)
		db:begin'r'
		assert(num(db:find('t', 'v', {1,2,3,4})) == 10)
		assert(num(db:find('t', 'v', {1,0,0,0})) == 20)
		assert(num(db:find('t', 'v', {1,2,0,0})) == 30)
		local exp = {{1,0,0,0}, {1,2,0,0}, {1,2,3,4}}
		local i = 0
		for cur, a, v in db:each('t') do
			i = i + 1
			assert(valeq(a, exp[i]), S(a)..' ~= '..S(exp[i]))
		end
		assert(i == 3)
		db:commit()
	end)
end

--composite key with a u16 padded array + scalar, asc and desc: exercises
--byte-swap encoding on multi-byte padded array key fields.
function test.padded_array_key_composite()
	with_db('padded_array_key_composite', function(db)
		db:begin'w'
		for order in words'asc desc' do
			local name = 'pk2:'..order
			local desc = order == 'desc'
			db:create_table(name, {
				name = name,
				fields = {
					{col = 'a', mdbx_type = 'u16', maxlen = 2, padded = true, not_null = true},
					{col = 'b', mdbx_type = 'u32', not_null = true},
					{col = 'v', mdbx_type = 'u32'},
				},
				pk = {'a', 'b', desc = {desc, false}},
			})
			local rows = {
				{a = {1,0}, b = 1, v = 10},
				{a = {1,2}, b = 1, v = 20},
				{a = {1,0}, b = 5, v = 30},
				{a = {2,0}, b = 1, v = 40},
			}
			for _, r in ipairs(rows) do
				db:insert(name, '{}', r)
			end
			local exp
			if not desc then
				exp = {
					{{1,0}, 1, 10},
					{{1,0}, 5, 30},
					{{1,2}, 1, 20},
					{{2,0}, 1, 40},
				}
			else
				exp = {
					{{2,0}, 1, 40},
					{{1,2}, 1, 20},
					{{1,0}, 1, 10},
					{{1,0}, 5, 30},
				}
			end
			local i = 0
			for cur, a, b, v in db:each(name) do
				i = i + 1
				assert(valeq(a, exp[i][1]), name..' a['..i..']: '..S(a)..' ~= '..S(exp[i][1]))
				assert(num(b) == exp[i][2], name..' b['..i..']: '..S(b)..' ~= '..S(exp[i][2]))
			end
			assert(i == #exp, name..' count: '..i..' ~= '..#exp)
			--point lookup through composite key
			local r = db:find(name, 'v', {1,2}, 1)
			assert(num(r) == 20, S(r))
		end
		db:commit()
	end)
end

function test.ai_ci_collation()
	local file = test_file('ai_ci_collation'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		--ai_ci unique index: case/accent collision is rejected.
		db:create_table('u', {name = 'u', fields = {
			{col = 'id'   , mdbx_type = 'u32', not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 32, nozero = true, not_null = true,
				mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('u', {'email', is_unique = true})
		db:insert('u', '{}', {id = 1, email = 'José@x'})
		assert(try_mutation(db, db.insert, 'u', '{}', {id = 2, email = 'JOSE@X'}) == false) --folds equal
		assert(num((db:must_find('u/email', '{}', 'jose@x')).id) == 1) --ai_ci index lookup
		db:commit(); db:close()
		--persists across reopen: ai_ci index folding still works.
		db = mdbx_open(file); db:begin'w'
		assert(try_mutation(db, db.insert, 'u', '{}', {id = 3, email = 'JOSÉ@X'}) == false) --folds equal
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

-- update / upsert -----------------------------------------------------------

--update of an existing row: partial updates preserve unlisted cols, multiple
--cols map by name (not by given position), null sets null vs nil skips, and a
--missing row returns false,'not_found'. upsert inserts when missing.
function test.update_and_upsert()
	with_db('update_and_upsert', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'a' , mdbx_type = 'i32'},
				{col = 'b' , mdbx_type = 'utf8', maxlen = 8},
				{col = 'c' , mdbx_type = 'u16'},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, a = 10, b = 'x', c = 5})

		--partial update preserves unlisted cols
		db:update('t', '{}', {id = 1, a = 20})
		local g = db:find('t', '{a b c}', 1)
		assert(num(g.a) == 20 and g.b == 'x' and num(g.c) == 5,
			('%s,%s,%s'):format(S(g.a), S(g.b), S(g.c)))

		--update multiple cols (name mapping must be correct, not positional)
		db:update('t', '{}', {id = 1, b = 'y', c = 9})
		g = db:find('t', '{a b c}', 1)
		assert(num(g.a) == 20 and g.b == 'y' and num(g.c) == 9)

		--null sets a value to null; nil would skip
		db:update('t', '{}', {id = 1, a = null})
		assert(db:find('t', 'a', 1) == nil)
		assert(db:is_null('t', 'a', 1) == true)
		g = db:find('t', '{b c}', 1)
		assert(g.b == 'y' and num(g.c) == 9) --others preserved

		--update a missing row -> false,'not_found'
		local ok, err = try_mutation(db, db.update, 't', '{}', {id = 2, a = 1})
		assert(not ok)
		check_row_error(err, 'update', 't', 'not_found')

		--upsert inserts when missing
		db:upsert('t', '{}', {id = 2, a = 7, b = 'u', c = 1})
		g = db:find('t', '{a b c}', 2)
		assert(num(g.a) == 7 and g.b == 'u' and num(g.c) == 1)

		--upsert updates when existing (partial preserve)
		db:upsert('t', '{}', {id = 2, b = 'uu'})
		g = db:find('t', '{a b c}', 2)
		assert(num(g.a) == 7 and g.b == 'uu' and num(g.c) == 1)

		db:commit()
	end)
end

-- delete --------------------------------------------------------------------

--del removes a row by pk, leaving others intact; deleting a missing row is a
--successful no-op.
function test.delete()
	with_db('delete', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, v = 'a'})
		db:insert('t', '{}', {id = 2, v = 'b'})
		db:insert('t', '{}', {id = 3, v = 'c'})
		assert(db:del('t', 2) == true)
		assert(not db:exists('t', 2))
		assert(db:exists('t', 1) and db:exists('t', 3))
		assert(db:find('t', 'v', 2) == nil)
		local ids = {}
		for cur, id in db:each('t') do add(ids, num(id)) end
		assert(#ids == 2 and ids[1] == 1 and ids[2] == 3)
		assert(db:del('t', 2) == false)
		db:commit()

		db:begin'w'
		local ok, err = catch('schema', db.del, db, 'missing', 1)
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.event == 't_open' and err.table == 'missing', tostring(err))
		assert(err.message == 'not_found', tostring(err.message))
		assert(not db.txn)
	end)
end

-- cursors -------------------------------------------------------------------

--reverse iteration must honor the requested val_cols (regression: the reverse
--iterators didn't set cur.val_cols, so they ignored it).
function test.each_reverse_val_cols()
	with_db('each_reverse_val_cols', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'a' , mdbx_type = 'i32'},
				{col = 'b' , mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, a = 10, b = 'x'})
		db:insert('t', '{}', {id = 2, a = 20, b = 'y'})
		db:insert('t', '{}', {id = 3, a = 30, b = 'z'})
		--each_reverse returns key cols + requested val cols: (cur, id, b)
		local got = {}
		for cur, id, b in db:each_reverse('t', 'b') do add(got, b) end
		assert(#got == 3 and got[1] == 'z' and got[2] == 'y' and got[3] == 'x',
			cat(imap(got, tostring), ','))
		db:commit()
	end)
end

--cursor positioned then updated; update returns true on success and writes.
function test.cursor_update()
	with_db('cursor_update', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'a' , mdbx_type = 'i32'},
				{col = 'b' , mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, a = 10, b = 'x'})
		db:insert('t', '{}', {id = 2, a = 20, b = 'y'})
		--full update (all val cols)
		local cur = db:cursor('t', 'w')
		assert(cur:try_find(nil, 2)) --position on id=2
		assert(cur:update('{a b}', {a = 99, b = 'YY'}) == true)
		cur:close()
		local g = db:find('t', '{a b}', 2)
		assert(num(g.a) == 99 and g.b == 'YY', ('%s,%s'):format(S(g.a), S(g.b)))
		--partial update preserves the unlisted col
		cur = db:cursor('t', 'w')
		assert(cur:try_find(nil, 1)) --position on id=1
		assert(cur:update('b', 'ZZ') == true)
		cur:close()
		g = db:find('t', '{a b}', 1)
		assert(num(g.a) == 10 and g.b == 'ZZ', ('%s,%s'):format(S(g.a), S(g.b)))
		db:commit()
	end)
end

function test.update_shrinking_varsize_preserves_key()
	with_db_reopen('update_shrinking_varsize_preserves_key', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 's' , mdbx_type = 'utf8', maxlen = 8},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, s = 'aa'})
		db:insert('t', '{}', {id = 2, s = 'aa'})
		db:update('t', '{}', {id = 1, s = 'b'})
		local cur = db:cursor('t', 'w')
		assert(cur:try_find(nil, 2))
		assert(cur:update('s', 'b'))
		cur:close()
		db:commit()
	end, function(db)
		db:begin'r'
		assert(db:find('t', 's', 1) == 'b')
		assert(db:find('t', 's', 2) == 'b')
		assert(not db:exists('t', 4))
		db:commit()
	end)
end

-- schema validation ---------------------------------------------------------

--a stored schema validated against a matching paper schema passes; an explicit
--open with a diverging schema aborts its transaction and raises `schema`.
function test.validate_schema()
	local file = test_file('validate_schema')
	cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'i32'},
			},
			pk = {'id'},
		})
		db:commit(); db:close()

		--matching paper schema -> validates ok
		db = mdbx_open(file)
		db.schema = {tables = {}}
		db.schema.tables.t = {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'i32'},
			},
			pk = {'id'},
		}
		db:begin()
		assert(db:dbi_schema('t'))
		db:commit(); db:close()

		--an existing raw table cannot be adopted by supplying a paper schema.
		db = mdbx_open(file)
		db:begin'w'
		db:create_table_raw('raw', 0)
		db:commit(); db:close()

		db = mdbx_open(file)
		db.schema = {tables = {}}
		db.schema.tables.raw = {
			name = 'raw',
			fields = {
				{col = 'id', mdbx_type = 'utf8', maxlen = 8,
					nozero = true, not_null = true},
			},
			pk = {'id'},
		}
		db:begin()
		local ok, e = catch('schema', db.dbi_schema, db, 'raw')
		assert(not ok and iserror(e, 'schema'), tostring(e))
		assert(e.event == 't_open' and e.table == 'raw', tostring(e))
		assert(e.message == 'trying to open a raw table with a schema', tostring(e.message))
		assert(db.txn == nil)
		db:close()

		--diverging paper schema (v: i32 -> utf8) -> schema error + abort
		db = mdbx_open(file)
		db.schema = {tables = {}}
		db.schema.tables.t = {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		}
		db:begin()
		ok, e = catch('schema', db.dbi_schema, db, 't')
		assert(not ok and iserror(e, 'schema'), tostring(e))
		assert(e.event == 't_open' and e.table == 't', tostring(e))
		assert(e.message:find('schema mismatch', 1, true), tostring(e.message))
		assert(db.txn == nil)
		db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
end

-- keyability rules ----------------------------------------------------------

function test.keyability_rules()
	with_db('keyability_rules', function(db)
		db:begin'w'
		local ok, err = pcall(function()
			db:create_table('bad_pk', {
				name = 'bad_pk',
				fields = {
					{col = 's', mdbx_type = 'utf8', maxlen = 8, not_null = true},
				},
				pk = {'s'},
			})
		end)
		assert(not ok)
		assert(tostring(err):find('varsize key col must be nozero', 1, true), tostring(err))

		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32' , not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 8},
				{col = 'nz', mdbx_type = 'utf8', maxlen = 8, nozero = true},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s = 'a', nz = 'a'})
		db:insert('t', '{}', {id = 2, s = 'b', nz = 'b'})

		ok, err = try_schema(db, db.add_index, 't', {'s'})
		assert(not ok)
		assert(iserror(err, 'schema'), tostring(err))
		assert(err.message:find('varsize key col must be nozero', 1, true), tostring(err))

		ok, err = try_schema(db, db.add_index, 't', {'nz', is_unique = true})
		assert(not ok)
		assert(iserror(err, 'schema'), tostring(err))
		assert(err.message:find('unique index', 1, true), tostring(err))
		assert(err.message:find('must be not_null', 1, true), tostring(err))

		ok, err = db:add_index('t', {'nz'})
		assert(ok, tostring(err))
		db:commit()
	end)
end

-- indexes -------------------------------------------------------------------

--unique index: dup detection on create, dup insert rejected, lookup through
--the index, delete frees the key, drop allows dups again.
function test.unique_index()
	with_db('unique_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
				{col = 'name' , mdbx_type = 'utf8', maxlen = 16},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, email = 'a@x', name = 'A'})
		db:insert('t', '{}', {id = 2, email = 'b@x', name = 'B'})
		db:insert('t', '{}', {id = 3, email = 'a@x', name = 'C'}) --dup email of id 1

		--adding a unique index fails while a duplicate exists
		local ix_tbl = 't/email'
		local ok, err = try_schema(db, db.add_index,
			't', {'email', is_unique = true})
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.message == 'duplicate_key', tostring(err.message))
		assert(not db:table_exists(ix_tbl))

		--remove the dup, then it builds
		db:del('t', 3)
		assert(db:add_index('t', {'email', is_unique = true}))
		assert(db:table_exists(ix_tbl))

		--inserting a row with an existing email now fails (and rolls back)
		assert(try_mutation(db, db.insert, 't', '{}', {id = 4, email = 'a@x', name = 'D'}) == false)
		assert(not db:exists('t', 4))

		--lookup through the index
		local r = db:must_find(ix_tbl, '{}', 'b@x')
		assert(num(r.id) == 2 and r.name == 'B', S(r.name))

		--delete frees the unique index key (reinsert with same email works)
		db:del('t', 1)
		assert(try_mutation(db, db.insert, 't', '{}', {id = 5, email = 'a@x', name = 'E'}))

		--drop the index: duplicates allowed again
		db:drop_index(ix_tbl)
		assert(try_mutation(db, db.insert, 't', '{}', {id = 6, email = 'a@x', name = 'F'}))
		db:commit()
	end)
end

function test.drop_last_index_clears_index_state()
	with_db_reopen('drop_last_index_clears_index_state', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'u32'},
			},
			pk = {'id'},
		})
		local _, _, ix = db:add_index('t', {'v'})
		db:drop_index(ix)
		local _, schema = db:dbi_schema't'
		assert(not schema.ixs and not schema.indexes)
		db:commit()
	end, function(db)
		db:begin'r'
		local _, schema = db:dbi_schema't'
		assert(not schema.ixs and not schema.indexes)
		db:commit()
	end)
end

--non-unique (DUPSORT) index: multiple rows per index key, iteration walks all
--of them in (key, pk) order, and delete removes only the deleted row's entry.
function test.non_unique_index()
	with_db('non_unique_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'  , mdbx_type = 'u32' , not_null = true},
				{col = 'cat' , mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
				{col = 'name', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, cat = 'a', name = 'one'})
		db:insert('t', '{}', {id = 2, cat = 'a', name = 'two'})
		db:insert('t', '{}', {id = 3, cat = 'b', name = 'three'})
		db:insert('t', '{}', {id = 4, cat = 'a', name = 'four'})

		local ok, err, ix_tbl = db:add_index('t', {'cat'})
		assert(ok, S(err))

		--iterate: cat 'a' rows (ids 1,2,4) then cat 'b' (id 3)
		local names = {}
		for cur, t in db:each(ix_tbl, '{}') do add(names, t.name) end
		assert(#names == 4 and names[1] == 'one' and names[2] == 'two'
			and names[3] == 'four' and names[4] == 'three', cat(names, ','))

		--delete a row in cat 'a': only its index entry is removed
		db:del('t', 2)
		names = {}
		for cur, t in db:each(ix_tbl, '{}') do add(names, t.name) end
		assert(#names == 3 and names[1] == 'one' and names[2] == 'four'
			and names[3] == 'three', cat(names, ','))

		--update a row's indexed value: it moves index groups
		db:update('t', '{}', {id = 1, cat = 'b'})
		names = {}
		for cur, t in db:each(ix_tbl, '{}') do add(names, t.name) end
		--now cat 'a': id 4 (four); cat 'b': ids 1,3 (one, three)
		assert(#names == 3 and names[1] == 'four' and names[2] == 'one'
			and names[3] == 'three', cat(names, ','))
		db:commit()
	end)
end

--nullable non-unique indexes encode null as an ordered index key value and
--maintain entries across update/delete.
function test.nullable_non_unique_index()
	with_db('nullable_non_unique_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32' , not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 8, nozero = true},
				{col = 'n' , mdbx_type = 'i32'},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s = nil, n = nil})
		db:insert('t', '{}', {id = 2, s = 'b', n = 0})
		db:insert('t', '{}', {id = 3, s = '', n = -1})
		db:insert('t', '{}', {id = 4, s = nil, n = 5})

		local ok, err, ix_s = db:add_index('t', {'s'})
		assert(ok, tostring(err))
		local function ids(ix)
			local t = {}
			for cur, r in db:each(ix, '{}') do add(t, num(r.id)) end
			return t
		end
		assert(valeq(ids(ix_s), {1,4,3,2}), cat(ids(ix_s), ','))
		local r = db:must_find(ix_s, '{}', null)
		assert(num(r.id) == 1 and r.s == nil, S(r.id))
		r = db:must_find(ix_s, '{}', '')
		assert(num(r.id) == 3 and r.s == '', S(r.id))

		db:update('t', '{}', {id = 1, s = 'c'})
		assert(valeq(ids(ix_s), {4,3,2,1}), cat(ids(ix_s), ','))
		db:del('t', 4)
		assert(valeq(ids(ix_s), {3,2,1}), cat(ids(ix_s), ','))

		local _,_,ix_n = db:add_index('t', {'n'})
		assert(valeq(ids(ix_n), {1,3,2}), cat(ids(ix_n), ','))
		r = db:must_find(ix_n, '{}', null)
		assert(num(r.id) == 1 and r.n == nil, S(r.id))
		r = db:must_find(ix_n, '{}', -1)
		assert(num(r.id) == 3 and num(r.n) == -1, S(r.id))
		db:commit()
	end)
end

--composite nullable indexes must walk nullable key fields correctly, and
--descending nullable keys put nulls after non-null values.
function test.nullable_composite_index()
	with_db('nullable_composite_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32' , not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 8, nozero = true},
				{col = 'n' , mdbx_type = 'i32'},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s = nil, n = nil})
		db:insert('t', '{}', {id = 2, s = nil, n = 1})
		db:insert('t', '{}', {id = 3, s = '' , n = nil})
		db:insert('t', '{}', {id = 4, s = 'a', n = -1})
		db:insert('t', '{}', {id = 5, s = 'a', n = nil})

		local function ids(ix)
			local t = {}
			for cur, r in db:each(ix, '{}') do add(t, num(r.id)) end
			return t
		end

		local ok, err, ix = db:add_index('t', {'s', 'n'})
		assert(ok, tostring(err))
		assert(valeq(ids(ix), {1,2,3,5,4}), cat(ids(ix), ','))
		local r = db:must_find(ix, '{}', null, null)
		assert(num(r.id) == 1, S(r.id))
		r = db:must_find(ix, '{}', 'a', null)
		assert(num(r.id) == 5, S(r.id))

		ok, err, ix = db:add_index('t', {'s', desc = {true}})
		assert(ok, tostring(err))
		assert(valeq(ids(ix), {4,5,3,1,2}), cat(ids(ix), ','))
		r = db:must_find(ix, '{}', null)
		assert(num(r.id) == 1 and r.s == nil, S(r.id))
		db:commit()
	end)
end

--structured writes never create an internal transaction, including writes to
--uniquely indexed tables.
function test.structured_writes_have_no_internal_txn()
	with_db('structured_writes_have_no_internal_txn', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'cat'  , mdbx_type = 'utf8', maxlen = 8 , nozero = true, not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		local function count_begins(f)
			local n = 0
			local real = db.begin
			db.begin = function(self, ...) n = n + 1; return real(self, ...) end
			f()
			db.begin = nil
			return n
		end
		--no index
		assert(count_begins(function()
			db:insert('t', '{}', {id = 1, cat = 'a', email = 'a@x'}) end) == 0)
		--non-unique index
		db:add_index('t', {'cat'})
		assert(count_begins(function()
			db:insert('t', '{}', {id = 2, cat = 'a', email = 'b@x'}) end) == 0)
		--unique index
		db:add_index('t', {'email', is_unique = true})
		assert(count_begins(function()
			db:insert('t', '{}', {id = 3, cat = 'a', email = 'c@x'}) end) == 0)
		db:commit()
	end)
end

--a later unique-index failure rolls back the row and an earlier non-unique index
--update inside atomic(), and leaves the outer transaction usable.
function test.try_put_multi_index_rollback()
	with_db('try_put_multi_index_rollback', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'cat'  , mdbx_type = 'utf8', maxlen = 8 , nozero = true, not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		local _,_,ix_cat = db:add_index('t', {'cat'})
		local _,_,ix_email = db:add_index('t', {'email', is_unique = true})
		db:insert('t', '{}', {id = 1, cat = 'a', email = 'a@x'})
		db:insert('t', '{}', {id = 2, cat = 'b', email = 'b@x'})
		local outer_txn = db.txn

		local ok, err = try_mutation(db, db.update, 't', '{}', {id = 2, cat = 'c', email = 'a@x'})
		assert(not ok)
		check_row_error(err, 'update', 't', 'already_exists')
		assert(db.txn == outer_txn, 'failed atomic update changed the outer txn')
		local r = db:find('t', '{cat email}', 2)
		assert(r.cat == 'b' and r.email == 'b@x', ('%s,%s'):format(S(r.cat), S(r.email)))
		assert(not db:try_find(ix_cat, nil, 'c'))
		assert(num((db:must_find(ix_cat, '{}', 'b')).id) == 2)
		assert(num((db:must_find(ix_email, '{}', 'a@x')).id) == 1)
		assert(num((db:must_find(ix_email, '{}', 'b@x')).id) == 2)

		db:insert('t', '{}', {id = 3, cat = 'c', email = 'c@x'})
		assert(db.txn == outer_txn and db:exists('t', 3))
		db:commit()
	end)
end

--unique conflicts are atomic for update and both upsert branches (existing and
--new rows).
function test.try_put_unique_conflict_matrix()
	with_db('try_put_unique_conflict_matrix', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
				{col = 'name' , mdbx_type = 'utf8', maxlen = 16},
			},
			pk = {'id'},
		})
		local _,_,ix = db:add_index('t', {'email', is_unique = true})
		db:insert('t', '{}', {id = 1, email = 'a@x', name = 'A'})
		db:insert('t', '{}', {id = 2, email = 'b@x', name = 'B'})

		local function assert_unchanged()
			local r = db:find('t', '{email name}', 2)
			assert(r.email == 'b@x' and r.name == 'B', ('%s,%s'):format(S(r.email), S(r.name)))
			assert(num((db:must_find(ix, '{}', 'a@x')).id) == 1)
			assert(num((db:must_find(ix, '{}', 'b@x')).id) == 2)
		end

		local ok, err = try_mutation(db, db.update, 't', '{}', {id = 2, email = 'a@x', name = 'U'})
		assert(not ok)
		check_row_error(err, 'update', 't', 'already_exists')
		assert_unchanged()

		ok, err = try_mutation(db, db.upsert,
			't', '{}', {id = 2, email = 'a@x', name = 'UE'})
		assert(not ok)
		check_row_error(err, 'upsert', 't', 'already_exists')
		assert_unchanged()

		ok, err = try_mutation(db, db.upsert,
			't', '{}', {id = 3, email = 'a@x', name = 'UN'})
		assert(not ok and not db:exists('t', 3))
		check_row_error(err, 'upsert', 't', 'already_exists')
		assert_unchanged()
		db:commit()
	end)
end

--updating only a non-indexed value takes the unchanged-key path for every index:
--the row changes but no index record is deleted or inserted.
function test.try_put_unchanged_index_keys()
	with_db('try_put_unchanged_index_keys', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'cat'  , mdbx_type = 'utf8', maxlen = 8 , nozero = true, not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
				{col = 'name' , mdbx_type = 'utf8', maxlen = 16},
			},
			pk = {'id'},
		})
		local _,_,ix_cat = db:add_index('t', {'cat'})
		local _,_,ix_email = db:add_index('t', {'email', is_unique = true})
		db:insert('t', '{}', {id = 1, cat = 'a', email = 'a@x', name = 'A'})
		local cat_dbi = db:dbi_schema(ix_cat)
		local email_dbi = db:dbi_schema(ix_email)
		local index_writes = 0
		local try_del_raw = db.try_del_raw
		local try_put_raw = db.try_put_raw
		db.try_del_raw = function(self, tab, ...)
			if tab == cat_dbi or tab == email_dbi then index_writes = index_writes + 1 end
			return try_del_raw(self, tab, ...)
		end
		db.try_put_raw = function(self, tab, ...)
			if tab == cat_dbi or tab == email_dbi then index_writes = index_writes + 1 end
			return try_put_raw(self, tab, ...)
		end
		db:update('t', '{}', {id = 1, name = 'AA'})
		db.try_del_raw = nil
		db.try_put_raw = nil

		assert(index_writes == 0, index_writes)
		assert(db:find('t', 'name', 1) == 'AA')
		assert(num((db:must_find(ix_cat, '{}', 'a')).id) == 1)
		assert(num((db:must_find(ix_email, '{}', 'a@x')).id) == 1)
		db:commit()
	end)
end

--atomic() catches early failures on a uniquely indexed table and leaves the
--outer transaction and original row usable.
function test.try_put_slow_path_early_exits()
	with_db('try_put_slow_path_early_exits', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		db:add_index('t', {'email', is_unique = true})
		db:insert('t', '{}', {id = 1, email = 'a@x'})
		local outer_txn = db.txn

		local ok, err = try_mutation(db, db.insert, 't', '{}', {id = 1, email = 'b@x'})
		assert(not ok and db.txn == outer_txn)
		check_row_error(err, 'insert', 't', 'already_exists')
		assert(db:find('t', 'email', 1) == 'a@x')

		ok, err = try_mutation(db, db.update, 't', '{}', {id = 99, email = 'z@x'})
		assert(not ok and db.txn == outer_txn)
		check_row_error(err, 'update', 't', 'not_found')

		db:insert('t', '{}', {id = 2, email = 'b@x'})
		assert(db.txn == outer_txn and db:exists('t', 2))
		db:commit()
	end)
end

--update and both upsert branches accept scalar, positional-table, and
--named-table column formats with the corresponding merge semantics.
function test.try_put_cols_formats()
	with_db('try_put_cols_formats', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'k', mdbx_type = 'u32', not_null = true},
				{col = 'a', mdbx_type = 'u32'},
				{col = 'b', mdbx_type = 'u32'},
				{col = 'c', mdbx_type = 'u32'},
			},
			pk = {'k'},
		})
		local function assert_row(k, a, b, c)
			local r = db:find('t', '{a b c}', k)
			local function eq(v, n)
				return n == nil and v == nil or v ~= nil and num(v) == n
			end
			assert(eq(r.a, a) and eq(r.b, b) and eq(r.c, c),
				('%s: %s,%s,%s'):format(k, S(r.a), S(r.b), S(r.c)))
		end
		db:insert('t', '{}', {k = 1, a = 10, b = 11, c = 12})
		db:insert('t', '{}', {k = 2, a = 20, b = 21, c = 22})
		db:insert('t', '{}', {k = 3, a = 30, b = 31, c = 32})

		db:update('t', 'k a', 1, 101)
		db:update('t', '[k b]', {2, 202})
		db:update('t', '{k c}', {k = 3, c = 303})
		assert_row(1, 101, 11, 12)
		assert_row(2, 20, 202, 22)
		assert_row(3, 30, 31, 303)

		db:upsert('t', 'k b', 1, 102)
		db:upsert('t', '[k c]', {2, 203})
		db:upsert('t', '{k a}', {k = 3, a = 301})
		assert_row(1, 101, 102, 12)
		assert_row(2, 20, 202, 203)
		assert_row(3, 301, 31, 303)

		db:upsert('t', 'k a b c', 7, 701, 702, 703)
		db:upsert('t', '[k a b c]', {8, 801, 802, 803})
		db:upsert('t', '{}', {k = 9, a = 901, b = 902, c = 903})
		assert_row(7, 701, 702, 703)
		assert_row(8, 801, 802, 803)
		assert_row(9, 901, 902, 903)
		db:commit()
	end)
end

--cursor update of an indexed column must maintain the index (non-unique).
function test.cursor_update_maintains_index()
	with_db('cursor_update_maintains_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'  , mdbx_type = 'u32' , not_null = true},
				{col = 'cat' , mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
				{col = 'name', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, cat = 'a', name = 'one'})
		db:insert('t', '{}', {id = 2, cat = 'b', name = 'two'})
		local _,_,ix = db:add_index('t', {'cat'})
		local cur = db:cursor('t', 'w')
		assert(cur:try_find(nil, 1))
		assert(cur:update('cat', 'b')) --move id 1 from cat 'a' to cat 'b'
		cur:close()
		local names = {}
		for c, t in db:each(ix, '{}') do add(names, t.name) end
		assert(#names == 2 and names[1] == 'one' and names[2] == 'two', cat(names, ','))
		db:commit()
	end)
end

function test.cursor_is_null()
	with_db('cursor_is_null', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'  , mdbx_type = 'u32' , not_null = true},
				{col = 'tag' , mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
				{col = 'note', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, tag = 'a', note = null})
		db:insert('t', '{}', {id = 2, tag = 'b', note = 'two'})
		local _,_,ix = db:add_index('t', {'tag'})

		local cur = db:cursor('t')
		local is_null, err = cur:is_null'note'
		assert(is_null and err == 'not_found')
		assert(cur:try_find(nil, 1))
		assert(cur:is_null'note')
		assert(cur:try_find(nil, 2))
		assert(not cur:is_null'note')
		cur:close()

		cur = db:cursor(ix)
		assert(cur:first())
		assert(cur:is_null'note')
		assert(cur:next())
		assert(not cur:is_null'note')
		cur:close()

		assert(db:is_null(ix, 'note', 'a'))
		assert(not db:is_null(ix, 'note', 'b'))
		local is_null, err = db:is_null(ix, 'note', 'missing')
		assert(is_null and err == 'not_found')
		db:commit()
	end)
end

function test.cursor_update_through_index()
	with_db('cursor_update_through_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'  , mdbx_type = 'u32' , not_null = true},
				{col = 'cat' , mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
				{col = 'name', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, cat = 'a', name = 'one'})
		db:insert('t', '{}', {id = 2, cat = 'b', name = 'two'})
		local _,_,ix = db:add_index('t', {'cat'})
		local _,_,ux = db:add_index('t', {'name', is_unique = true})

		local cur = db:cursor(ix)
		local id = cur:first()
		assert(num(id) == 1)
		assert(cur:update('name', 'uno'))
		assert(cur:update('cat', 'c'))
		local rec = cur:current('{}')
		assert(num(rec.id) == 1 and rec.cat == 'c')
		cur:close()

		assert(db:find('t', 'name', 1) == 'uno')
		assert(db:find('t', 'cat', 1) == 'c')
		assert(not db:try_find(ix, nil, 'a'))
		assert(num(db:must_find(ix, '{}', 'c').id) == 1)

		cur = db:cursor(ux)
		assert(cur:try_find(nil, 'two'))
		assert(cur:update('name', 'dos'))
		rec = cur:current('{}')
		assert(num(rec.id) == 2 and rec.name == 'dos')
		cur:close()
		assert(not db:try_find(ux, nil, 'two'))
		assert(num(db:must_find(ux, '{}', 'dos').id) == 2)

		local ok, err = catch('row field', db.atomic, db, 'w', function()
			local cur = db:cursor(ux)
			assert(cur:try_find(nil, 'dos'))
			cur:update('name', 'uno')
		end)
		assert(not ok)
		check_row_error(err, 'c_update', 't', 'already_exists')
		assert(db:find('t', 'name', 2) == 'dos')
		db:commit()
	end)
end

--cursor updates maintain unique indexes, and atomic() rolls back a conflict
--detected after the base row was changed.
function test.cursor_update_unique_index()
	with_db('cursor_update_unique_index', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, email = 'a@x'})
		db:insert('t', '{}', {id = 2, email = 'b@x'})
		local _,_,ix = db:add_index('t', {'email', is_unique = true})
		local cur = db:cursor('t', 'w')
		assert(cur:try_find(nil, 1))
		assert(cur:update('email', 'c@x'))
		cur:close()
		assert(num(db:must_find(ix, '{}', 'c@x').id) == 1)
		assert(not db:try_find(ix, nil, 'a@x')) --old index key gone

		local ok, err = catch('row field', db.atomic, db, 'w', function()
			local cur = db:cursor('t', 'w')
			assert(cur:try_find(nil, 2))
			cur:update('email', 'c@x')
		end)
		assert(not ok)
		check_row_error(err, 'c_update', 't', 'already_exists')
		assert(db:find('t', 'email', 2) == 'b@x')
		assert(num(db:must_find(ix, '{}', 'c@x').id) == 1)
		assert(num(db:must_find(ix, '{}', 'b@x').id) == 2)

		ok, err = catch('row field', db.atomic, db, 'w', function()
			db:cursor('t', 'w'):update('email', 'd@x')
		end)
		assert(not ok)
		check_row_error(err, 'c_update', 't', 'not_found')
		db:commit()
	end)
end

--updating an indexed column for every row mid-iteration: the iterating cursor
--must survive the per-row delegated writes and the index must end consistent.
function test.cursor_update_during_iteration()
	with_db('cursor_update_during_iteration', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32' , not_null = true},
				{col = 'tag', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		for i = 1, 4 do db:insert('t', '{}', {id = i, tag = 'a'}) end
		local _,_,ix = db:add_index('t', {'tag'})
		for cur, id in db:each('t') do
			cur:update('tag', 'b'..num(id))
		end
		local tags = {}
		for cur, t in db:each('t', '{tag}') do add(tags, t.tag) end
		assert(#tags == 4 and tags[1] == 'b1' and tags[2] == 'b2'
			and tags[3] == 'b3' and tags[4] == 'b4', cat(tags, ','))
		local n = 0
		for cur, t in db:each(ix, '{}') do n = n + 1 end
		assert(n == 4, n)
		db:commit()
	end)
end

function test.cursor_delete_maintains_indexes()
	with_db('cursor_delete_maintains_indexes', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32' , not_null = true},
				{col = 'tag', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, tag = 'a'})
		db:insert('t', '{}', {id = 2, tag = 'a'})
		db:insert('t', '{}', {id = 3, tag = 'b'})
		local _,_,ix = db:add_index('t', {'tag'})

		local cur = db:cursor('t')
		assert(cur:try_find(nil, 3))
		cur:del()
		cur:close()
		assert(not db:exists('t', 3))
		assert(not db:try_find(ix, nil, 'b'))

		cur = db:cursor(ix)
		local id = cur:first()
		assert(num(id) == 1, id)
		cur:del()
		cur:close()
		assert(not db:exists('t', 1))
		assert(num(db:must_find(ix, '{}', 'a').id) == 2)

		local ok, err = catch('row field', db.atomic, db, 'w', function()
			db:cursor('t'):del()
		end)
		assert(not ok)
		check_row_error(err, 'c_del', 't', 'not_found')
		db:commit()
	end)
end

function test.cursor_delete_during_iteration()
	with_db('cursor_delete_during_iteration', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32' , not_null = true},
				{col = 'tag', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		for i = 1, 4 do db:insert('t', '{}', {id = i, tag = 'a'}) end
		local _,_,ix = db:add_index('t', {'tag'})

		local n = 0
		for cur in db:each('t') do
			assert(cur:del())
			n = n + 1
		end
		assert(n == 4, n)
		assert(not db:try_find(ix, nil, 'a'))

		for i = 1, 4 do db:insert('t', '{}', {id = i, tag = 'a'}) end
		n = 0
		for cur in db:each(ix) do
			assert(cur:del())
			n = n + 1
		end
		assert(n == 4, n)
		for i = 1, 4 do assert(not db:exists('t', i)) end
		db:commit()
	end)
end

function test.cursor_delete_enforces_fks()
	with_db('cursor_delete_enforces_fks', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})

		local ok, err = catch('row field', db.atomic, db, 'w', function()
			local cur = db:cursor('parent')
			assert(cur:try_find(nil, 1))
			cur:del()
		end)
		assert(not ok)
		check_row_error(err, 'del', 'parent')
		assert(db:exists('parent', 1))
		assert(db:exists('child', 10))
		db:commit()
	end)
end

function test.delete_through_indexes()
	with_db('delete_through_indexes', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id'   , mdbx_type = 'u32' , not_null = true},
				{col = 'part' , mdbx_type = 'u32' , not_null = true},
				{col = 'cat'  , mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
				{col = 'grp'  , mdbx_type = 'u32' , not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			},
			pk = {'id', 'part'},
		})
		db:insert('t', '{}', {id = 1, part = 1, cat = 'a', grp = 7, email = 'a@x'})
		db:insert('t', '{}', {id = 2, part = 1, cat = 'a', grp = 7, email = 'b@x'})
		db:insert('t', '{}', {id = 3, part = 1, cat = 'b', grp = 8, email = 'c@x'})
		local _,_,ix = db:add_index('t', {'cat', 'grp'})
		local _,_,ux = db:add_index('t', {'email', is_unique = true})

		assert(db:del(ux, 'c@x') == true)
		assert(db:del(ux, 'c@x') == false)
		assert(not db:exists('t', 3, 1))
		assert(not db:try_find(ix, nil, 'b', 8))

		local ok, err = pcall(db.del, db, ix, 'a', 7)
		assert(not ok)
		assert(tostring(err):find('cannot delete through non-unique index', 1, true),
			tostring(err))
		assert(db:exists('t', 1, 1))
		assert(db:exists('t', 2, 1))
		assert(num(db:must_find(ix, '{}', 'a', 7).id) == 1)
		db:commit()
	end)
end

-- rename --------------------------------------------------------------------

--rename updates the in-memory name and the $schema row (no orphan), survives a
--reopen.
function test.rename_table()
	local file = test_file('rename_table'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'i32'},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, v = 10})
		db:commit()
		db:begin'w'; db:rename_table('t', 'u'); db:commit()
		db:begin'r'
		assert(not db:table_exists't' and db:table_exists'u')
		assert(num(db:find('u', 'v', 1)) == 10)
		local _, sch = db:dbi_schema'u'
		assert(sch.name == 'u', sch.name)
		db:commit(); db:close()
		db = mdbx_open(file) --reopen: u loads, t gone
		db:begin'r'
		assert(db:table_exists'u' and not db:table_exists't')
		assert(num(db:find('u', 'v', 1)) == 10)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
end

function test.table_ddl_expected_errors()
	with_db('table_ddl_expected_errors', function(db)
		db:begin'w'
		db:create_table('t', {name = 't',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'}})
		db:create_table('u', {name = 'u',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'}})
		db:commit()

		db:begin'w'
		local txn = db.txn
		local ok, err = db:drop_table'missing'
		assert(ok == nil and err == 'not_found')
		assert(db.txn == txn)

		ok, err = catch('schema', db.rename_table, db, 'missing', 'x')
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.table == 'missing', tostring(err))
		assert(db.txn == nil)

		db:begin'w'
		ok, err = catch('schema', db.rename_table, db, 't', 'u')
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.event == 't_rename' and err.table == 't', tostring(err))
		assert(db.txn == nil)

		db:begin'w'
		assert(db:table_exists't' and db:table_exists'u')

		assert(db:drop_table't' == true)
		ok, err = db:drop_table't'
		assert(ok == nil and err == 'not_found')
		db:commit()
	end)
end

--renaming an indexed table renames its index tables and fixes their
--back-references; the index stays queryable and survives a reopen.
function test.rename_indexed_table()
	local file = test_file('rename_indexed_table'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'cat', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, cat = 'a'})
		db:insert('t', '{}', {id = 2, cat = 'a'})
		db:add_index('t', {'cat'})
		db:commit()
		db:begin'w'; db:rename_table('t', 'u'); db:commit()
		db:begin'r'
		assert(db:table_exists'u/cat' and not db:table_exists't/cat')
		local n = 0; for c, t in db:each('u/cat', '{}') do n = n + 1 end
		assert(n == 2, n)
		db:commit(); db:close()
		db = mdbx_open(file) --reopen: u + its index load and work
		db:begin'r'
		assert(db:table_exists'u/cat')
		local n = 0; for c, t in db:each('u/cat', '{}') do n = n + 1 end
		assert(n == 2, n)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
end

-- foreign keys --------------------------------------------------------------

--fk registration: add_fk records the fk on the child schema and it survives
--a reopen; drop_fk removes it. (no enforcement yet -- step 1.)
function test.fk_registration()
	local file = test_file('fk_registration'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}, ondelete = 'cascade'}
		local _, sch = db:dbi_schema'child'
		assert(sch.fks and sch.fks['pid'], 'fk not registered')
		db:commit(); db:close()
		db = mdbx_open(file) --reopen: fk persists
		db:begin'r'
		local _, sch = db:dbi_schema'child'
		local fk = sch.fks and sch.fks['pid']
		assert(fk, 'fk not persisted')
		assert(fk.name == 'pid' and fk.table == 'child' and fk.ref_table == 'parent'
			and fk.cols[1] == 'pid' and fk.ref_cols[1] == 'id'
			and fk.ondelete == 'cascade', pp(fk))
		db:commit(); db:close()
		db = mdbx_open(file) --drop_fk removes it
		db:begin'w'
		db:drop_fk('child', 'pid')
		assert(not (select(2, db:dbi_schema'child').fks or empty)['pid'])
		db:commit(); db:close()
		db = mdbx_open(file)
		db:begin'r'
		assert(not (select(2, db:dbi_schema'child').fks or empty)['pid'])
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
end

function test.fk_removal_clears_reverse_refs()
	with_db_reopen('fk_removal_clears_reverse_refs', function(db)
		db:begin'w'
		for i = 1, 2 do
			db:create_table('parent'..i, {
				name = 'parent'..i,
				fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
				pk = {'id'},
			})
			db:create_table('child'..i, {
				name = 'child'..i,
				fields = {
					{col = 'id' , mdbx_type = 'u32', not_null = true},
					{col = 'pid', mdbx_type = 'u32', not_null = true},
				},
				pk = {'id'},
			})
			db:add_fk{table = 'child'..i, cols = {'pid'},
				ref_table = 'parent'..i, ref_cols = {'id'}}
		end
		db:drop_fk('child1', 'pid')
		db:drop_table'child2'
		assert(not select(2, db:dbi_schema'parent1').ref_fks)
		assert(not select(2, db:dbi_schema'parent2').ref_fks)
		db:commit()
	end, function(db)
		db:begin'r'
		assert(not select(2, db:dbi_schema'parent1').ref_fks)
		assert(not select(2, db:dbi_schema'parent2').ref_fks)
		db:commit()
	end)
end

--fk insert/update check: a child row must reference an existing parent; a null
--(nullable) fk col skips the check. (step 2.)
function test.fk_insert_check()
	with_db('fk_insert_check', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true}, --required fk
				{col = 'opt', mdbx_type = 'u32'},                  --nullable fk
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}, ondelete = 'cascade'}
		db:add_fk{table = 'child', cols = {'opt'},
			ref_table = 'parent', ref_cols = {'id'}, ondelete = 'set null'}
		db:insert('parent', '{}', {id = 1})

		--insert referencing an existing parent -> ok
		db:insert('child', '{}', {id = 10, pid = 1})
		assert(db:exists('child', 10))
		--insert referencing a missing parent -> rejected, not written
		local ok, err = try_mutation(db, db.insert, 'child', '{}', {id = 11, pid = 99})
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		assert(not db:exists('child', 11))
		--update to a missing parent -> rejected, unchanged
		local ok2, err2 = try_mutation(db, db.update, 'child', '{}', {id = 10, pid = 99})
		assert(ok2 == false and is_row_error(err2, 'fk'), S(err2))
		assert(num(db:find('child', 'pid', 10)) == 1)
		--update to another existing parent -> ok
		db:insert('parent', '{}', {id = 2})
		db:update('child', '{}', {id = 10, pid = 2})
		assert(num(db:find('child', 'pid', 10)) == 2)

		--nullable fk: null skips the check
		db:insert('child', '{}', {id = 20, pid = 1, opt = null})
		assert(db:exists('child', 20))
		--nullable fk: a non-null missing parent is still rejected
		assert(try_mutation(db, db.insert, 'child', '{}', {id = 21, pid = 1, opt = 99}) == false)
		--nullable fk: a non-null existing parent is accepted
		db:insert('child', '{}', {id = 22, pid = 1, opt = 2})
		assert(db:exists('child', 22))
		db:commit()
	end)
end

--partial update of a composite fk checks the merged row, not only the supplied
--columns: changing (a,b) from (1,1) to the nonexistent (2,1) must be rejected.
function test.fk_partial_composite_update()
	with_db('fk_partial_composite_update', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {
				{col = 'a', mdbx_type = 'u32', not_null = true},
				{col = 'b', mdbx_type = 'u32', not_null = true},
			},
			pk = {'a', 'b'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'a' , mdbx_type = 'u32', not_null = true},
				{col = 'b' , mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'a', 'b'},
			ref_table = 'parent', ref_cols = {'a', 'b'}}
		assert(db:table_schema'child'.fks['a,b'], 'composite fk name')
		db:insert('parent', '{}', {a = 1, b = 1})
		db:insert('parent', '{}', {a = 2, b = 2})
		db:insert('child', '{}', {id = 10, a = 1, b = 1})

		local ok, err = try_mutation(db, db.update, 'child', '{}', {id = 10, a = 2})
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		local r = db:find('child', '{a b}', 10)
		assert(num(r.a) == 1 and num(r.b) == 1, ('%s,%s'):format(S(r.a), S(r.b)))
		db:commit()
	end)
end

--an fk whose cols include a pk col: the fk-owned index must decode those cols
--from the key record (pk cols live in the key), not the value. here 'a' is the
--child's pk (key) and 'b' is a plain value col, so the index decode is mixed.
function test.fk_on_pk_col()
	with_db('fk_on_pk_col', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {
				{col = 'a', mdbx_type = 'u32', not_null = true},
				{col = 'b', mdbx_type = 'u32', not_null = true},
			},
			pk = {'a', 'b'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'a', mdbx_type = 'u32', not_null = true}, --pk + fk col (key)
				{col = 'b', mdbx_type = 'u32', not_null = true}, --plain fk col (value)
			},
			pk = {'a'},
		})
		db:insert('parent', '{}', {a = 1, b = 5})
		db:insert('parent', '{}', {a = 2, b = 6})
		--existing valid child row before the fk exists.
		db:insert('child', '{}', {a = 1, b = 5})

		--add_fk validates existing rows by decoding the fk cols ('a' from the
		--key, 'b' from the value) and probing the parent.
		assert(db:add_fk{table = 'child', cols = {'a', 'b'},
			ref_table = 'parent', ref_cols = {'a', 'b'}, ondelete = 'cascade'})

		--enforcement after the fk exists.
		db:insert('child', '{}', {a = 2, b = 6})                       --parent (2,6) ok
		local ok, err = try_mutation(db, db.insert, 'child', '{}', {a = 3, b = 9})   --no parent (3,9)
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		assert(not db:exists('child', 3))

		--ondelete cascade reaches the child through the fk-owned index whose key
		--cols are decoded back to the child's pk.
		db:del('parent', 1, 5)
		assert(not db:exists('child', 1), 'cascade should remove child a=1')
		assert(db:exists('child', 2))
		db:commit()
	end)
end

--fk check uses a column's default when it isn't given on a full write (insert).
function test.fk_default_check()
	with_db('fk_default_check', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id'  , mdbx_type = 'u32', not_null = true},
				{col = 'dpid', mdbx_type = 'u32', mdbx_default = 7}, --defaults to parent 7
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'dpid'},
			ref_table = 'parent', ref_cols = {'id'}}
		--insert without dpid -> default 7 -> parent 7 missing -> rejected
		local ok, err = try_mutation(db, db.insert, 'child', '{}', {id = 1})
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		assert(not db:exists('child', 1))
		--explicit null skips both the default and the fk check.
		db:insert('child', '{}', {id = 2, dpid = null})
		assert(db:is_null('child', 'dpid', 2))
		--with parent 7 present, the defaulted fk is accepted
		db:insert('parent', '{}', {id = 7})
		db:insert('child', '{}', {id = 3})
		assert(num(db:find('child', 'dpid', 3)) == 7)
		db:commit()
	end)
end

--fk delete enforcement (NO ACTION, the default): a parent row a child references
--can't be deleted; an unreferenced parent deletes; once the child is gone the
--parent deletes too. (step 3.)
function test.fk_delete_no_action()
	with_db('fk_delete_no_action', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}} --restrict (default)
		db:insert('parent', '{}', {id = 1})
		db:insert('parent', '{}', {id = 2})
		db:insert('child', '{}', {id = 10, pid = 1})
		--deleting a referenced parent is rejected
		local ok, err = try_mutation(db, db.del, 'parent', 1)
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		assert(db:exists('parent', 1))
		--an unreferenced parent deletes fine
		assert(try_mutation(db, db.del, 'parent', 2))
		assert(not db:exists('parent', 2))
		--once the child is gone, the parent deletes
		db:del('child', 10)
		assert(try_mutation(db, db.del, 'parent', 1))
		assert(not db:exists('parent', 1))
		db:commit()
	end)
end

--add_fk reuses a compatible existing index; otherwise it creates an fk-owned
--index that lives in indexes but not in `ixs` (the user-declared list).
function test.fk_index_reuse()
	with_db_reopen('fk_index_reuse', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
				{col = 'qid', mdbx_type = 'u32', not_null = true},
				{col = 'rid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})

		--reuse non-unique and unique user indexes.
		db:add_index('child', {'pid'})
		db:add_index('child', {'rid', is_unique = true})
		assert(db:table_exists'child/pid')
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:add_fk{table = 'child', cols = {'rid'},
			ref_table = 'parent', ref_cols = {'id'}}
		local _, sch = db:dbi_schema'child'
		assert(sch.fks['pid'].index.name == 'child/pid', sch.fks['pid'].index.name)
		assert(sch.fks['rid'].index.name == 'child/rid', sch.fks['rid'].index.name)
		assert(sch.ixs and sch.ixs['child/pid'], 'reused index stays user-owned')

		--create an FK-owned index when no user index matches.
		db:add_fk{table = 'child', cols = {'qid'},
			ref_table = 'parent', ref_cols = {'id'}}
		local _, sch = db:dbi_schema'child'
		assert(sch.fks['qid'].index.name == 'child/qid', sch.fks['qid'].index.name)
		assert(db:table_exists'child/qid', 'fk-owned index table exists')
		assert(not (sch.ixs and sch.ixs['child/qid']), 'fk-owned index not in ixs')
		db:commit()
	end, function(db)
		db:begin'r'
		local _, schema = db:dbi_schema'child'
		assert(schema.fks.pid.index.name == 'child/pid')
		assert(schema.fks.rid.index.name == 'child/rid')
		assert(schema.fks.qid.index.name == 'child/qid')
		db:commit()
	end)
end

--dropping a reused unique index keeps its physical table for the fk and
--downgrades the runtime and stored schema to non-unique.
function test.fk_drop_unique_index_downgrades_for_fk()
	with_db_reopen('fk_drop_unique_index_downgrades_for_fk', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'pid', is_unique = true})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		local _, schema = db:dbi_schema'child'
		local index = schema.fks.pid.index
		assert(index.name == 'child/pid' and index.is_unique)

		db:drop_index'child/pid'
		assert(schema.fks.pid.index == index and not index.is_unique)
		assert(db:table_exists'child/pid')
		db:commit()
	end, function(db)
		db:begin'r'
		local _, schema = db:dbi_schema'child'
		assert(schema.fks.pid.index.name == 'child/pid')
		assert(not schema.fks.pid.index.is_unique)
		db:commit()
	end)
end

--drop_index on an index a fk reused removes it from `ixs` but keeps the table
--(now fk-owned), and delete enforcement keeps working.
function test.fk_drop_index_kept_by_fk()
	with_db('fk_drop_index_kept_by_fk', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		db:add_index('child', {'pid'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		--drop the user index: table survives because the fk still uses it.
		db:drop_index'child/pid'
		assert(db:table_exists'child/pid', 'fk-used index survives drop_index')
		local _, sch = db:dbi_schema'child'
		assert(not (sch.ixs and sch.ixs['child/pid']), 'removed from ixs')
		--enforcement still works via the now-fk-owned index.
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		db:commit()
	end)
end

--re-adding a user index retained for an fk restores its `ixs` declaration
--without rebuilding or duplicating the existing physical index.
function test.fk_retained_index_readd()
	with_db('fk_retained_index_readd', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		local _, _, ix = db:add_index('child', {'pid'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:drop_index(ix)

		local _, _, readded_ix = db:add_index('child', {'pid'})
		assert(readded_ix == ix)
		local _, schema = db:dbi_schema'child'
		assert(schema.fks['pid'].index.name == ix)
		assert(num((db:must_find(ix, '{}', 1)).id) == 10)

		db:drop_fk('child', 'pid')
		assert(db:table_exists(ix), 're-added user index survives fk drop')
		db:drop_index(ix)
		assert(not db:table_exists(ix), 'index drops after its final owner')
		assert_consistent(db)
		db:commit()
	end)
end

--dropping a parent untangles referencing children: their fks are removed but
--the child tables and rows survive.
function test.fk_drop_table_untangle()
	with_db('fk_drop_table_untangle', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:drop_table'parent'
		assert(not db:table_exists'parent')
		--child + its row survive; the fk is gone.
		assert(db:table_exists'child' and db:exists('child', 10))
		local _, sch = db:dbi_schema'child'
		assert(not (sch.fks and sch.fks['pid']), 'child fk untangled')
		db:commit()
	end)
end

--drop_fk drops an fk-owned index but leaves a reused user index alone.
function test.fk_drop_fk_releases_index()
	with_db('fk_drop_fk_releases_index', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true}, --fk-owned index
				{col = 'qid', mdbx_type = 'u32', not_null = true}, --reused user index
			},
			pk = {'id'},
		})
		db:add_index('child', {'qid'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:add_fk{table = 'child', cols = {'qid'},
			ref_table = 'parent', ref_cols = {'id'}}
		assert(db:table_exists'child/pid' and db:table_exists'child/qid')
		--drop the fk-owned one: its index table goes away.
		db:drop_fk('child', 'pid')
		assert(not db:table_exists'child/pid', 'fk-owned index dropped')
		--drop the reused one: the user index survives.
		db:drop_fk('child', 'qid')
		assert(db:table_exists'child/qid', 'reused user index survives')
		local _, sch = db:dbi_schema'child'
		assert(sch.ixs and sch.ixs['child/qid'])
		db:commit()
	end)
end

--an fk-owned index round-trips: on reopen it re-attaches to indexes via the
--fk (not via `ixs`) and still enforces deletes.
function test.fk_owned_index_reopen()
	with_db_reopen('fk_owned_index_reopen', function(db)
		db:begin'w'
		db:create_table('parent', {
			name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'},
		})
		db:create_table('child', {
			name = 'child',
			fields = {
				{col = 'id' , mdbx_type = 'u32', not_null = true},
				{col = 'pid', mdbx_type = 'u32', not_null = true},
			},
			pk = {'id'},
		})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:commit()
	end, function(db)
		db:begin'w'
		local _, sch = db:dbi_schema'child'
		assert(sch.fks['pid'].index.name == 'child/pid')
		assert(not (sch.ixs and sch.ixs['child/pid']), 'fk-owned index not in ixs')
		local present
		for _, ix in ipairs(sch.indexes or empty) do
			if ix.name == 'child/pid' then present = true end
		end
		assert(present, 'fk-owned index re-attaches to indexes on reopen')
		assert(try_mutation(db, db.del, 'parent', 1) == false) --still enforces
		db:commit()
	end)
end

--cascade delete: removing a parent removes referencing children, recursively.
function test.fk_delete_cascade()
	with_db('fk_delete_cascade', function(db)
		db:begin'w'
		db:create_table('a', {name = 'a',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('b', {name = 'b', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'aid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:create_table('c', {name = 'c', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'bid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'b', cols = {'aid'},
			ref_table = 'a', ref_cols = {'id'}, ondelete = 'cascade'}
		db:add_fk{table = 'c', cols = {'bid'},
			ref_table = 'b', ref_cols = {'id'}, ondelete = 'cascade'}
		db:insert('a', '{}', {id = 1}); db:insert('a', '{}', {id = 2})
		db:insert('b', '{}', {id = 10, aid = 1}); db:insert('b', '{}', {id = 11, aid = 1})
		db:insert('b', '{}', {id = 12, aid = 2})
		db:insert('c', '{}', {id = 100, bid = 10}); db:insert('c', '{}', {id = 101, bid = 10})
		db:insert('c', '{}', {id = 102, bid = 12})
		--delete a=1 -> cascades to b 10,11 -> cascades to c 100,101
		db:del('a', 1)
		assert(not db:exists('a', 1))
		assert(not db:exists('b', 10) and not db:exists('b', 11))
		assert(not db:exists('c', 100) and not db:exists('c', 101))
		--rows under a=2 are untouched
		assert(db:exists('a', 2) and db:exists('b', 12) and db:exists('c', 102))
		db:commit()
	end)
end

--set-null delete: removing a parent nulls referencing children's fk cols; the
--child rows survive.
function test.fk_delete_set_null()
	with_db('fk_delete_set_null', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32'}, --nullable fk col
		}, pk = {'id'}})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}, ondelete = 'set null'}
		db:insert('parent', '{}', {id = 1}); db:insert('parent', '{}', {id = 2})
		db:insert('child', '{}', {id = 10, pid = 1}); db:insert('child', '{}', {id = 11, pid = 1})
		db:insert('child', '{}', {id = 12, pid = 2})
		db:del('parent', 1)
		assert(not db:exists('parent', 1))
		--children survive with pid nulled
		assert(db:exists('child', 10) and db:exists('child', 11))
		assert(db:is_null('child', 'pid', 10) and db:is_null('child', 'pid', 11))
		--child under parent 2 untouched
		assert(num(db:find('child', 'pid', 12)) == 2)
		db:commit()
	end)
end

--a cascade that hits a deeper NO ACTION (a still-referenced row) fails and rolls
--back fully (no partial deletes).
function test.fk_delete_cascade_atomic()
	with_db('fk_delete_cascade_atomic', function(db)
		db:begin'w'
		db:create_table('a', {name = 'a',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('b', {name = 'b', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'aid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:create_table('c', {name = 'c', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'bid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'b', cols = {'aid'},
			ref_table = 'a', ref_cols = {'id'}, ondelete = 'cascade'}
		db:add_fk{table = 'c', cols = {'bid'},
			ref_table = 'b', ref_cols = {'id'}} --no action (default)
		db:insert('a', '{}', {id = 1})
		db:insert('b', '{}', {id = 10, aid = 1}); db:insert('b', '{}', {id = 11, aid = 1})
		db:insert('c', '{}', {id = 100, bid = 11}) --c references b=11
		--cascade removes b 10,11 but c still references b=11 -> whole op fails and
		--the cascaded removal of b=10 is rolled back.
		local ok, err = try_mutation(db, db.del, 'a', 1)
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		assert(db:exists('a', 1))
		assert(db:exists('b', 10) and db:exists('b', 11))
		assert(db:exists('c', 100))
		db:commit()
	end)
end

--an all-cascade reference cycle (rows mutually referencing) deletes whole and
--terminates: delete-first removes each row's fk edges as it goes, so the
--recursion can't revisit an already-deleted row. (cycle safety.)
function test.fk_delete_cascade_cycle()
	with_db('fk_delete_cascade_cycle', function(db)
		db:begin'w'
		db:create_table('a', {name = 'a', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'bid', mdbx_type = 'u32'}, --nullable so the cycle can be formed
		}, pk = {'id'}})
		db:create_table('b', {name = 'b', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'aid', mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:add_fk{table = 'a', cols = {'bid'},
			ref_table = 'b', ref_cols = {'id'}, ondelete = 'cascade'}
		db:add_fk{table = 'b', cols = {'aid'},
			ref_table = 'a', ref_cols = {'id'}, ondelete = 'cascade'}
		db:insert('a', '{}', {id = 1})            --bid null for now
		db:insert('b', '{}', {id = 2, aid = 1})   --b2 -> a1
		db:update('a', '{}', {id = 1, bid = 2})   --close the cycle: a1 -> b2
		--deleting either side removes the whole cycle (and must terminate).
		db:del('a', 1)
		assert(not db:exists('a', 1) and not db:exists('b', 2))
		db:commit()
	end)
end

--rename maintains fk cross-refs: renaming a child moves its fk index and
--retargets each parent's reverse ref; renaming a parent retargets each child's
--ref_table. all of it persists across reopen and keeps enforcing. (step 5.)
function test.fk_rename_table()
	local file = test_file('fk_rename_table'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:commit()
		--rename in a fresh txn: mdbx forbids renaming a table created in this txn.
		db:begin'w'
		db:rename_table('child', 'kid')
		db:rename_table('parent', 'mom')
		db:commit(); db:close()
		--reopen: renamed fk metadata persists and still enforces.
		db = mdbx_open(file)
		db:begin'w'
		assert(db:table_exists'kid' and db:table_exists'mom')
		assert(db:table_exists'kid/pid' and not db:table_exists'child/pid')
		local _, ksch = db:dbi_schema'kid'
		local fk = ksch.fks['pid']
		assert(fk.table == 'kid' and fk.ref_table == 'mom'
			and fk.index.name == 'kid/pid', pp(fk))
		assert(try_mutation(db, db.del, 'mom', 1) == false)                       --referenced by kid 10
		assert(try_mutation(db, db.insert, 'kid', '{}', {id = 11, pid = 99}) == false) --missing parent
		db:insert('mom', '{}', {id = 2})
		db:insert('kid', '{}', {id = 12, pid = 2})                  --references renamed parent
		db:del('kid', 10); db:del('kid', 12)
		assert(try_mutation(db, db.del, 'mom', 1))                                --no longer referenced
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
end

--DDL consistency: a freshly built schema (tables + unique index + fk) is
--consistent in memory and after reopen.
function test.ddl_consistency_baseline()
	local file = test_file('ddl_consistency_baseline'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'pid'  , mdbx_type = 'u32' , not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'email', is_unique = true})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}, ondelete = 'cascade'}
		assert_consistent(db, 'built')
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert_consistent(db, 'reopened')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--DDL consistency: dropping a child (fk untangle) then the parent leaves no orphan
--index/fk-index tables and no dangling ref_fks, in memory and after reopen.
function test.ddl_drop_table_consistency()
	local file = test_file('ddl_drop_table_consistency'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'pid'  , mdbx_type = 'u32' , not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'email', is_unique = true})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:commit()
		db:begin'w'
		db:drop_table'child'
		assert(not db:table_exists'child' and not db:table_exists'child/email')
		assert_consistent(db, 'after drop child')
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'w'
		assert_consistent(db, 'reopen after drop child')
		db:drop_table'parent'
		assert_consistent(db, 'after drop parent')
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert_consistent(db, 'final reopen')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--DDL consistency: drop_index on a fk-reused index keeps the table (now fk-owned);
--dropping the fk then releases it; consistent throughout and after reopen.
function test.ddl_drop_index_consistency()
	local file = test_file('ddl_drop_index_consistency'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'pid'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:commit()
		db:begin'w'
		db:drop_index'child/pid'                --kept: the fk still uses it
		assert(db:table_exists'child/pid')
		assert_consistent(db, 'after drop_index (fk-kept)')
		db:drop_fk('child', 'pid')
		assert(not db:table_exists'child/pid')  --now released
		assert_consistent(db, 'after drop_fk')
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert_consistent(db, 'reopen')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--DDL consistency: renaming a child then its parent keeps fk cross-refs and index
--tables consistent, in memory and after reopen.
function test.ddl_rename_consistency()
	local file = test_file('ddl_rename_consistency'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'pid'  , mdbx_type = 'u32' , not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'email', is_unique = true})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:commit()
		db:begin'w'
		db:rename_table('child', 'kid')
		db:rename_table('parent', 'mom')
		assert_consistent(db, 'after rename')
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert_consistent(db, 'reopen after rename')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--DDL consistency: a table + index created in an aborted txn leave no trace (no
--table, index, or $schema row) and a consistent catalog after reopen.
function test.ddl_abort_rollback()
	local file = test_file('ddl_abort_rollback'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w' --seed a committed table so the catalog isn't empty.
		db:create_table('keep', {name = 'keep',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:commit()
		db:begin'w' --create + index, then abort.
		db:create_table('temp', {name = 'temp', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'val', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('temp', {'val'})
		db:abort(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:table_exists'keep')
		assert(not db:table_exists'temp', 'aborted table leaked')
		assert(not db:table_exists'temp/val', 'aborted index leaked')
		assert_consistent(db, 'after abort')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--logical DDL failures abort the current transaction; atomic() isolates the
--failure so the surrounding transaction remains usable.
function test.ddl_errors_abort_transaction()
	with_db('ddl_errors_abort_transaction', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, v = 10})
		db:commit()

		db:begin'w'
		db:insert('t', '{}', {id = 2, v = 20})
		local ok, err = catch('schema', db.drop_index, db, 't/missing')
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.event == 'i_drop' and err.table == 't', tostring(err))
		assert(db.txn == nil, 'direct DDL failure did not abort the transaction')

		db:begin'w'
		assert(not db:exists('t', 2))
		local outer_txn = db.txn
		ok, err = try_schema(db, db.drop_index, 't/missing')
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(db.txn == outer_txn, 'atomic DDL failure changed the outer txn')
		db:insert('t', '{}', {id = 3, v = 30})
		db:commit()
	end)
end

--index-build validation is a schema error attributed to the base field; the
--aborted atomic transaction leaves no physical or cached index state behind.
function test.ddl_index_build_field_failure()
	with_db('ddl_index_build_field_failure', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 's' , mdbx_type = 'utf8', maxlen = 8, nozero = true,
				mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, s = string.char(0xff)})
		db:commit()

		db:begin'w'
		local outer_txn = db.txn
		local ok, err = try_schema(db, db.add_index, 't', {'s'})
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.event == 'i_add' and err.table == 't' and err.col == 's',
			tostring(err))
		assert(err.message:find('invalid utf8', 1, true), tostring(err.message))
		assert(db.txn == outer_txn)
		local _, schema = db:dbi_schema't'
		assert(not schema.ixs and not schema.indexes)
		assert(not db:table_exists't/s')

		db:del('t', 1)
		local begins = 0
		local real_begin = db.begin
		db.begin = function(self, ...)
			begins = begins + 1
			return real_begin(self, ...)
		end
		db:add_index('t', {'s'})
		db.begin = nil
		assert(begins == 0, begins)
		assert(db:table_exists't/s')
		db:commit()
	end)
end

--aborted table/column renames discard their transaction-owned schema graph;
--the same open db immediately sees the original names and fk cross-references.
function test.ddl_abort_rename_cached()
	with_db('ddl_abort_rename_cached', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:commit()

		db:begin'w'
		db:rename_table('child', 'kid')
		db:abort()

		db:begin'w'
		assert(db:table_exists'child' and not db:table_exists'kid')
		local _, ps = db:dbi_schema'parent'
		local _, cs1 = db:dbi_schema'child'
		assert(ps.ref_fks['child/pid'] and not ps.ref_fks['kid/pid'])
		assert(cs1.name == 'child' and cs1.fks['pid'].table == 'child')
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		assert_consistent(db, 'after aborted table rename')
		db:commit()

		db:begin'w'
		db:rename_column('child', 'pid', 'parent_id')
		db:abort()

		db:begin'w'
		local _, cs2 = db:dbi_schema'child'
		assert(cs2.fields.pid and not cs2.fields.parent_id)
		assert(db:table_exists'child/pid' and not db:table_exists'child/parent_id')
		assert(try_mutation(db, db.insert, 'child', '{}', {id = 11, pid = 99}) == false)
		assert_consistent(db, 'after aborted column rename')
		db:commit()
	end)
end

--aborted index add/drop restores both the physical index and the cached table
--schema without reopening the database.
function test.ddl_abort_index_cached()
	with_db('ddl_abort_index_cached', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'val', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, val = 10})
		db:commit()

		db:begin'w'
		local _, _, ix = db:add_index('t', {'val'})
		db:abort()

		db:begin'w'
		local _, ts = db:dbi_schema't'
		assert(not db:table_exists(ix) and not ts.ixs and not ts.indexes)
		assert_consistent(db, 'after aborted index add')
		db:add_index('t', {'val'})
		db:commit()

		db:begin'w'
		db:drop_index(ix)
		db:abort()

		db:begin'w'
		local _, ts2 = db:dbi_schema't'
		assert(db:table_exists(ix) and ts2.ixs[ix] and #ts2.indexes == 1)
		db:insert('t', '{}', {id = 2, val = 20})
		assert(num((db:must_find(ix, '{}', 20)).id) == 2)
		assert_consistent(db, 'after aborted index drop')
		db:commit()
	end)
end

--aborted fk add/drop and parent drop restore child/parent metadata and the
--fk-owned index in the same open database.
function test.ddl_abort_fk_cached()
	with_db('ddl_abort_fk_cached', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:commit()
		local function fk()
			return {table = 'child', cols = {'pid'},
				ref_table = 'parent', ref_cols = {'id'}}
		end

		db:begin'w'
		db:add_fk(fk())
		db:abort()

		db:begin'w'
		local _, ps = db:dbi_schema'parent'
		local _, cs = db:dbi_schema'child'
		assert(not ps.ref_fks and not cs.fks and not db:table_exists'child/pid')
		assert_consistent(db, 'after aborted fk add')
		db:add_fk(fk())
		db:commit()

		db:begin'w'
		db:drop_fk('child', 'pid')
		db:abort()

		db:begin'w'
		local _, ps2 = db:dbi_schema'parent'
		local _, cs2 = db:dbi_schema'child'
		assert(ps2.ref_fks['child/pid'] and cs2.fks['pid'])
		assert(db:table_exists'child/pid')
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		assert_consistent(db, 'after aborted fk drop')
		db:commit()

		db:begin'w'
		db:drop_table'parent'
		db:abort()

		db:begin'w'
		local _, ps3 = db:dbi_schema'parent'
		local _, cs3 = db:dbi_schema'child'
		assert(ps3.ref_fks['child/pid'] and cs3.fks['pid'])
		assert(db:table_exists'child/pid')
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		assert_consistent(db, 'after aborted parent drop')
		db:commit()
	end)
end

--extract_schema rebuilds a schema object from the catalog: data tables only
--(index/meta tables excluded), with fields, pk and fks intact.
function test.extract_schema()
	with_db('extract_schema', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'pid'  , mdbx_type = 'u32' , not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'email', is_unique = true})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		local sc = db:extract_schema()
		--data tables present; index/meta tables excluded.
		assert(sc.tables.parent and sc.tables.child, 'data tables missing')
		for name in pairs(sc.tables) do
			assert(not name:find('/', 1, true) and name ~= '$schema',
				'non-data table leaked into extract: '..name)
		end
		--fields, pk and fks survive the round-trip.
		local c = sc.tables.child
		assert(c.fields.email and c.fields.pid and c.fields.id, 'fields missing')
		assert(c.pk[1] == 'id', S(c.pk))
		assert(c.fks and c.fks['pid']
			and c.fks['pid'].ref_table == 'parent', 'fk missing in extract')
		db:commit()
	end)
end

--transactions: commit persists across reopen.
function test.txn_commit_persists()
	local file = test_file('txn_commit_persists'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('kv', {name = 'kv', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:insert('kv', '{}', {k = 1, v = 10})
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:exists('kv', 1) and num(db:find('kv', 'v', 1)) == 10)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--transactions: abort discards the txn's writes; prior committed data survives.
function test.txn_abort_discards()
	local file = test_file('txn_abort_discards'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('kv', {name = 'kv', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:insert('kv', '{}', {k = 1, v = 10})
		db:commit()
		db:begin'w'
		db:insert('kv', '{}', {k = 2, v = 20})
		db:abort(); db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:exists('kv', 1), 'committed row lost')
		assert(not db:exists('kv', 2), 'aborted row survived')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--transactions: aborting a nested txn discards only its writes; the outer txn
--continues and its commit persists.
function test.txn_nested_abort()
	local file = test_file('txn_nested_abort'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('kv', {name = 'kv', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:commit()
		db:begin'w'                       --outer
		db:insert('kv', '{}', {k = 1, v = 10})
		db:begin'w'                       --nested
		db:insert('kv', '{}', {k = 2, v = 20})
		db:abort()                        --nested discarded
		assert(db:exists('kv', 1) and not db:exists('kv', 2), 'nested abort wrong')
		db:commit()                       --outer persists k=1
		db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:exists('kv', 1) and not db:exists('kv', 2))
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--transactions: committing a nested txn merges into the outer; only the outer
--commit makes it durable.
function test.txn_nested_commit()
	local file = test_file('txn_nested_commit'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('kv', {name = 'kv', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:commit()
		db:begin'w'                       --outer
		db:insert('kv', '{}', {k = 1, v = 10})
		db:begin'w'                       --nested
		db:insert('kv', '{}', {k = 2, v = 20})
		db:commit()                       --nested merges into outer
		db:commit()                       --outer persists both
		db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:exists('kv', 1) and db:exists('kv', 2))
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--atomic(): commits on success.
function test.atomic_commit()
	local file = test_file('atomic_commit'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:atomic('w', function()
			db:create_table('kv', {name = 'kv', fields = {
				{col = 'k', mdbx_type = 'u32', not_null = true},
				{col = 'v', mdbx_type = 'u32', not_null = true},
			}, pk = {'k'}})
			db:insert('kv', '{}', {k = 1, v = 10})
		end)
		db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:exists('kv', 1) and num(db:find('kv', 'v', 1)) == 10)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--atomic(): an error inside aborts the whole block and re-raises; prior committed
--data is untouched.
function test.atomic_rollback_on_error()
	local file = test_file('atomic_rollback_on_error'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('kv', {name = 'kv', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:insert('kv', '{}', {k = 1, v = 10})
		db:commit()
		local aok = pcall(db.atomic, db, 'w', function()
			db:insert('kv', '{}', {k = 2, v = 20})
			error'boom'
		end)
		assert(not aok, 'atomic should re-raise the error')
		db:close()
		db = mdbx_open(file); db:begin'r'
		assert(db:exists('kv', 1), 'committed row lost')
		assert(not db:exists('kv', 2), 'atomic-aborted row survived')
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--autoinc: an auto_increment pk left unset gets a generated id (returned by
--insert), increasing by 1, persisted as a sequence across reopen (no reuse of
--deleted ids).
function test.autoinc()
	local file = test_file('autoinc'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true, auto_increment = true},
			{col = 'v' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		local id0 = num(db:insert('t', '{}', {v = 10}))
		local id1 = num(db:insert('t', '{}', {v = 11}))
		assert(id1 == id0 + 1, ('%d,%d'):format(id0, id1))
		db:del('t', id0)
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'w' --seq persists -> next id continues
		local id2 = num(db:insert('t', '{}', {v = 12}))
		assert(id2 == id1 + 1, ('%d,%d'):format(id1, id2))
		assert(db:exists('t', id1) and db:exists('t', id2) and not db:exists('t', id0))
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--a failed autoincrement insert inside atomic() rolls back its sequence increment.
function test.autoinc_failure_rolls_back_sequence()
	with_db('autoinc_failure_rolls_back_sequence', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'   , mdbx_type = 'u32', not_null = true, auto_increment = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'email', is_unique = true})
		local id1 = num(db:insert('t', '{}', {email = 'a@x'}))
		local ok, err = try_mutation(db, db.insert, 't', '{}', {email = 'a@x'})
		assert(not ok)
		check_row_error(err, 'insert', 't', 'already_exists')
		local id2 = num(db:insert('t', '{}', {email = 'b@x'}))
		assert(id2 == id1 + 1, ('%d,%d'):format(id1, id2))
		db:commit()
	end)
end

--cursor navigation: first/next walk ascending, last/prev walk descending, and
--current returns the positioned row.
function test.cursor_navigation()
	with_db('cursor_navigation', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		for i = 1, 5 do db:insert('t', '{}', {k = i, v = i * 10}) end
		local cur = db:cursor('t')
		local fwd = {}
		local k = cur:first()
		while k do add(fwd, num(k)); k = cur:next() end
		assert(#fwd == 5 and fwd[1] == 1 and fwd[5] == 5, cat(imap(fwd, tostring), ','))
		local bwd = {}
		k = cur:last()
		while k do add(bwd, num(k)); k = cur:prev() end
		assert(#bwd == 5 and bwd[1] == 5 and bwd[5] == 1, cat(imap(bwd, tostring), ','))
		cur:first()
		local ck, cv = cur:current()
		assert(num(ck) == 1 and num(cv) == 10, ('%s,%s'):format(S(ck), S(cv)))
		cur:close()
		db:commit()
	end)
end

function test.cursor_must_not_found()
	with_db('cursor_must_not_found', function(db)
		db:begin'w'
		db:create_table('t', {name = 't',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}},
			pk = {'id'}})
		db:commit()

		local function check(method, event, ...)
			db:begin'r'
			local cur = db:cursor't'
			local ok, err = catch('row field', cur[method], cur, ...)
			assert(not ok)
			check_row_error(err, event, 't', 'not_found')
			assert(db.txn == nil)
		end
		check('must_first', 'first')
		check('must_current', 'current')
		check('must_find', 'c_get', nil, 1)
	end)
end

--cols-format matrix: insert and get accept all four cols formats
--(nil/'a b'/'[a b]'/'{a b}') with matching value shapes.
function test.cols_format_matrix()
	with_db('cols_format_matrix', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'a', mdbx_type = 'u32', not_null = true},
			{col = 'b', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:insert('t', nil      , 1, 10, 100)            --positional scalars (all cols)
		db:insert('t', 'k a b'  , 2, 20, 200)            --positional scalars (listed)
		db:insert('t', '[k a b]', {3, 30, 300})          --positional table
		db:insert('t', '{}'     , {k = 4, a = 40, b = 400}) --named table
		assert(num(db:find('t', 'a', 1)) == 10)                       --single scalar
		local a, b = db:find('t', 'a b', 4); assert(num(a) == 40 and num(b) == 400) --scalars
		local r = db:find('t', '[a b]', 3); assert(num(r[1]) == 30 and num(r[2]) == 300) --pos table
		local g = db:find('t', '{a b}', 2); assert(num(g.a) == 20 and num(g.b) == 200) --named table
		db:commit()
	end)
end

--find/exists edges: exists returns record_exists; try_find
--hits/misses; must_find raises on miss.
function test.find_and_exists_edges()
	with_db('find_and_exists_edges', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:insert('t', '{}', {k = 1, v = 10})
		local rec = db:exists('t', 1)
		assert(rec == true, 'present row')
		local rec2 = db:exists('t', 99)
		assert(not rec2, 'missing row, present table')
		assert(db:try_find('t', 'v', 1), 'try_find hit')
		assert(db:try_find('t', 'v', 99) == false, 'try_find miss')
		assert(num(db:must_find('t', 'v', 1)) == 10)
		local ok, err = catch('row field', db.must_find, db, 't', 'v', 99)
		assert(not ok)
		check_row_error(err, 'get', 't', 'not_found')
		assert(db.txn == nil)

		db:begin'r'
		local ok, err = catch('schema', db.must_find, db, 'nope', nil, 1)
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.event == 't_open' and err.table == 'nope'
			and err.message == 'not_found', tostring(err))
		assert(db.txn == nil)
	end)
end

--put_records: batch insert of positional-table rows.
function test.put_records()
	with_db('put_records', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:put_records('t', '[]', {{1, 10}, {2, 20}, {3, 30}})
		assert(db:exists('t', 1) and db:exists('t', 2) and db:exists('t', 3))
		assert(num(db:find('t', 'v', 2)) == 20 and num(db:find('t', 'v', 3)) == 30)
		db:commit()
	end)
end

--a late batch field failure aborts atomic() and rolls back earlier records.
function test.put_records_late_failure_rolls_back()
	with_db('put_records_late_failure_rolls_back', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'utf8', maxlen = 4, not_null = true},
		}, pk = {'k'}})
		local ok, err = try_mutation(db, db.put_records,
			't', '[]', {{1, 'one'}, {2, 'two'}, {3, 'too long'}})
		assert(not ok and iserror(err, 'field'), tostring(err))
		assert(not db:exists('t', 1) and not db:exists('t', 2)
			and not db:exists('t', 3))
		db:commit()
	end)
end

--float special values round-trip bit-exactly as f32 and f64 values:
--+inf, -inf, NaN, and signed zeros (-0.0 vs +0.0).
function test.float_specials()
	with_db('float_specials', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'a' , mdbx_type = 'f32'},
			{col = 'b' , mdbx_type = 'f64'},
		}, pk = {'id'}})
		local huge = math.huge
		local cases = {
			{1,  huge,  huge},
			{2, -huge, -huge},
			{3,  0/0 ,  0/0 }, --NaN
			{4, -0.0 , -0.0 },
			{5,  0.0 ,  0.0 },
		}
		for _, c in ipairs(cases) do db:insert('t', '{}', {id = c[1], a = c[2], b = c[3]}) end
		local function chk(id, exp)
			local a = num(db:find('t', 'a', id))
			local b = num(db:find('t', 'b', id))
			if exp ~= exp then --NaN: the only value not equal to itself
				assert(a ~= a and b ~= b, 'NaN lost at id '..id)
			elseif exp == 0 then --distinguish -0 from +0 via 1/x (-inf vs +inf)
				assert(a == 0 and b == 0 and 1/a == 1/exp and 1/b == 1/exp,
					'signed zero lost at id '..id)
			else
				assert(a == exp and b == exp, 'value lost at id '..id)
			end
		end
		chk(1, huge); chk(2, -huge); chk(3, 0/0); chk(4, -0.0); chk(5, 0.0)
		db:commit()
	end)
end

--float keys order correctly, including the infinities: cursor walk is ascending
--from -inf to +inf across negatives and positives.
function test.float_key_ordering()
	with_db('float_key_ordering', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'f64', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		local huge = math.huge
		local ks = {huge, -huge, -1.5, 0.0, 1.5, -100, 100}
		for i, k in ipairs(ks) do db:insert('t', '{}', {k = k, v = i}) end
		local got = {}
		local cur = db:cursor('t')
		local k = cur:first()
		while k do add(got, num(k)); k = cur:next() end
		cur:close()
		local exp = {-huge, -100, -1.5, 0, 1.5, 100, huge}
		assert(#got == #exp, #got..' rows')
		for i = 1, #exp do
			assert(got[i] == exp[i], i..': '..tostring(got[i])..' ~= '..tostring(exp[i]))
		end
		db:commit()
	end)
end

--null vs default vs unset: an unset nullable col reads null; an unset col with a
--default reads the default (not null); update can set a col to null and back.
function test.null_vs_default()
	with_db('null_vs_default', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'opt', mdbx_type = 'u32'},                  --nullable, no default
			{col = 'def', mdbx_type = 'u32', mdbx_default = 7}, --nullable with default
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1}) --neither opt nor def given
		assert(db:is_null('t', 'opt', 1) == true , 'unset nullable -> null')
		assert(db:is_null('t', 'def', 1) == false, 'unset-with-default -> not null')
		assert(num(db:find('t', 'def', 1)) == 7   , 'default applied')
		db:insert('t', '{}', {id = 2, opt = null, def = 9}) --explicit null / value
		assert(db:is_null('t', 'opt', 2) == true)
		assert(num(db:find('t', 'def', 2)) == 9)
		db:insert('t', '{}', {id = 3, def = null})
		assert(db:is_null('t', 'def', 3) == true, 'explicit null bypasses default')
		db:insert('t', '{}', {id = 4, opt = 5})
		assert(db:is_null('t', 'opt', 4) == false and num(db:find('t', 'opt', 4)) == 5)
		db:update('t', '{}', {id = 4, opt = null}) --set to null
		assert(db:is_null('t', 'opt', 4) == true)
		db:update('t', '{}', {id = 4, opt = 8})    --and back
		assert(db:is_null('t', 'opt', 4) == false and num(db:find('t', 'opt', 4)) == 8)
		db:commit()
	end)
end

--atomic() catches row errors and preserves the surrounding transaction.
function test.atomic_row_errors()
	with_db('atomic_row_errors', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'k', mdbx_type = 'u32', not_null = true},
			{col = 'v', mdbx_type = 'u32', not_null = true},
		}, pk = {'k'}})
		db:insert('t', '{}', {k = 1, v = 10})
		local ok, err = try_mutation(db, db.insert, 't', '{}', {k = 1, v = 99})
		assert(not ok)
		check_row_error(err, 'insert', 't', 'already_exists')
		assert(num(db:find('t', 'v', 1)) == 10, 'failed insert must not overwrite')
		local ok2, err2 = try_mutation(db, db.update, 't', '{}', {k = 2, v = 20})
		assert(not ok2)
		check_row_error(err2, 'update', 't', 'not_found')
		local ok3, deleted = try_mutation(db, db.del, 't', 99)
		assert(ok3 and deleted == false)
		assert(db.txn, 'atomic row errors aborted the surrounding transaction')
		db:commit()
	end)
end

--rename a table (with a unique index and an fk) in the very txn it was created
--in: the schema rename machinery (index renames, fk cross-refs) handles a
--current-txn table now that the base rename limitation is lifted.
function test.schema_rename_created_in_same_txn()
	with_db('schema_rename_created_in_same_txn', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'pid'  , mdbx_type = 'u32' , not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'email', is_unique = true})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:rename_table('child', 'kid') --no commit in between
		assert(db:table_exists'kid' and db:table_exists'kid/email'
			and not db:table_exists'child' and not db:table_exists'child/email')
		assert_consistent(db, 'after same-txn rename')
		--enforcement intact through the renamed table
		db:insert('parent', '{}', {id = 1})
		db:insert('kid', '{}', {id = 10, pid = 1, email = 'a@x'})
		assert(try_mutation(db, db.insert, 'kid', '{}', {id = 11, pid = 99, email = 'b@x'}) == false) --fk
		assert(try_mutation(db, db.del, 'parent', 1) == false) --referenced by kid 10
		db:commit()
	end)
end

--rename a plain value column and a pk column: data is reachable by the new names
--(no rewrite), old names are gone, and it persists across reopen.
function test.rename_column_basic()
	local file = test_file('rename_column_basic'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'title', mdbx_type = 'utf8', maxlen = 16},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, title = 'hi'})
		db:rename_column('t', 'title', 'name') --value column
		db:rename_column('t', 'id', 'key')     --pk column
		assert(db:find('t', 'name', 1) == 'hi', 'value by new name')
		assert(not pcall(db.find, db, 't', 'title', 1), 'old name should be gone')
		db:insert('t', '{}', {key = 2, name = 'yo'}) --write by new names
		assert(db:find('t', 'name', 2) == 'yo')
		db:del('t', 1); assert(not db:exists('t', 1))
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'r' --persists
		assert(db:find('t', 'name', 2) == 'yo')
		local _, sch = db:dbi_schema't'
		assert(sch.fields.key and sch.fields.name and not sch.fields.id and not sch.fields.title)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--rename an indexed column: the index table (name embeds the column) is renamed,
--the index data is intact, lookups + uniqueness work by the new name, consistent.
function test.rename_column_indexed()
	local file = test_file('rename_column_indexed'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'   , mdbx_type = 'u32' , not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
			{col = 'age'  , mdbx_type = 'u32' , not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'email', is_unique = true})
		db:add_index('t', {'age'}) --non-unique
		db:insert('t', '{}', {id = 1, email = 'a@x', age = 30})
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'w' --rename loaded schema definitions
		db:rename_column('t', 'email', 'mail')
		db:rename_column('t', 'age', 'years')
		assert(db:table_exists't/mail' and not db:table_exists't/email')
		assert(db:table_exists't/years' and not db:table_exists't/age')
		assert_consistent(db, 'after rename indexed')
		--unique still enforced on the renamed column
		assert(try_mutation(db, db.insert, 't', '{}', {id = 2, mail = 'a@x', years = 9}) == false)
		--lookup via the renamed index table
		local r = db:must_find('t/mail', '{}', 'a@x')
		assert(num(r.id) == 1, S(r.id))
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'w' --persists + still enforces
		assert_consistent(db, 'reopen')
		assert(try_mutation(db, db.insert, 't', '{}', {id = 3, mail = 'a@x', years = 9}) == false)
		assert(num((db:must_find('t/mail', '{}', 'a@x')).id) == 1)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--rename a child's fk column and a parent's referenced pk column: the fk index is
--renamed, fk.cols/ref_cols follow, and enforcement keeps working, across reopen.
function test.rename_column_fk()
	local file = test_file('rename_column_fk'); cleanup(file)
	local ok, err = xpcall(function()
		local db = mdbx_open(file)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'uid', mdbx_type = 'u32', not_null = true}}, pk = {'uid'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'pid'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'uid'}}
		db:insert('parent', '{}', {uid = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:rename_column('child', 'pid', 'parent_id') --child fk column
		db:rename_column('parent', 'uid', 'user_id')  --parent referenced pk column
		assert(db:table_exists'child/parent_id' and not db:table_exists'child/pid')
		assert_consistent(db, 'after rename fk cols')
		local _, psch = db:dbi_schema'parent'
		local _, csch = db:dbi_schema'child'
		assert(not csch.fks.pid and csch.fks.parent_id)
		assert(not psch.ref_fks['child/pid'] and psch.ref_fks['child/parent_id'])
		assert(csch.fks.parent_id.cols[1] == 'parent_id', S(csch.fks.parent_id.cols))
		assert(csch.fks.parent_id.ref_cols[1] == 'user_id', S(csch.fks.parent_id.ref_cols))
		--enforcement by the new names
		assert(try_mutation(db, db.insert, 'child', '{}', {id = 11, parent_id = 99}) == false) --missing parent
		db:insert('child', '{}', {id = 12, parent_id = 1})                        --ok
		assert(try_mutation(db, db.del, 'parent', 1) == false)                                  --referenced
		db:commit(); db:close()
		db = mdbx_open(file); db:begin'w' --persists + still enforces
		assert_consistent(db, 'reopen')
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		assert(try_mutation(db, db.insert, 'child', '{}', {id = 13, parent_id = 99}) == false)
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file); assert(ok, err)
end

--add_fk validates existing data: a child row referencing a missing parent
--aborts its atomic transaction; fixing the data lets it succeed.
function test.add_fk_rejects_invalid_data()
	with_db('add_fk_rejects_invalid_data', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})   --valid
		db:insert('child', '{}', {id = 11, pid = 99})  --references missing parent
		local fk = {table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		local ok, err = try_schema(db, db.add_fk, fk)
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.message:find('fk', 1, true), tostring(err.message))
		local _, sch = db:dbi_schema'child'
		assert(not (sch.fks and sch.fks['pid']), 'fk must not be added on failure')
		assert(not db:table_exists'child/pid', 'fk index must not be created on failure')
		--fix the offending row -> now it adds, with the enforcement index.
		db:del('child', 11)
		assert(db:add_fk(fk))
		assert(db:table_exists'child/pid')
		assert(try_mutation(db, db.insert, 'child', '{}', {id = 12, pid = 99}) == false) --enforced now
		db:commit()
	end)
end

--add_fk validates the complete definition before creating its enforcement index
--or changing either table's schema graph.
function test.add_fk_validates_definition()
	with_db('add_fk_validates_definition', function(db)
		db:begin'w'
		db:create_table('parent_num', {name = 'parent_num',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('parent_text', {name = 'parent_text',
			fields = {{col = 'code', mdbx_type = 'utf8', maxlen = 8,
				nozero = true, not_null = true}}, pk = {'code'}})
		db:create_table('parent_pair', {name = 'parent_pair', fields = {
			{col = 'a', mdbx_type = 'u32', not_null = true},
			{col = 'b', mdbx_type = 'u32', not_null = true},
		}, pk = {'a', 'b'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id'        , mdbx_type = 'u32' , not_null = true},
			{col = 'pid'       , mdbx_type = 'u32' , not_null = true},
			{col = 'pid_i32'   , mdbx_type = 'i32'},
			{col = 'code'      , mdbx_type = 'utf8', maxlen = 8, nozero = true},
			{col = 'raw_ai'    , mdbx_type = 'utf8', maxlen = 8, nozero = true,
				mdbx_collation = 'utf8_ai_ci'},
			{col = 'short_code', mdbx_type = 'utf8', maxlen = 4, nozero = true},
			{col = 'padded'    , mdbx_type = 'utf8', maxlen = 8, padded = true, nozero = true},
			{col = 'zero'      , mdbx_type = 'utf8', maxlen = 8},
		}, pk = {'id'}})

		local function invalid(fk, msg)
			local ok, err = try_schema(db, db.add_fk, fk)
			assert(not ok and iserror(err, 'schema'), tostring(err))
			assert(err.message:find(msg, 1, true), tostring(err))
			local _, child = db:dbi_schema'child'
			assert(not child.fks, 'invalid fk changed child schema')
			for name in db:each_table() do
				assert(not name:starts'child/', 'invalid fk created index: '..name)
			end
			for _, name in ipairs{'parent_num', 'parent_text', 'parent_pair'} do
				local _, parent = db:dbi_schema(name)
				assert(not parent.ref_fks, 'invalid fk changed parent schema')
			end
		end
		local function fk(cols, ref_table, ref_cols, ondelete)
			return {table = 'child', cols = cols,
				ref_table = ref_table, ref_cols = ref_cols, ondelete = ondelete}
		end

		invalid(fk({}, 'parent_num', {'id'}), 'no columns')
		invalid(fk({'pid', 'pid_i32'}, 'parent_num', {'id'}), 'column count mismatch')
		invalid(fk({'pid', 'pid'}, 'parent_pair', {'a', 'b'}), 'duplicate column')
		invalid(fk({'pid'}, 'parent_num', {'nope'}), 'ref column must be pk column')
		invalid(fk({'pid_i32'}, 'parent_num', {'id'}), 'mdbx_type mismatch')
		invalid(fk({'short_code'}, 'parent_text', {'code'}), 'maxlen mismatch')
		invalid(fk({'padded'}, 'parent_text', {'code'}), 'padded mismatch')
		invalid(fk({'zero'}, 'parent_text', {'code'}), 'nozero mismatch')
		invalid(fk({'raw_ai'}, 'parent_text', {'code'}), 'mdbx_collation mismatch')
		invalid(fk({'pid'}, 'parent_num', {'id'}, 'restrict'), 'invalid ondelete')
		invalid(fk({'pid'}, 'parent_num', {'id'}, 'set null'),
			'set null column must be nullable')

		assert(db:add_fk{table = 'child', cols = {'code'},
			ref_table = 'parent_text', ref_cols = {'code'}, ondelete = 'set null',
		})
		assert(db:table_exists'child/code')
		db:commit()
	end)
end

--add_fk skips rows with null fk cols (MATCH SIMPLE), so existing nulls don't
--block adding the fk.
function test.add_fk_skips_null()
	with_db('add_fk_skips_null', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32'}, --nullable fk col
		}, pk = {'id'}})
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		db:insert('child', '{}', {id = 11, pid = null}) --null -> skipped by the check
		assert(db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}})
		assert(db:is_null('child', 'pid', 11))
		db:commit()
	end)
end

--MATCH SIMPLE on a composite fk skips validation when any component is null,
--both while adding the fk over existing rows and on later merged-row updates.
function test.composite_fk_match_simple()
	with_db('composite_fk_match_simple', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent', fields = {
			{col = 'a', mdbx_type = 'u32', not_null = true},
			{col = 'b', mdbx_type = 'u32', not_null = true},
		}, pk = {'a', 'b'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'a' , mdbx_type = 'u32'},
			{col = 'b' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:insert('parent', '{}', {a = 1, b = 1})
		db:insert('child', '{}', {id = 10, a = 1, b = 1})
		db:insert('child', '{}', {id = 11, a = null, b = 99})
		db:insert('child', '{}', {id = 12, a = 99, b = null})
		db:insert('child', '{}', {id = 13, a = null, b = null})
		assert(db:add_fk{table = 'child', cols = {'a', 'b'},
			ref_table = 'parent', ref_cols = {'a', 'b'}})

		db:insert('child', '{}', {id = 14, a = null, b = 99})
		db:insert('child', '{}', {id = 15, a = 99, b = null})
		assert(try_mutation(db, db.insert, 'child', '{}', {id = 16, a = 99, b = 99}) == false)
		db:update('child', '{}', {id = 10, a = null})
		db:update('child', '{}', {id = 10, b = 99})
		local ok, err = try_mutation(db, db.update, 'child', '{}', {id = 10, a = 99})
		assert(ok == false and is_row_error(err, 'fk'), ('%s,%s'):format(S(ok), S(err)))
		assert(db:is_null('child', 'a', 10) and num(db:find('child', 'b', 10)) == 99)
		db:commit()
	end)
end

--add_fk takes ownership of its definition table and resolves a transient index
--link, but the persisted FK definition contains only semantic attributes.
function test.add_fk_owns_definition()
	with_db('add_fk_owns_definition', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		local fk = {table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		assert(not fk.index)
		assert(db:add_fk(fk))
		local _, child = db:dbi_schema'child'
		assert(fk.name == 'pid' and fk.index.name == 'child/pid')
		assert(child.fks['pid'] == fk)
		local ok, v, v_sz = db:find_raw('$schema', 'child', #'child')
		assert(ok)
		local stored = string_buffer():set(v, v_sz):decode()
		assert(stored.fks.pid.index == nil)
		db:commit()
	end)
end

--ai_ci values retain their original text while generated index keys fold
--composed/decomposed accents and case, and reject invalid UTF-8.
function test.ai_ci_encoding_edges()
	with_db('ai_ci_encoding_edges', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 's' , mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true, mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('t', {'s'})
		db:insert('t', '{}', {id = 1, s = ''})
		db:insert('t', '{}', {id = 2, s = 'É'})
		db:insert('t', '{}', {id = 3, s = 'é'})
		db:insert('t', '{}', {id = 4, s = 'Straße'})
		assert(db:find('t', 's', 1) == '')
		assert(db:find('t', 's', 2) == 'É')
		assert(db:find('t', 's', 3) == 'é')
		assert(db:find('t', 's', 4) == 'Straße')
		assert(num((db:must_find('t/s', '{}', 'STRASSE')).id) == 4)

		local ok, err = try_mutation(db, db.find,
			't/s', '{}', string.char(0xff))
		assert(not ok and iserror(err, 'field'), tostring(err))

		db:create_table('short', {name = 'short', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 's' , mdbx_type = 'utf8', maxlen = 2,
				nozero = true, not_null = true, mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('short', {'s'})
		db:insert('short', '{}', {id = 1, s = 'É'})
		assert(num((db:must_find('short/s', '{}', 'E')).id) == 1)
		ok, err = try_mutation(db, db.insert, 'short', '{}', {id = 2, s = 'abc'})
		assert(not ok and iserror(err, 'field'),
			'maxlen was checked after folding instead of on input')

		db:create_table('key', {name = 'key', fields = {
			{col = 's' , mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true, mdbx_collation = 'utf8_ai_ci'},
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'s'}})
		db:insert('key', '{}', {s = 'É', id = 1})
		assert(db:find('key', 'id', 'E') == nil)
		db:add_index('key', {'s'})
		assert(num((db:must_find('key/s', '{}', 'E')).id) == 1)
		db:insert('key', '{}', {s = 'E', id = 2})
		assert(num(db:find('key', 'id', 'É')) == 1)
		assert(num(db:find('key', 'id', 'E')) == 2)
		db:commit()
	end)
end

--encode_ai_ci retries decomposition when the first sizing result consumes the
--whole UTF-32 buffer, leaving the spare byte required by utf8proc_reencode().
function test.ai_ci_decompose_retry()
	with_db('ai_ci_decompose_retry', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 's' , mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true, mdbx_collation = 'utf8_ai_ci'},
		}, pk = {'id'}})
		db:add_index('t', {'s'})
		local _, schema = db:dbi_schema't/s'
		local real_decompose = utf8_decompose
		local calls = 0
		utf8_decompose = function(s, len, out, cap, opt)
			calls = calls + 1
			if calls == 1 then return cap end
			return real_decompose(s, len, out, cap, opt)
		end
		local buf = new'u8[16]'
		local ok, len = pcall(schema.fields.s.encode, db, 'insert', buf, 'É')
		utf8_decompose = real_decompose
		assert(ok, len)
		assert(calls == 2 and len == 1 and str(buf, len) == 'e')
		db:abort()
	end)
end

--the 3x physical-capacity factor must remain valid for the utf8proc Unicode
--data linked into this build.
function test.ai_ci_max_expansion_factor()
	local C = ffi.load'utf8proc'
	local inp = new'u8[4]'
	local out = new'i32[256]'
	local opt = bor(UTF8_DECOMPOSE, UTF8_CASEFOLD, UTF8_STRIPMARK)
	local reaches_limit
	for cp = 0, 0x10ffff do
		if C.utf8proc_codepoint_valid(cp) then
			local inp_len = num(utf8_encode_char(cp, inp))
			local n = num(utf8_decompose(inp, inp_len, out, 256, opt))
			assertf(n >= 0 and n < 256, 'U+%04X: decompose returned %d', cp, n)
			local out_len = num(utf8_reencode(out, n, opt))
			assertf(out_len <= inp_len * 3,
				'U+%04X: ai_ci expansion %d -> %d exceeds 3x',
				cp, inp_len, out_len)
			if out_len == inp_len * 3 then reaches_limit = true end
		end
	end
	assert(reaches_limit, 'ai_ci expansion scan did not exercise the 3x limit')
end

--maxlen limits input bytes; values retain their original text while generated
--index keys have 3x capacity for the worst-case folded form.
function test.ai_ci_folded_maxlen()
	with_db_reopen('ai_ci_folded_maxlen', function(db)
		db:begin'w'
		db:create_table('val', {name = 'val', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 's' , mdbx_type = 'utf8', maxlen = 3,
				nozero = true, not_null = true, mdbx_collation = 'utf8_ai_ci'},
			{col = 'n' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('val', {'s', is_unique = true})
		db:insert('val', '{}', {id = 1, s = '각', n = 1})
		db:update('val', '{id n}', {id = 1, n = 2})
		local s = db:find('val', 's', 1)
		assert(s == '각' and #s == 3, ('%q (%d)'):format(s, #s))
		assert(num(db:find('val', 'n', 1)) == 2)
		assert(num((db:must_find('val/s', '{}', '각')).id) == 1)
		local ok, err = try_mutation(db, db.find, 'val/s', '{}', 'abcd')
		assert(not ok and iserror(err, 'field'), tostring(err))
		db:commit()
	end, function(db)
		db:begin'r'
		local s = db:find('val', 's', 1)
		assert(s == '각' and #s == 3, ('%q (%d)'):format(s, #s))
		assert(num(db:find('val', 'n', 1)) == 2)
		assert(num((db:must_find('val/s', '{}', '각')).id) == 1)
		db:commit()
	end)
end

--compiled field codecs must use the Db passed at runtime: a reusable paper
--schema must not retain the first database on which it was compiled.
function test.schema_codec_uses_runtime_db()
	local file1 = test_file('schema_codec_uses_runtime_db_1')
	local file2 = test_file('schema_codec_uses_runtime_db_2')
	cleanup(file1)
	cleanup(file2)
	local schema = {name = 't', fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 's' , mdbx_type = 'utf8', maxlen = 2},
	}, pk = {'id'}}
	local db1, db2
	local ok, err = xpcall(function()
		db1 = mdbx_open(file1)
		db1:begin'w'
		db1:create_table('t', schema)
		db1:commit()
		db1:close()

		db2 = mdbx_open(file2)
		db2:begin'w'
		db2:create_table('t', schema)
		local write_ok, write_err = pcall(db2.insert, db2, 't', '{}',
			{id = 1, s = 'abc'})
		assert(not write_ok and iserror(write_err, 'field'), tostring(write_err))
		assert(write_err.target == db2, 'codec retained the first database')
		assert(db2.txn == nil, 'field failure did not abort the transaction')
		db2:close()
	end, debug.traceback)
	if db1 and db1.env then db1:close() end
	if db2 and db2.env then db2:close() end
	cleanup(file1)
	cleanup(file2)
	assert(ok, err)
end

--DDL must mutate schemas reloaded from $schema, not caller-owned paper schemas,
--both for tables created in this transaction and existing tables opened after
--another create has made the metadata map transaction-local.
function test.ddl_does_not_mutate_paper_schema()
	local file = test_file('ddl_does_not_mutate_paper_schema')
	cleanup(file)
	local db
	local ok, err = xpcall(function()
		db = mdbx_open(file)
		db:begin'w'
		db:create_table('existing', {name = 'existing', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:commit()
		db:close()

		db = mdbx_open(file)
		local new_schema = {name = 'new', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}}
		local existing_schema = {name = 'existing', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}}
		local new_v = new_schema.fields[2]
		local existing_v = existing_schema.fields[2]
		db.schema = {tables = {existing = existing_schema}}

		db:begin'w'
		db:create_table('new', new_schema)
		db:dbi_schema'existing'
		db:without_schema(function()
			db:rename_column('new', 'v', 'new_v')
			db:rename_column('existing', 'v', 'existing_v')
		end)
		assert(new_v.col == 'v' and existing_v.col == 'v',
			fmt('new=%s existing=%s', new_v.col, existing_v.col))
		db:abort()
		db:close()
	end, debug.traceback)
	if db and db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--if without_schema() aborts after DDL changed the temporary live schema, the
--saved live_schema table must be invalidated before it is restored.
function test.without_schema_abort_invalidates_saved_cache()
	with_db('without_schema_abort_invalidates_saved_cache', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:commit()

		db.schema = mdbx_schema()
		db:begin'w'
		local _, before = db:dbi_schema't'
		assert(before.fields.v and not before.fields.v2)
		db:without_schema(function()
			db:rename_column('t', 'v', 'v2')
			db:abort()
		end)
		assert(db.txn == nil)

		db:begin'w'
		local _, after = db:dbi_schema't'
		assert(after.fields.v and not after.fields.v2)
		db:commit()
	end)
end

--an index is a public table: after reopen it must be loadable directly, before
--its value table has populated the index's transient val_schema reference.
function test.direct_index_open_after_reopen()
	with_db_reopen('direct_index_open_after_reopen', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'v'})
		db:insert('t', '{}', {id = 1, v = 10})
		db:commit()
	end, function(db)
		db:begin'r'
		local cur = db:cursor('t/v')
		local r = cur:first('{}')
		assert(num(r.id) == 1)
		cur:close()
		assert(not db:table_exists'missing')
		db:commit()
	end)
end

--building an fk index randomly decodes two variable-size child-pk fields through
--the same scratch buffer, including a descending field, plus one value field.
function test.mixed_index_descending_pk_decode()
	with_db('mixed_index_descending_pk_decode', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent', fields = {
			{col = 'a', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'c', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'b', mdbx_type = 'u32', not_null = true},
		}, pk = {'a', 'c', 'b'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'x', mdbx_type = 'u32', not_null = true},
			{col = 'a', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'c', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'b', mdbx_type = 'u32', not_null = true},
		}, pk = {'x', 'a', 'c', desc = {false, true, false}}})
		db:insert('parent', '{}', {a = 'aa', c = 'cc', b = 1})
		db:insert('parent', '{}', {a = 'bb', c = 'dd', b = 2})
		db:insert('child', '{}', {x = 10, a = 'aa', c = 'cc', b = 1})
		db:insert('child', '{}', {x = 20, a = 'bb', c = 'dd', b = 2})
		db:add_fk{table = 'child', cols = {'a', 'c', 'b'},
			ref_table = 'parent', ref_cols = {'a', 'c', 'b'}, ondelete = 'cascade'}

		local r = db:must_find('child/a,c,b', '{}', 'aa', 'cc', 1)
		assert(num(r.x) == 10 and r.a == 'aa' and r.c == 'cc' and num(r.b) == 1)
		r = db:must_find('child/a,c,b', '{}', 'bb', 'dd', 2)
		assert(num(r.x) == 20 and r.a == 'bb' and r.c == 'dd' and num(r.b) == 2)
		db:del('parent', 'aa', 'cc', 1)
		assert(not db:exists('child', 10, 'aa', 'cc'))
		assert(db:exists('child', 20, 'bb', 'dd'))
		db:commit()
	end)
end

--new-row upsert is a full write: an omitted fk column takes its default for both
--storage and FK validation.
function test.fk_default_full_write_operations()
	with_db('fk_default_full_write_operations', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', mdbx_default = 7},
		}, pk = {'id'}})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 8})
		db:insert('child', '{}', {id = 1, pid = 8})

		local ok, err = try_mutation(db, db.upsert, 'child', '{}', {id = 2})
		assert(not ok and not db:exists('child', 2))
		assert(is_row_error(err, 'fk'), tostring(err))

		db:insert('parent', '{}', {id = 7})
		db:upsert('child', '{}', {id = 2})
		assert(num(db:find('child', 'pid', 1)) == 8)
		assert(num(db:find('child', 'pid', 2)) == 7)
		db:commit()
	end)
end

--a real libmdbx commit failure must discard transaction-local DBIs/schema,
--abort all transaction levels, and clear a failed top-level txn.
function test.txn_commit_failure_discards_local_state()
	with_db('txn_commit_failure_discards_local_state', function(db)
		db:begin'w'
		db:create_table('keep', {name = 'keep',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:commit()

		db:begin'w'
		db:insert('keep', '{}', {id = 1})
		db:begin'w'
		db:create_table('temp', {name = 'temp', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('temp', {'v'})
		assert(mdbx.mdbx_txn_break(db.txn) == 0)
		assert(not pcall(db.commit, db))
		assert(db.txn == nil)
		db:begin'w'
		assert(not db:table_exists'temp' and not db:table_exists'temp/v')
		db:insert('keep', '{}', {id = 2})
		db:commit()

		db:begin'w'
		db:create_table('temp2', {name = 'temp2',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		assert(mdbx.mdbx_txn_break(db.txn) == 0)
		assert(not pcall(db.commit, db))
		assert(db.txn == nil)

		db:begin'r'
		assert(not db:exists('keep', 1) and db:exists('keep', 2))
		assert(not db:table_exists'temp' and not db:table_exists'temp/v')
		assert(not db:table_exists'temp2')
		assert_consistent(db)
		db:commit()
	end)
end

--a failed unique-index build must restore the outer txn and leave no schema
--state behind.
function test.index_build_failure_state()
	with_db('index_build_failure_state', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'   , mdbx_type = 'u32', not_null = true},
			{col = 'cat'  , mdbx_type = 'u32', not_null = true},
			{col = 'email', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, cat = 1, email = 'same'})
		db:insert('t', '{}', {id = 2, cat = 2, email = 'same'})
		local outer_txn = db.txn
		local ix_u = 't/email'
		local ok, err = try_schema(db, db.add_index,
			't', {'email', is_unique = true})
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.message == 'duplicate_key', tostring(err.message))
		assert(db.txn == outer_txn, 'failed atomic index build changed the outer txn')
		local _, schema = db:dbi_schema't'
		assert(not db:table_exists(ix_u))
		assert(not (schema.ixs and schema.ixs[ix_u]))
		assert(not schema.indexes)

		db:del('t', 2)
		local _, _, ix_n = db:add_index('t', {'cat'})
		assert(db:add_index('t', {'email', is_unique = true}))
		db:drop_index(ix_u)
		assert(db:table_exists(ix_n))

		local begins = 0
		local real_begin = db.begin
		db.begin = function(self, ...)
			begins = begins + 1
			return real_begin(self, ...)
		end
		db:insert('t', '{}', {id = 3, cat = 3, email = 'other'})
		db.begin = nil
		assert(begins == 0, begins)
		db:commit()
	end)
end

--every explicit write-column form must reject names outside the table schema;
--silently ignoring a typo turns a malformed write into a different valid write.
function test.unknown_write_columns_rejected()
	with_db('unknown_write_columns_rejected', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, v = 10})
		local accepted = {}
		local function rejected(name, f)
			if pcall(f) then add(accepted, name) end
		end
		rejected('scalar insert', function()
			db:insert('t', 'id typo', 2, 20)
		end)
		rejected('named insert', function()
			db:insert('t', '{}', {id = 3, typo = 30})
		end)
		rejected('update', function()
			db:update('t', 'id typo', 1, 40)
		end)
		local cur = db:cursor('t', 'w')
		assert(cur:first())
		rejected('cursor update', function()
			assert(cur:update('typo', 50))
		end)
		cur:close()
		rejected('put_records', function()
			db:put_records('t', '[id typo]', {{4, 60}})
		end)
		assert(#accepted == 0, 'accepted unknown columns: '..cat(accepted, ', '))
		db:commit()
	end)
end

function test.unknown_read_columns_rejected()
	with_db('unknown_read_columns_rejected', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, v = 10})
		assert(not pcall(db.find, db, 't', 'typo', 1))
		local cur = db:cursor't'
		assert(cur:first())
		assert(not pcall(cur.current, cur, 'typo'))
		cur:close()
		db:commit()
	end)
end

--an ordered child-column list identifies one fk, regardless of parent/action.
function test.duplicate_fk_columns_rejected()
	with_db('duplicate_fk_columns_rejected', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent',
			fields = {{col = 'id', mdbx_type = 'u32', not_null = true}}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		local ok, err = try_schema(db, db.add_fk, {
			table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}, ondelete = 'cascade'}
		)
		assert(not ok and err.message == 'fk already exists: pid', tostring(err))
		local _, schema = db:dbi_schema'child'
		assert(schema.fks['pid'].index.name == 'child/pid')
		assert(#schema.indexes == 1)

		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1})
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		db:drop_fk('child', 'pid')
		assert(not db:table_exists'child/pid')
		assert(try_mutation(db, db.del, 'parent', 1))
		assert(db:exists('child', 10))
		assert_consistent(db)
		db:commit()
	end)
end

--renaming a self-referencing table must update both sides of the fk and keep
--its cascade path and supporting index usable.
function test.self_referencing_fk_rename()
	with_db('self_referencing_fk_rename', function(db)
		db:begin'w'
		db:create_table('node', {name = 'node', fields = {
			{col = 'id'       , mdbx_type = 'u32', not_null = true},
			{col = 'parent_id', mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:add_fk{table = 'node', cols = {'parent_id'},
			ref_table = 'node', ref_cols = {'id'}, ondelete = 'cascade'}
		db:insert('node', '{}', {id = 1, parent_id = null})
		db:insert('node', '{}', {id = 2, parent_id = 1})
		db:rename_column('node', 'parent_id', 'owner_id')
		db:rename_table('node', 'item')

		local _, schema = db:dbi_schema'item'
		local fk = schema.fks.owner_id
		assert(fk.table == 'item' and fk.ref_table == 'item')
		assert(fk.index.name == 'item/owner_id')
		assert(schema.ref_fks['item/owner_id'])
		assert(db:table_exists'item/owner_id')
		db:del('item', 1)
		assert(not db:exists('item', 1) and not db:exists('item', 2))
		assert_consistent(db)
		db:commit()
	end)
end

--dropping a self-referencing table must not try to reopen the table after its
--DBI has already been dropped while untangling its own reverse reference.
function test.self_referencing_table_drop()
	with_db('self_referencing_table_drop', function(db)
		db:begin'w'
		db:create_table('node', {name = 'node', fields = {
			{col = 'id'       , mdbx_type = 'u32', not_null = true},
			{col = 'parent_id', mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:add_fk{table = 'node', cols = {'parent_id'},
			ref_table = 'node', ref_cols = {'id'}, ondelete = 'cascade'}
		db:commit()
		db:begin'w'
		db:rename_table('node', 'item')
		db:commit()
		db:begin'w'
		db:drop_table'item'
		assert(not db:table_exists'item')
		assert(not db:table_exists'item/parent_id')
		assert_consistent(db)
		db:commit()
	end)
end

--column rename targets must obey the same field-name grammar as initial schema
--layout; aborting each rejected rename must leave the cached schema unchanged.
function test.rename_column_validates_new_name()
	with_db('rename_column_validates_new_name', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:commit()

		local accepted = {}
		for _, new_col in ipairs{'', 'Bad', 'bad-name'} do
			db:begin'w'
			local ok, err = catch('schema', db.rename_column, db, 't', 'v', new_col)
			if ok then
				add(accepted, new_col)
			else
				assert(iserror(err, 'schema'), tostring(err))
			end
			assert(db.txn == nil, 'failed rename did not abort the transaction')
			db:begin'r'
			local _, schema = db:dbi_schema't'
			assert(schema.fields.v and not schema.fields[new_col])
			db:commit()
		end
		assert(#accepted == 0, 'accepted invalid names: '..cat(accepted, ', '))
	end)
end

--if a later index rename collides, aborting the DDL transaction must restore
--all earlier index renames, schema names, and index data.
function test.rename_column_failure_rolls_back()
	with_db('rename_column_failure_rolls_back', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'a' , mdbx_type = 'u32', not_null = true},
			{col = 'b' , mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'a'})
		db:add_index('t', {'a', 'b'})
		db:insert('t', '{}', {id = 1, a = 10, b = 20})
		db:commit()

		db:begin'w'
		db:create_table_raw't/x,b'
		local ok, err = catch('schema', db.rename_column, db, 't', 'a', 'x')
		assert(not ok, 'rename unexpectedly bypassed the index-name collision')
		assert(iserror(err, 'schema'), tostring(err))
		assert(db.txn == nil, 'failed rename did not abort the transaction')

		db:begin'r'
		local _, schema = db:dbi_schema't'
		assert(schema.fields.a and not schema.fields.x)
		assert(db:table_exists't/a' and db:table_exists't/a,b')
		assert(not db:table_exists't/x' and not db:table_exists't/x,b')
		assert(num((db:must_find('t/a', '{}', 10)).id) == 1)
		assert(num((db:must_find('t/a,b', '{}', 10, 20)).id) == 1)
		assert_consistent(db)
		db:commit()
	end)
end

--value-only restructuring rewrites records in place: explicit nulls remain
--null instead of taking a changed default, while added columns take defaults.
function test.alter_table_values_in_place()
	with_db_reopen('alter_table_values_in_place', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32', mdbx_default = 7},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, v = null})
		db:insert('t', '{}', {id = 2})
		local dbi = db:dbi_raw't'
		db:alter_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'v' , mdbx_type = 'u32', mdbx_default = 9},
			{col = 'x' , mdbx_type = 'u32', mdbx_default = 5},
		}, pk = {'id'}})
		assert(db:dbi_raw't' == dbi, 'value-only alter replaced the DBI')
		assert(db:is_null('t', 'v', 1) == true)
		assert(num(db:find('t', 'v', 2)) == 7)
		assert(num(db:find('t', 'x', 1)) == 5)
		assert(num(db:find('t', 'x', 2)) == 5)
		db:commit()
	end, function(db)
		db:begin'r'
		assert(db:is_null('t', 'v', 1) == true)
		assert(num(db:find('t', 'v', 2)) == 7)
		assert(num(db:find('t', 'x', 1)) == 5)
		db:commit()
	end)
end

--changing the PK encoding rewrites through a temporary DBI and preserves the
--table sequence, so autoincrement continues after the existing rows.
function test.alter_table_rewrites_keys()
	with_db_reopen('alter_table_rewrites_keys', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u16', not_null = true,
				auto_increment = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		local id0 = num(db:insert('t', '{}', {v = 10}))
		local id1 = num(db:insert('t', '{}', {v = 20}))
		db:alter_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true,
				auto_increment = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		assert(num(db:find('t', 'v', id0)) == 10)
		assert(num(db:find('t', 'v', id1)) == 20)
		local id2 = num(db:insert('t', '{}', {v = 30}))
		assert(id2 == id1 + 1, ('%d,%d'):format(id1, id2))
		db:commit()
	end, function(db)
		db:begin'r'
		local _, schema = db:dbi_schema't'
		assert(schema.fields.id.mdbx_type == 'u32')
		assert(num(db:find('t', 'v', 0)) == 10)
		assert(num(db:find('t', 'v', 1)) == 20)
		assert(num(db:find('t', 'v', 2)) == 30)
		db:commit()
	end)
end

--surviving user and FK indexes keep their physical data but get fresh runtime
--schemas that decode the altered base-table value layout.
function test.alter_table_rebinds_indexes()
	with_db('alter_table_rebinds_indexes', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
			{col = 'tag', mdbx_type = 'u32', not_null = true},
			{col = 'v'  , mdbx_type = 'u32'},
		}, pk = {'id'}})
		local _, _, ix = db:add_index('child', {'tag'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}
		db:insert('parent', '{}', {id = 1})
		db:insert('child', '{}', {id = 10, pid = 1, tag = 3, v = 20})

		db:alter_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
			{col = 'tag', mdbx_type = 'u32', not_null = true},
			{col = 'v'  , mdbx_type = 'u32'},
			{col = 'x'  , mdbx_type = 'u32', mdbx_default = 7},
		}, pk = {'id'}})

		db:update('child', '{v}', {id = 10, v = 30})
		local row = db:must_find(ix, '{}', 3)
		assert(num(row.v) == 30 and num(row.x) == 7)
		db:insert('child', '{}', {id = 11, pid = 1, tag = 4, v = 40})
		assert(num((db:must_find(ix, '{}', 4)).x) == 7)
		assert(try_mutation(db, db.insert, 'child', '{}',
			{id = 12, pid = 99, tag = 5}) == false)
		assert(try_mutation(db, db.del, 'parent', 1) == false)
		assert_consistent(db)
		db:commit()
	end)
end

--alter_table is only the base-table primitive: dependencies whose encoding is
--affected must be removed by the schema-diff executor before calling it.
function test.alter_table_refuses_dependencies()
	with_db('alter_table_refuses_dependencies', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
			{col = 'tag', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('child', {'tag'})
		db:add_fk{table = 'child', cols = {'pid'},
			ref_table = 'parent', ref_cols = {'id'}}

		local function refused(tab, schema, col)
			local ok, err = try_schema(db, db.alter_table, tab, schema)
			assert(not ok and iserror(err, 'schema'), tostring(err))
			assert(err.event == 't_alter' and err.table == tab, tostring(err))
			assert(err.col == col, tostring(err.col))
		end

		refused('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
			{col = 'tag', mdbx_type = 'u16', not_null = true},
		}, pk = {'id'}}, 'tag')
		refused('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u16', not_null = true},
			{col = 'tag', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}}, 'pid')
		refused('parent', {name = 'parent', fields = {
			{col = 'id', mdbx_type = 'u16', not_null = true},
		}, pk = {'id'}}, 'id')
		db:commit()
	end)
end

--a converted-key collision aborts the alter transaction and leaves the old
--table, schema, and rows intact.
function test.alter_table_key_collision_rolls_back()
	with_db('alter_table_key_collision_rolls_back', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id', mdbx_type = 'f64', not_null = true},
			{col = 'v' , mdbx_type = 'u32'},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1.2, v = 12})
		db:insert('t', '{}', {id = 1.8, v = 18})

		local ok, err = try_schema(db, db.alter_table, 't', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'u32'},
			},
			pk = {'id'},
		})
		assert(not ok and iserror(err, 'schema'), tostring(err))
		assert(err.event == 't_alter' and err.table == 't', tostring(err))
		local _, schema = db:dbi_schema't'
		assert(schema.fields.id.mdbx_type == 'f64')
		assert(num(db:find('t', 'v', 1.2)) == 12)
		assert(num(db:find('t', 'v', 1.8)) == 18)
		for name in db:each_table() do
			assert(not name:starts'$alter/', name)
		end
		db:commit()
	end)
end

-- prefix scans --------------------------------------------------------------

local function make_3col_table(db, name)
	db:create_table(name, {
		fields = {
			{col = 's1', mdbx_type = 'utf8', maxlen = 50, nozero = true, not_null = true},
			{col = 's2', mdbx_type = 'utf8', maxlen = 50, nozero = true, not_null = true},
			{col = 's3', mdbx_type = 'utf8', maxlen = 50, nozero = true, not_null = true},
			{col = 'v',  mdbx_type = 'utf8', maxlen = 50},
		},
		pk = {'s1', 's2', 's3'},
	})
	db:insert(name, nil, 'a', 'x', '1', 'ax1')
	db:insert(name, nil, 'a', 'x', '2', 'ax2')
	db:insert(name, nil, 'a', 'y', '1', 'ay1')
	db:insert(name, nil, 'b', 'x', '1', 'bx1')
	db:insert(name, nil, 'b', 'x', '2', 'bx2')
	db:insert(name, nil, 'c', 'z', '1', 'cz1')
end

function test.find_prefix_exact_match()
	with_db('find_prefix_exact_match', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local s1, s2, s3, v = cur:find_prefix(nil, 'b', 'x')
		assert(s1 == 'b' and s2 == 'x' and s3 == '1' and v == 'bx1', S(s1,s2,s3,v))
		cur:close()
		db:commit()
	end)
end

function test.find_prefix_one_col_lands_on_first_match()
	with_db('find_prefix_one_col_lands_on_first_match', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local s1, s2, s3, v = cur:find_prefix(nil, 'a')
		assert(s1 == 'a' and s2 == 'x' and s3 == '1' and v == 'ax1', S(s1,s2,s3,v))
		cur:close()
		db:commit()
	end)
end

function test.find_prefix_between_keys_is_not_found()
	with_db('find_prefix_between_keys_is_not_found', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		-- 'a','w' is between 'a','x' and nothing — 'w' < 'x' so first key >= prefix
		-- is ('a','x','1') but its prefix ('a','x') != ('a','w')
		local ok, err = cur:try_find_prefix(nil, 'a', 'w')
		assert(not ok and err == 'not_found', S(ok, err))
		cur:close()
		db:commit()
	end)
end

function test.find_prefix_past_last_is_not_found()
	with_db('find_prefix_past_last_is_not_found', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local ok, err = cur:try_find_prefix(nil, 'z')
		assert(not ok and err == 'not_found', S(ok, err))
		cur:close()
		db:commit()
	end)
end

function test.each_prefix_first_col()
	with_db('each_prefix_first_col', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local rows = {}
		for _, s1, s2, s3 in cur:each_prefix(nil, 'a') do
			rows[#rows+1] = s2..s3
		end
		cur:close()
		db:commit()
		assert(table.concat(rows, ',') == 'x1,x2,y1', table.concat(rows, ','))
	end)
end

function test.each_prefix_two_cols()
	with_db('each_prefix_two_cols', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local rows = {}
		for _, s1, s2, s3 in cur:each_prefix(nil, 'a', 'x') do
			rows[#rows+1] = s3
		end
		cur:close()
		db:commit()
		assert(table.concat(rows, ',') == '1,2', table.concat(rows, ','))
	end)
end

function test.each_prefix_no_match()
	with_db('each_prefix_no_match', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local count = 0
		for _ in cur:each_prefix(nil, 'z') do count = count + 1 end
		cur:close()
		db:commit()
		assert(count == 0)
	end)
end

function test.db_each_prefix_auto_cursor()
	with_db('db_each_prefix_auto_cursor', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local rows = {}
		for _, s1, s2, s3 in db:each_prefix('t', nil, 'b') do
			rows[#rows+1] = s2..s3
		end
		db:commit()
		assert(table.concat(rows, ',') == 'x1,x2', table.concat(rows, ','))
	end)
end

function test.each_prefix_cursor_reuse()
	with_db('each_prefix_cursor_reuse', function(db)
		db:begin'w'
		make_3col_table(db, 't')
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local result = {}
		for _, prefix in ipairs{'a', 'b', 'c', 'z'} do
			local rows = {}
			for _, s1, s2, s3 in cur:each_prefix(nil, prefix) do
				rows[#rows+1] = s2..s3
			end
			result[prefix] = table.concat(rows, ',')
		end
		cur:close()
		db:commit()
		assert(result['a'] == 'x1,x2,y1', result['a'])
		assert(result['b'] == 'x1,x2',    result['b'])
		assert(result['c'] == 'z1',        result['c'])
		assert(result['z'] == '',          result['z'])
	end)
end

function test.each_prefix_numeric_composite_pk()
	with_db('each_prefix_numeric_composite_pk', function(db)
		db:begin'w'
		db:create_table('t', {
			fields = {
				{col = 'pid', mdbx_type = 'u32', not_null = true},
				{col = 'cid', mdbx_type = 'u32', not_null = true},
				{col = 'v',   mdbx_type = 'utf8', maxlen = 20},
			},
			pk = {'pid', 'cid'},
		})
		db:insert('t', '{}', {pid=1, cid=1, v='a'})
		db:insert('t', '{}', {pid=1, cid=2, v='b'})
		db:insert('t', '{}', {pid=2, cid=1, v='c'})
		db:insert('t', '{}', {pid=2, cid=2, v='d'})
		db:insert('t', '{}', {pid=3, cid=1, v='e'})
		db:commit()
		db:begin()
		local cur = db:cursor('t')
		local vals = {}
		for _, pid, cid, v in cur:each_prefix(nil, 2) do
			vals[#vals+1] = v
		end
		cur:close()
		db:commit()
		assert(table.concat(vals, ',') == 'c,d', table.concat(vals, ','))
	end)
end

--each_current_dup starts from the cursor's current key position, covering both
--the fixedsize (DUPFIXED/u32 pk) and non-fixedsize (variable-length pk) paths.
function test.each_current_dup()
	with_db('each_current_dup', function(db)
		db:begin'w'

		--fixedsize path: u32 pk -> DUPFIXED dup values in the index
		db:create_table('t', {name = 't', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'cat', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'cat'})
		db:insert('t', '{}', {id = 1, cat = 'a'})
		db:insert('t', '{}', {id = 2, cat = 'b'})
		db:insert('t', '{}', {id = 3, cat = 'a'})
		db:insert('t', '{}', {id = 4, cat = 'b'})
		db:insert('t', '{}', {id = 5, cat = 'a'})

		local function ids_at(cur, key)
			assert(cur:try_find(nil, key))
			local t = {}
			for _, r in cur:each_current_dup('{}') do add(t, num(r.id)) end
			sort(t); return t
		end
		local cur = db:cursor('t/cat')
		assert(valeq(ids_at(cur, 'a'), {1, 3, 5}), 'fixedsize: cat=a')
		assert(valeq(ids_at(cur, 'b'), {2, 4}), 'fixedsize: cat=b')
		cur:close()

		--non-fixedsize path: utf8 pk -> variable-length dup values in the index
		db:create_table('u', {name = 'u', fields = {
			{col = 'id' , mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'cat', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('u', {'cat'})
		db:insert('u', '{}', {id = 'aa', cat = 'x'})
		db:insert('u', '{}', {id = 'bb', cat = 'y'})
		db:insert('u', '{}', {id = 'cc', cat = 'x'})

		local function sids_at(cur, key)
			assert(cur:try_find(nil, key))
			local t = {}
			for _, r in cur:each_current_dup('{}') do add(t, r.id) end
			sort(t); return t
		end
		cur = db:cursor('u/cat')
		assert(valeq(sids_at(cur, 'x'), {'aa', 'cc'}), 'non-fixedsize: cat=x')
		assert(valeq(sids_at(cur, 'y'), {'bb'}), 'non-fixedsize: cat=y')
		cur:close()
		db:commit()
	end)
end

-- triggers ------------------------------------------------------------------

--create a paper schema table with the given triggers. the table is created in
--a committed atomic (so _wtxn_end clears live_schema['t']). db.schema is set
--so the next dbi_schema() picks up the paper schema (with triggers) as the
--live schema, not the stored schema. this exercises the real paper-schema path:
--stored-schema tables (create_table without a paper schema) cannot use triggers.
local function trigger_table(db, triggers)
	local spec = {
		name = 't',
		fields = {
			{col = 'id',  mdbx_type = 'u32',  not_null = true},
			{col = 'val', mdbx_type = 'utf8', maxlen = 16},
		},
		pk = {'id'},
		triggers = triggers,
	}
	local sc = mdbx_schema()
	sc.tables['t'] = spec
	db.schema = sc
	--without_schema hides db.schema from touch_schema's assertion, clears
	--live_schema['t'] on return; next dbi_schema() loads the paper schema.
	db:atomic('w', function()
		db:without_schema(function() db:create_table('t', spec) end)
	end)
end

--all six events fire; before_insert and before_update can mutate NEW and the
--stored value reflects the mutation; after fires with the final stored values.
function test.triggers_events()
	with_db('triggers_events', function(db)
		local log = {}
		trigger_table(db, {
			before_insert = {function(db, new)
				log[#log+1] = {'bi', new.val}
				new.val = new.val and new.val:upper()
			end},
			after_insert = {function(db, new)
				log[#log+1] = {'ai', new.val}
			end},
			before_update = {function(db, old, new)
				log[#log+1] = {'bu', old.val, new.val}
				new.val = new.val and new.val:upper()
			end},
			after_update = {function(db, old, new)
				log[#log+1] = {'au', old.val, new.val}
			end},
			before_delete = {function(db, old)
				log[#log+1] = {'bd', old.val}
			end},
			after_delete = {function(db, old)
				log[#log+1] = {'ad', old.val}
			end},
		})
		db:begin'w'
		db:insert('t', '{}', {id = 1, val = 'hello'})
		db:update('t', '{}', {id = 1, val = 'world'})
		db:del('t', 1)
		assert(log[1][1] == 'bi' and log[1][2] == 'hello', log[1][2])
		assert(log[2][1] == 'ai' and log[2][2] == 'HELLO', log[2][2]) --sees mutation
		assert(log[3][1] == 'bu' and log[3][2] == 'HELLO' and log[3][3] == 'world')
		assert(log[4][1] == 'au' and log[4][2] == 'HELLO' and log[4][3] == 'WORLD')
		assert(log[5][1] == 'bd' and log[5][2] == 'WORLD')
		assert(log[6][1] == 'ad' and log[6][2] == 'WORLD')
		db:commit()
	end)
end

--multiple triggers per event fire in declaration order.
function test.triggers_order()
	with_db('triggers_order', function(db)
		local log = {}
		trigger_table(db, {
			after_insert = {
				function(db, new) log[#log+1] = 1 end,
				function(db, new) log[#log+1] = 2 end,
				function(db, new) log[#log+1] = 3 end,
			},
		})
		db:begin'w'
		db:insert('t', '{}', {id = 1, val = 'x'})
		assert(log[1] == 1 and log[2] == 2 and log[3] == 3, cat(imap(log, tostring), ','))
		db:commit()
	end)
end

--before trigger raise: write never happens.
--after trigger raise: write happens inside the txn but rolls back.
--after the first test, live_schema['t'] IS the paper schema; switching triggers
--is done by updating db.schema.tables['t'].triggers (same object).
function test.triggers_raise_aborts()
	with_db('triggers_raise_aborts', function(db)
		trigger_table(db, {
			before_insert = {function(db, new) error('before blocked') end},
		})
		local ok, err = pcall(db.atomic, db, 'w', function()
			db:insert('t', '{}', {id = 1, val = 'x'})
		end)
		assert(not ok and tostring(err):find('before blocked', 1, true), tostring(err))
		db:atomic('r', function() assert(not db:exists('t', 1)) end)
		db.schema.tables['t'].triggers = {
			after_insert = {function(db, new) error('after blocked') end},
		}
		ok, err = pcall(db.atomic, db, 'w', function()
			db:insert('t', '{}', {id = 2, val = 'y'})
		end)
		assert(not ok and tostring(err):find('after blocked', 1, true), tostring(err))
		db:atomic('r', function() assert(not db:exists('t', 2)) end)
	end)
end

--after triggers receive a live db handle and can issue writes in the same txn.
function test.triggers_after_db_write()
	with_db('triggers_after_db_write', function(db)
		local nlog = 0
		trigger_table(db, {
			after_insert = {function(db, new)
				nlog = nlog + 1
				db:insert('log', '{}', {id = nlog, msg = new.val})
			end},
			after_delete = {function(db, old)
				nlog = nlog + 1
				db:insert('log', '{}', {id = nlog, msg = 'del:'..tostring(old.val)})
			end},
		})
		db:atomic('w', function()
			db:create_table('log', {
				name = 'log',
				fields = {
					{col = 'id',  mdbx_type = 'u32',  not_null = true},
					{col = 'msg', mdbx_type = 'utf8', maxlen = 32},
				},
				pk = {'id'},
			})
		end)
		db:begin'w'
		db:insert('t', '{}', {id = 1, val = 'a'})
		db:insert('t', '{}', {id = 2, val = 'b'})
		db:del('t', 1)
		assert(db:find('log', 'msg', 1) == 'a')
		assert(db:find('log', 'msg', 2) == 'b')
		assert(db:find('log', 'msg', 3) == 'del:a')
		db:commit()
	end)
end

--recursive after-trigger writes are stopped at max_trigger_depth; txn rolls back.
function test.triggers_depth_limit()
	with_db('triggers_depth_limit', function(db)
		trigger_table(db, {
			after_insert = {function(db, new)
				db:insert('t', '{}', {id = num(new.id) + 1, val = 'r'})
			end},
		})
		local ok, err = pcall(db.atomic, db, 'w', function()
			db:insert('t', '{}', {id = 1, val = 'start'})
		end)
		assert(not ok and tostring(err):find('max depth', 1, true), tostring(err))
		db:atomic('r', function() assert(not db:exists('t', 1)) end)
	end)
end

--before/after_update trigger fires correctly via cursor update.
function test.triggers_cursor_update()
	with_db('triggers_cursor_update', function(db)
		local log = {}
		trigger_table(db, {
			before_update = {function(db, old, new)
				log[#log+1] = {'before', old.val, new.val}
			end},
			after_update = {function(db, old, new)
				log[#log+1] = {'after', old.val, new.val}
			end},
		})
		db:begin'w'
		db:insert('t', '{}', {id = 1, val = 'a'})
		local cur = db:cursor('t')
		assert(cur:try_find(nil, 1))
		cur:update('val', 'b')
		cur:close()
		assert(#log == 2, #log)
		assert(log[1][1] == 'before' and log[1][2] == 'a' and log[1][3] == 'b')
		assert(log[2][1] == 'after'  and log[2][2] == 'a' and log[2][3] == 'b')
		assert(db:find('t', 'val', 1) == 'b')
		db:commit()
	end)
end

-- generated columns ---------------------------------------------------------

--create a paper schema table with a generated column 'upper' = val:upper().
local function gen_table(db, gen_fn)
	local spec = {
		name = 't',
		fields = {
			{col = 'id',    mdbx_type = 'u32',  not_null = true},
			{col = 'val',   mdbx_type = 'utf8', maxlen = 32},
			{col = 'upper', mdbx_type = 'utf8', maxlen = 32,
			 generate = gen_fn},
		},
		pk = {'id'},
	}
	local sc = mdbx_schema()
	sc.tables['t'] = spec
	db.schema = sc
	db:atomic('w', function()
		db:without_schema(function() db:create_table('t', spec) end)
	end)
end

local function upper(db, new) return new.val and new.val:upper() end

--generated column is computed on insert; stored value is the computed result.
function test.generated_col_insert()
	with_db('generated_col_insert', function(db)
		gen_table(db, upper)
		db:begin'w'
		db:insert('t', 'id val', 1, 'hello')
		db:insert('t', 'id val', 2, 'world')
		assert(db:find('t', 'upper', 1) == 'HELLO')
		assert(db:find('t', 'upper', 2) == 'WORLD')
		db:commit()
	end)
end

--generated column recomputes on update (db:update and cur:update).
function test.generated_col_update()
	with_db('generated_col_update', function(db)
		gen_table(db, upper)
		db:begin'w'
		db:insert('t', 'id val', 1, 'hello')
		db:update('t', 'id val', 1, 'changed')
		assert(db:find('t', 'upper', 1) == 'CHANGED')
		local cur = db:cursor('t')
		assert(cur:try_find(nil, 1))
		cur:update('val', 'cursor')
		cur:close()
		assert(db:find('t', 'upper', 1) == 'CURSOR')
		db:commit()
	end)
end

--plain ix on a generated column (expression index): insert and update
--maintain the index; lookup through the index returns the correct row.
function test.generated_col_with_index()
	with_db('generated_col_with_index', function(db)
		local spec = {
			name = 't',
			fields = {
				{col = 'id',    mdbx_type = 'u32',  not_null = true},
				{col = 'email', mdbx_type = 'utf8', maxlen = 64, nozero = true, not_null = true},
				{col = 'lower', mdbx_type = 'utf8', maxlen = 64, nozero = true, not_null = true,
				 generate = function(db, new) return new.email:lower() end},
			},
			pk = {'id'},
			ixs = {['t/lower'] = {'lower', is_unique = true}},
		}
		local sc = mdbx_schema()
		sc.tables['t'] = spec
		db.schema = sc
		db:atomic('w', function()
			db:without_schema(function()
				db:create_table('t', {name='t', fields=spec.fields, pk=spec.pk})
				db:add_index('t', {'lower', is_unique = true})
			end)
		end)
		db:begin'w'
		db:insert('t', 'id email', 1, 'Alice@X.com')
		db:insert('t', 'id email', 2, 'Bob@X.com')
		db:update('t', 'id email', 2, 'Carol@X.com')
		assert(num(db:must_find('t/lower', '{}', 'alice@x.com').id) == 1)
		assert(num(db:must_find('t/lower', '{}', 'carol@x.com').id) == 2)
		assert(not db:try_find('t/lower', nil, 'bob@x.com'))
		db:commit()
	end)
end

-- table scanner ------------------------------------------------------------

local function add_table_scanner_data(db)
	db:begin'w'
	db:create_table('scan_rows', {fields = {
		{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16,
			nozero = true, not_null = true},
		{col = 'active', mdbx_type = 'bool', not_null = true},
		{col = 'score', mdbx_type = 'i32'},
	}, pk = {'tenant_id', 'id'}})
	db:add_index('scan_rows', {'status'})
	db:add_index('scan_rows', {'active'})
	db:add_index('scan_rows', {'score'})
	for _, row in ipairs{
		{tenant_id = 1, id = 1, status = 'ready', active = false},
		{tenant_id = 1, id = 2, status = 'ready', active = true,
			score = 10},
		{tenant_id = 1, id = 3, status = 'ready', active = false,
			score = 20},
		{tenant_id = 2, id = 1, status = 'ready', active = false,
			score = 30},
		{tenant_id = 2, id = 2, status = 'done', active = true},
	} do
		db:insert('scan_rows', '{}', row)
	end

	db:create_table('scan_files', {fields = {
		{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
		{col = 'path', mdbx_type = 'utf8', maxlen = 32,
			nozero = true, not_null = true},
		{col = 'status', mdbx_type = 'utf8', maxlen = 16,
			nozero = true, not_null = true},
	}, pk = {'tenant_id', 'path'}})
	db:add_index('scan_files', {'status'})
	for _, row in ipairs{
		{tenant_id = 1, path = 'a/1', status = 'ready'},
		{tenant_id = 1, path = 'a/2', status = 'ready'},
		{tenant_id = 1, path = 'b/1', status = 'ready'},
		{tenant_id = 2, path = 'a/3', status = 'ready'},
		{tenant_id = 1, path = 'a/4', status = 'done'},
	} do
		db:insert('scan_files', '{}', row)
	end
	db:commit()
end

local function table_scanner_col_decoder(db, scan, col)
	local cursor_schema = db:table_schema(scan.table)
	local base_schema = cursor_schema.val_schema or cursor_schema
	local pk_rec = cursor_schema.is_index and scan.val_rec or scan.key_rec
	return db:col_decoder(cursor_schema, col,
		cursor_schema.is_index and scan.key_rec or nil, pk_rec, function()
			if not cursor_schema.is_index then
				return scan.val_rec.data, scan.val_rec.size
			end
			local ok, data, sz = db:find_raw(base_schema.name,
				pk_rec.data, pk_rec.size)
			assert(ok)
			return data, sz
		end)
end

local function table_scanner_values(scan, get)
	local t = {}
	while scan.advance() do t[#t + 1] = get() end
	return cat(t, ',')
end

function test.table_scanner_access_paths()
	with_db('table_scanner_access_paths', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local full = db:table_scanner('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = table_scanner_col_decoder(db, full, 'tenant_id')
		local get_id = table_scanner_col_decoder(db, full, 'id')
		full.reset()
		assert(table_scanner_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1,2:2')

		local exact = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', '=', {arg = 2}},
		})
		get_id = table_scanner_col_decoder(db, exact, 'id')
		exact.reset(1, 2)
		assert(table_scanner_values(exact, get_id) == '2')
		exact.reset(9, 9)
		assert(table_scanner_values(exact, get_id) == '')

		local range = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>=', {arg = 2}, '<=', {arg = 3},
				dir = 'desc'},
		})
		get_id = table_scanner_col_decoder(db, range, 'id')
		range.reset(1, 1, 3)
		assert(table_scanner_values(range, get_id) == '3,2,1')

		local index = db:table_scanner('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, index, 'tenant_id')
		get_id = table_scanner_col_decoder(db, index, 'id')
		index.reset('ready')
		assert(table_scanner_values(index, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1')

		local status_prefix = db:table_scanner('scan_rows/status', {
			{'status', 'starts', {arg = 1}, dir = 'asc'},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, status_prefix, 'tenant_id')
		get_id = table_scanner_col_decoder(db, status_prefix, 'id')
		status_prefix.reset('rea')
		assert(table_scanner_values(status_prefix, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:2,1:3,2:1')
		status_prefix.reset('x')
		assert(table_scanner_values(status_prefix, get_id) == '')

		local groups = db:table_scanner('scan_rows/status', {
			{'status', dir = 'asc'},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_status = table_scanner_col_decoder(db, groups, 'status')
		get_tenant = table_scanner_col_decoder(db, groups, 'tenant_id')
		get_id = table_scanner_col_decoder(db, groups, 'id')
		local grouped = {}
		groups.reset()
		while groups.advance_key() do
			local pks = {get_tenant()..':'..get_id()}
			while groups.advance_pk() do
				pks[#pks + 1] = get_tenant()..':'..get_id()
			end
			grouped[#grouped + 1] = get_status()..'='..cat(pks, ',')
		end
		assert(cat(grouped, ';') == 'done=2:2;ready=1:1,1:2,1:3,2:1')

		local pk_range = db:table_scanner('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'id', 'range', '>=', {arg = 3}, '<=', {arg = 4},
				dir = 'desc'},
		})
		get_id = table_scanner_col_decoder(db, pk_range, 'id')
		pk_range.reset('ready', 1, 1, 3)
		assert(table_scanner_values(pk_range, get_id) == '3,2,1')

		local prefix = db:table_scanner('scan_files/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'path', 'starts', {arg = 3}, dir = 'desc'},
		})
		local get_path = table_scanner_col_decoder(db, prefix, 'path')
		prefix.reset('ready', 1, 'a/')
		assert(table_scanner_values(prefix, get_path) == 'a/2,a/1')
		prefix.reset('ready', 1, 'a/1')
		assert(table_scanner_values(prefix, get_path) == 'a/1')
		prefix.reset('ready', 1, 'z/')
		assert(table_scanner_values(prefix, get_path) == '')

		local prefix_asc = db:table_scanner('scan_files/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', '=', {arg = 2}},
			{'path', 'starts', {arg = 3}, dir = 'asc'},
		})
		get_path = table_scanner_col_decoder(db, prefix_asc, 'path')
		prefix_asc.reset('ready', 1, 'a/')
		assert(table_scanner_values(prefix_asc, get_path) == 'a/1,a/2')

		for _, scan in ipairs{
			full, exact, range, index, status_prefix, groups, pk_range,
			prefix, prefix_asc,
		} do
			scan.close()
		end
		db:commit()
	end)
end

function test.table_scanner_in()
	with_db('table_scanner_in', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local exact = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {arg = 'tenant_id'}},
			{'id', 'in', {value = {2, 1, 2}}},
		})
		local get_id = table_scanner_col_decoder(db, exact, 'id')
		exact.reset{tenant_id = 1}
		assert(table_scanner_values(exact, get_id) == '2,1')

		local range = db:table_scanner('scan_rows/status', {
			{'status', 'in', {value = {'done', 'ready', 'done'}}},
			{'tenant_id', '=', {arg = 'tenant_id'}},
			{'id', 'range', '>=', {value = 1}, '<=', {value = 2},
				dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, range, 'id')
		range.reset{tenant_id = 2}
		assert(table_scanner_values(range, get_id) == '2,1')
		local e = range.explain()
		assert(#e.order == 0 and e.reverse == nil)

		local dynamic = db:table_scanner('scan_rows/status', {
			{'status', 'in', {arg = 'statuses'}},
			{'tenant_id', '=', {arg = 'tenant_id'}},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, dynamic, 'id')
		local args = {statuses = {'done', 'ready'}, tenant_id = 2}
		dynamic.reset(args)
		assert(dynamic.args == args)
		assert(table_scanner_values(dynamic, get_id) == '2,1')
		assert(dynamic.args == args)
		dynamic.reset{statuses = {}, tenant_id = 2}
		assert(table_scanner_values(dynamic, get_id) == '')
		dynamic.reset{statuses = {'ready'}, tenant_id = 1}
		assert(table_scanner_values(dynamic, get_id) == '1,2,3')
		dynamic.close()
		dynamic.reset{statuses = {'done'}, tenant_id = 2}
		assert(table_scanner_values(dynamic, get_id) == '2')

		local groups = db:table_scanner('scan_rows/status', {
			{'status', 'in', {value = {'ready', 'done', 'ready'}}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_status = table_scanner_col_decoder(db, groups, 'status')
		local get_tenant = table_scanner_col_decoder(db, groups, 'tenant_id')
		get_id = table_scanner_col_decoder(db, groups, 'id')
		local grouped = {}
		groups.reset()
		while groups.advance_key() do
			local pks = {get_tenant()..':'..get_id()}
			while groups.advance_pk() do
				pks[#pks + 1] = get_tenant()..':'..get_id()
			end
			grouped[#grouped + 1] = get_status()..'='..cat(pks, ',')
		end
		assert(cat(grouped, ';')
			== 'ready=1:1,1:2,1:3,2:1;done=2:2')

		local nullable = db:table_scanner('scan_rows/score', {
			{'score', 'in', {value = {null, 10, null}}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, nullable, 'tenant_id')
		get_id = table_scanner_col_decoder(db, nullable, 'id')
		nullable.reset()
		assert(table_scanner_values(nullable, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,2:2,1:2')

		local bool = db:table_scanner('scan_rows/active', {
			{'active', 'in', {value = {false, true, false}}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, bool, 'tenant_id')
		get_id = table_scanner_col_decoder(db, bool, 'id')
		bool.reset()
		assert(table_scanner_values(bool, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1,1:2,2:2')

		for _, scan in ipairs{
			exact, range, dynamic, groups, nullable, bool,
		} do
			scan.close()
		end
		db:commit()
	end)
end

function test.table_scanner_in_left_join()
	with_db('table_scanner_in_left_join', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local outer = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {value = 2}},
			{'id', dir = 'asc'},
		})
		local inner = db:table_scanner('scan_rows/status', {
			{'status', 'in', {arg = 'statuses'}},
			{'tenant_id', '=', {scan = outer, col = 'tenant_id'}},
			{'id', '=', {scan = outer, col = 'id'}},
		})
		local left = db:left_join_scans(outer, inner)
		local get_outer_id = table_scanner_col_decoder(db, outer, 'id')
		local get_inner_id = table_scanner_col_decoder(db, inner, 'id')
		local ids = {}
		left.reset{statuses = {'ready', 'ready'}}
		while left.advance() do
			ids[#ids + 1] = get_outer_id()..':'
				..(inner.row_found and get_inner_id() or '-')
		end
		assert(cat(ids, ',') == '1:1,2:-')

		left.close()
		db:commit()
	end)
end

function test.table_scanner_max_bounds()
	with_db('table_scanner_max_bounds', function(db)
		db:begin'w'
		db:create_table('scan_max', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:insert('scan_max', 'id', 1)
		db:insert('scan_max', 'id', 0xffffffff)
		db:commit()
		db:begin'r'

		local gt = db:table_scanner('scan_max', {
			{'id', '>', {arg = 1}},
		})
		local get_id = table_scanner_col_decoder(db, gt, 'id')
		gt.reset(0xffffffff)
		assert(table_scanner_values(gt, get_id) == '')

		local le = db:table_scanner('scan_max', {
			{'id', '<=', {arg = 1}},
		})
		get_id = table_scanner_col_decoder(db, le, 'id')
		le.reset(0xffffffff)
		assert(table_scanner_values(le, get_id) == '1,4294967295')

		gt.close()
		le.close()
		db:commit()
	end)
end

function test.table_scanner_descending_ranges()
	with_db('table_scanner_descending_ranges', function(db)
		db:begin'w'
		db:create_table('scan_desc', {fields = {
			{col = 'tenant_id', mdbx_type = 'u32', not_null = true},
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {
			'tenant_id', 'id', desc = {false, true},
		}})
		db:add_index('scan_desc', {'status'})
		for _, row in ipairs{
			{1, 1, 'ready'},
			{1, 2, 'ready'},
			{1, 3, 'ready'},
			{1, 4, 'ready'},
			{2, 2, 'ready'},
		} do
			db:insert('scan_desc', 'tenant_id id status', unpack(row))
		end
		db:commit()
		db:begin'r'

		local full = db:table_scanner('scan_desc', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'desc'},
		})
		local get_tenant = table_scanner_col_decoder(db, full, 'tenant_id')
		local get_id = table_scanner_col_decoder(db, full, 'id')
		full.reset()
		assert(table_scanner_values(full, function()
			return get_tenant()..':'..get_id()
		end) == '1:4,1:3,1:2,1:1,2:2')

		local reverse = db:table_scanner('scan_desc', {
			{'tenant_id', dir = 'desc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, reverse, 'tenant_id')
		get_id = table_scanner_col_decoder(db, reverse, 'id')
		reverse.reset()
		assert(table_scanner_values(reverse, function()
			return get_tenant()..':'..get_id()
		end) == '2:2,1:1,1:2,1:3,1:4')

		for _, range_test in ipairs{
			{{'id', '>', {arg = 1}, dir = 'desc'}, {2}, '4,3'},
			{{'id', '>=', {arg = 1}, dir = 'desc'}, {2}, '4,3,2'},
			{{'id', '<', {arg = 1}, dir = 'desc'}, {3}, '2,1'},
			{{'id', '<=', {arg = 1}, dir = 'desc'}, {3}, '3,2,1'},
			{{'id', 'range', '>', {arg = 1}, '<=', {arg = 2},
				dir = 'desc'}, {1, 3}, '3,2'},
			{{'id', 'range', '>=', {arg = 1}, '<', {arg = 2},
				dir = 'desc'}, {1, 3}, '2,1'},
			{{'id', '>', {arg = 1}, dir = 'desc'}, {4}, ''},
			{{'id', '<=', {arg = 1}, dir = 'desc'}, {0}, ''},
			{{'id', 'range', '>=', {arg = 1}, '<=', {arg = 2},
				dir = 'desc'}, {3, 2}, ''},
		} do
			local term, args, expected = unpack(range_test, 1, 3)
			local scan = db:table_scanner('scan_desc', {
				{'tenant_id', '=', {value = 1}},
				term,
			})
			get_id = table_scanner_col_decoder(db, scan, 'id')
			scan.reset(unpack(args))
			assert(table_scanner_values(scan, get_id) == expected)
			scan.close()
		end

		local pk_range = db:table_scanner('scan_desc/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>', {arg = 2}, '<=', {arg = 3},
				dir = 'desc'},
		})
		get_id = table_scanner_col_decoder(db, pk_range, 'id')
		pk_range.reset(1, 1, 3)
		assert(table_scanner_values(pk_range, get_id) == '3,2')

		local pk_range_asc = db:table_scanner('scan_desc/status', {
			{'status', '=', {value = 'ready'}},
			{'tenant_id', '=', {arg = 1}},
			{'id', 'range', '>', {arg = 2}, '<=', {arg = 3},
				dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, pk_range_asc, 'id')
		pk_range_asc.reset(1, 1, 3)
		assert(table_scanner_values(pk_range_asc, get_id) == '2,3')

		full.close()
		reverse.close()
		pk_range.close()
		pk_range_asc.close()
		db:commit()
	end)
end

function test.table_scanner_nil_null_and_false()
	with_db('table_scanner_nil_null_and_false', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local active = db:table_scanner('scan_rows/active', {
			{'active', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = table_scanner_col_decoder(db, active, 'tenant_id')
		local get_id = table_scanner_col_decoder(db, active, 'id')
		active.reset(false)
		assert(table_scanner_values(active, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1')

		local score = db:table_scanner('scan_rows/score', {
			{'score', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_tenant = table_scanner_col_decoder(db, score, 'tenant_id')
		get_id = table_scanner_col_decoder(db, score, 'id')
		local function null_pks()
			return table_scanner_values(score, function()
				return get_tenant()..':'..get_id()
			end)
		end
		score.reset(nil)
		assert(null_pks() == '1:1,2:2')
		score.reset(null)
		assert(null_pks() == '1:1,2:2')

		active.close()
		score.close()
		db:commit()
	end)
end

function test.table_scanner_column_refs()
	with_db('table_scanner_column_refs', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local outer = db:table_scanner('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		outer.reset()
		assert(outer.advance())

		local same_status = db:table_scanner('scan_rows/status', {
			{'status', '=', {
				table = 'scan_rows', col = 'status',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_id = table_scanner_col_decoder(db, same_status, 'id')
		same_status.reset()
		assert(table_scanner_values(same_status, get_id) == '1,2,3,1')

		local same_active = db:table_scanner('scan_rows/active', {
			{'active', '=', {
				table = 'scan_rows', col = 'active',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_tenant = table_scanner_col_decoder(db, same_active,
			'tenant_id')
		get_id = table_scanner_col_decoder(db, same_active, 'id')
		same_active.reset()
		assert(table_scanner_values(same_active, function()
			return get_tenant()..':'..get_id()
		end) == '1:1,1:3,2:1')

		assert(outer.advance())
		same_active.reset()
		assert(table_scanner_values(same_active, function()
			return get_tenant()..':'..get_id()
		end) == '1:2,2:2')

		local same_pk = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {
				table = 'scan_rows', col = 'tenant_id',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'id', '=', {
				table = 'scan_rows', col = 'id',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
		})
		get_id = table_scanner_col_decoder(db, same_pk, 'id')
		same_pk.reset()
		assert(table_scanner_values(same_pk, get_id) == '2')

		local id_scan = db:table_scanner('scan_rows', {
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		id_scan.reset()
		assert(id_scan.advance())
		assert(id_scan.advance())
		assert(id_scan.advance())
		local tenant_id_scan = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {
				table = 'scan_rows', col = 'tenant_id',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'id', '=', {
				table = 'scan_rows', col = 'id',
				key_rec = id_scan.key_rec, val_rec = id_scan.val_rec,
			}},
		})
		get_id = table_scanner_col_decoder(db, tenant_id_scan, 'id')
		tenant_id_scan.reset()
		assert(table_scanner_values(tenant_id_scan, get_id) == '3')

		local same_score = db:table_scanner('scan_rows/score', {
			{'score', '=', {
				table = 'scan_rows', col = 'score',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, same_score, 'id')
		same_score.reset()
		assert(table_scanner_values(same_score, get_id) == '2')
		same_score.reset()
		assert(same_score.advance())
		local index_score = db:table_scanner('scan_rows/score', {
			{'score', '=', {
				table = 'scan_rows/score', col = 'score',
				key_rec = same_score.key_rec, val_rec = same_score.val_rec,
			}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, index_score, 'id')
		index_score.reset()
		assert(table_scanner_values(index_score, get_id) == '2')
		outer.reset()
		assert(outer.advance())
		same_score.reset()
		assert(table_scanner_values(same_score, get_id) == '')

		outer.close()
		same_status.close()
		same_active.close()
		same_pk.close()
		id_scan.close()
		tenant_id_scan.close()
		same_score.close()
		index_score.close()
		db:commit()
	end)
end

--a correlated param whose source column has a different (but decodable)
--layout than the output key field: the raw-bytes path can't be used, so the
--source is decoded and re-encoded through the output field.
function test.table_scanner_incompatible_decode()
	with_db('table_scanner_incompatible_decode', function(db)
		db:begin'w'
		--source cols are utf8 maxlen 8; dest index cols are utf8 maxlen 16.
		db:create_table('src', {fields = {
			{col = 'tag', mdbx_type = 'utf8', maxlen = 8,
				nozero = true, not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 8,
				nozero = true, not_null = true},
		}, pk = {'tag'}})
		db:insert('src', '{}', {tag = 'x', name = 'foo'})

		db:create_table('dst', {fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'tag', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 16,
				nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('dst', {'tag'})
		db:add_index('dst', {'name'})
		for _, row in ipairs{
			{id = 1, tag = 'x', name = 'foo'},
			{id = 2, tag = 'x', name = 'bar'},
			{id = 3, tag = 'y', name = 'foo'},
		} do
			db:insert('dst', '{}', row)
		end
		db:commit()
		db:begin'r'

		local outer = db:table_scanner('src', {{'tag', dir = 'asc'}})
		outer.reset()
		assert(outer.advance())

		--key-column source: src.tag (key_rec) -> dst/tag key (is_key_read).
		local by_tag = db:table_scanner('dst/tag', {
			{'tag', '=', {
				table = 'src', col = 'tag',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'id', dir = 'asc'},
		})
		local get_id = table_scanner_col_decoder(db, by_tag, 'id')
		by_tag.reset()
		assert(table_scanner_values(by_tag, get_id) == '1,2')

		--value-column source: src.name (val_rec) -> dst/name key.
		local by_name = db:table_scanner('dst/name', {
			{'name', '=', {
				table = 'src', col = 'name',
				key_rec = outer.key_rec, val_rec = outer.val_rec,
			}},
			{'id', dir = 'asc'},
		})
		get_id = table_scanner_col_decoder(db, by_name, 'id')
		by_name.reset()
		assert(table_scanner_values(by_name, get_id) == '1,3')

		outer.close()
		by_tag.close()
		by_name.close()
		db:commit()
	end)
end

function test.table_scanner_reuse()
	with_db('table_scanner_reuse', function(db)
		add_table_scanner_data(db)
		db:begin'r'
		local scan = db:table_scanner('scan_rows/status', {
			{'status', '=', {arg = 1}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local get_id = table_scanner_col_decoder(db, scan, 'id')

		scan.reset('ready')
		assert(scan.advance() and get_id() == 1)
		scan.reset('done')
		assert(table_scanner_values(scan, get_id) == '2')
		scan.close()
		scan.reset('ready')
		assert(scan.advance() and get_id() == 1)
		scan.close()
		db:commit()

		db:begin'r'
		scan.reset('done')
		assert(table_scanner_values(scan, get_id) == '2')
		scan.close()
		db:commit()
	end)
end

function test.table_scanner_join()
	with_db('table_scanner_join', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local outer = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {arg = 1}},
			{'id', dir = 'asc'},
		})
		local inner = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {
				scan = outer, col = 'tenant_id',
			}},
			{'id', '=', {
				scan = outer, col = 'id',
			}},
		})
		local join = db:join_scans(outer, inner)
		local get_outer_id = table_scanner_col_decoder(db, outer, 'id')
		local get_inner_id = table_scanner_col_decoder(db, inner, 'id')

		local function ids(tenant_id)
			local t = {}
			join.reset(tenant_id)
			while join.advance() do
				t[#t + 1] = get_outer_id()..':'..get_inner_id()
			end
			return cat(t, ',')
		end
		assert(ids(1) == '1:1,2:2,3:3')
		assert(ids(2) == '1:1,2:2')

		join.close()
		db:commit()
	end)
end

function test.table_scanner_left_join()
	with_db('table_scanner_left_join', function(db)
		add_table_scanner_data(db)
		db:begin'r'

		local outer = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {value = 1}},
			{'id', dir = 'asc'},
		})
		local child = db:table_scanner('scan_rows/score', {
			{'score', '=', {scan = outer, col = 'score'}},
			{'tenant_id', dir = 'asc'},
			{'id', dir = 'asc'},
		})
		local grandchild = db:table_scanner('scan_rows', {
			{'tenant_id', '=', {scan = outer, col = 'tenant_id'}},
			{'id', '=', {scan = child, col = 'id'}},
		})
		local left = db:left_join_scans(outer, child)
		local get_outer_id = table_scanner_col_decoder(db, outer, 'id')
		local get_child_id = table_scanner_col_decoder(db, child, 'id')
		local get_grandchild_id =
			table_scanner_col_decoder(db, grandchild, 'id')

		local t = {}
		left.reset()
		while left.advance() do
			local child_id = child.row_found and get_child_id() or '-'
			t[#t + 1] = get_outer_id()..':'..child_id
		end
		assert(cat(t, ',') == '1:-,2:2,3:3')

		local join = db:join_scans(left, grandchild, {outer, child})
		clear(t)
		join.reset()
		while join.advance() do
			assert(child.row_found)
			assert(grandchild.row_found)
			t[#t + 1] = get_outer_id()..':'..get_child_id()
				..':'..get_grandchild_id()
		end
		assert(cat(t, ',') == '2:2:2,3:3:3')

		local left_join = db:left_join_scans(left, grandchild, {outer, child})
		clear(t)
		left_join.reset()
		while left_join.advance() do
			local child_id =
				child.row_found and get_child_id() or '-'
			local grandchild_id =
				grandchild.row_found and get_grandchild_id() or '-'
			t[#t + 1] = get_outer_id()..':'..child_id..':'..grandchild_id
		end
		assert(cat(t, ',') == '1:-:-,2:2:2,3:3:3')

		local nested_child = db:child_scan(outer, child)
		local nested_grandchild = db:child_scan(nested_child, grandchild)
		clear(t)
		for outer_scan in outer:rows() do
			for child_scan in nested_child:left_rows(outer_scan) do
				for grandchild_scan in nested_grandchild:left_rows(child_scan) do
					local child_id =
						nested_child.row_found and get_child_id() or '-'
					local grandchild_id =
						nested_grandchild.row_found
							and get_grandchild_id() or '-'
					t[#t + 1] = get_outer_id()..':'..child_id
						..':'..grandchild_id
				end
			end
		end
		assert(cat(t, ',') == '1:-:-,2:2:2,3:3:3')

		left_join.close()
		db:commit()
	end)
end

------------------------------------------------------------------------------

local name = ...
if name == 'mdbx_schema_test' then name = nil end
local tests = name and {name} or test
local n_ok, n_fail = 0, 0
for _, k in ipairs(tests) do
	io.write('test.'..k..' ... ')
	io.flush()
	local ok, err = xpcall(test[k], debug.traceback)
	if ok then
		print'ok'
		n_ok = n_ok + 1
	else
		print'FAILED'
		print(err)
		n_fail = n_fail + 1
		break
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))
if n_fail > 0 then os.exit(1) end
