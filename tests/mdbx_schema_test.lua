--go@ plink -t root@m1 sdk/bin/debian12/luajit sdk/tests/mdbx_schema_test.lua

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

-- numeric keys and values ---------------------------------------------------

--ascending value lists per type, as exact-typed cdata so encode/decode is
--checked with exact == (no FP/precision surprises). lists are sorted ascending.
local num_vals = {
	u8  = {0, 1, 2, 0xff},
	u16 = {0, 1, 2, 0xffff},
	u32 = {0, 1, 2, 0xffffffff},
	u64 = {0ULL, 1, 2, 0xffffffffffffffffULL},
	i8  = {-128, -2, -1, 0, 1, 2, 127},
	i16 = {-32768, -2, -1, 0, 1, 2, 32767},
	i32 = {-2147483648, -2, -1, 0, 1, 2, 2147483647},
	i64 = {cast('int64_t', 0x8000000000000000ULL), -2, -1, 0, 1, 2, 0x7fffffffffffffffLL},
	f32 = {cast('float', -1e9), -2, -1, cast('float', -0.5), 0, cast('float', 0.5), 1, 2, cast('float', 1e9)},
	f64 = {-1e15, -2, -1, -0.5, 0, 0.5, 1, 2, 1e15},
}

--single numeric key + two numeric vals at fixed offsets, asc and desc.
--checks: value round-trip and key ordering for every scalar type.
function test.numeric_keys_and_values()
	with_db('numeric_keys_and_values', function(db)
		db:begin'w'
		for typ in words'u8 u16 u32 u64 i8 i16 i32 i64 f32 f64' do
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
					{col = 's', mdbx_type = 'utf8', maxlen = 100, not_null = true},
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
					{col = 's1', mdbx_type = 'utf8', maxlen = 100, not_null = true},
					{col = 's2', mdbx_type = 'utf8', maxlen = 100, not_null = true},
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
			local s3, s4 = db:get(name, 's3 s4', 'xx', 'y')
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
				{col = 'id', mdbx_type = 'u64', not_null = true},
				{col = 's1', mdbx_type = 'utf8', maxlen = 8},
				{col = 'a' , mdbx_type = 'u8'  , maxlen = 4, padded = true},
				{col = 's2', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s1 = 'hello', a = {10,20,30,40}, s2 = 'world'})
		local r = db:get('t', '{s1 a s2}', 1)
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
		assert(valeq(db:get('t', 'a', 1), {100,200,300}), S(db:get('t','a',1)))
		assert(valeq(db:get('t', 'a', 2), {}), S(db:get('t','a',2)))
		assert(valeq(db:get('t', 'a', 3), {1,2,3,4}), S(db:get('t','a',3)))
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
		assert(db:get('t', 'num', 1) == -7)
		assert(db:is_null('t', 'num', 1) == false)
		assert(db:get('t', 'num', 2) == nil)
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
			local g = db:get('t', '{num s1 s2 s3}', r.id)
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
		assert(db:get('t', 's', 1) == '')
		assert(db:get('t', 's', 2) == 'hi')
		db:commit()
	end)
end

--values longer than maxlen are truncated on write.
function test.value_truncation()
	with_db('value_truncation', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 's' , mdbx_type = 'utf8', maxlen = 4},
			},
			pk = {'id'},
		})
		db:insert('t', '{}', {id = 1, s = 'abcdefgh'})
		assert(db:get('t', 's', 1) == 'abcd', S(db:get('t','s',1)))
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
				{col = 'id' , mdbx_type = 'u64', not_null = true},
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
		local r = db:get('t', '{num a s}', 1)
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
				{col = 'b', mdbx_type = 'utf8', maxlen = 8, not_null = true},
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
		assert(db:get('t', 'v', 1, 'aa') == '1aa')
		db:commit()
	end)
end

--varsize keys are 0-terminated, so they are NOT 8-bit clean: an embedded \0
--truncates the key. this pins that documented limitation.
function test.key_embedded_zero_truncation()
	with_db('key_embedded_zero_truncation', function(db)
		db:begin'w'
		db:create_table('t', {
			name = 't',
			fields = {
				{col = 'k', mdbx_type = 'utf8', maxlen = 16, not_null = true},
				{col = 'v', mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'k'},
		})
		db:insert('t', '{}', {k = 'a\0b', v = 'first'})
		--stored key is 'a'; lookups by 'a' or any 'a\0...' hit the same record.
		assert(db:get('t', 'v', 'a') == 'first')
		assert(db:get('t', 'v', 'a\0c') == 'first')
		local n = 0
		for cur, k in db:each('t') do n = n + 1; assert(k == 'a', S(k)) end
		assert(n == 1)
		db:commit()
	end)
end

--utf8_ai_ci collation is not implemented yet: declaring it must fail fast at
--table creation (compile) with a clear message, not corrupt or crash later.
function test.ai_ci_collation_not_implemented()
	with_db('ai_ci_collation_not_implemented', function(db)
		db:begin'w'
		local ok, err = pcall(function()
			db:create_table('t', {
				name = 't',
				fields = {
					{col = 'id', mdbx_type = 'u32', not_null = true},
					{col = 's' , mdbx_type = 'utf8', maxlen = 16, mdbx_collation = 'utf8_ai_ci'},
				},
				pk = {'id'},
			})
		end)
		assert(not ok)
		assert(tostring(err):find('utf8_ai_ci collation not implemented', 1, true), tostring(err))
		db:abort()
	end)
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
		local g = db:get('t', '{a b c}', 1)
		assert(num(g.a) == 20 and g.b == 'x' and num(g.c) == 5,
			('%s,%s,%s'):format(S(g.a), S(g.b), S(g.c)))

		--update multiple cols (name mapping must be correct, not positional)
		db:update('t', '{}', {id = 1, b = 'y', c = 9})
		g = db:get('t', '{a b c}', 1)
		assert(num(g.a) == 20 and g.b == 'y' and num(g.c) == 9)

		--null sets a value to null; nil would skip
		db:update('t', '{}', {id = 1, a = null})
		assert(db:get('t', 'a', 1) == nil)
		assert(db:is_null('t', 'a', 1) == true)
		g = db:get('t', '{b c}', 1)
		assert(g.b == 'y' and num(g.c) == 9) --others preserved

		--update a missing row -> false,'not_found'
		local ok, err = db:try_update('t', '{}', {id = 2, a = 1})
		assert(ok == false and err == 'not_found', ('%s,%s'):format(S(ok), S(err)))

		--upsert inserts when missing
		db:upsert('t', '{}', {id = 2, a = 7, b = 'u', c = 1})
		g = db:get('t', '{a b c}', 2)
		assert(num(g.a) == 7 and g.b == 'u' and num(g.c) == 1)

		--upsert updates when existing (partial preserve)
		db:upsert('t', '{}', {id = 2, b = 'uu'})
		g = db:get('t', '{a b c}', 2)
		assert(num(g.a) == 7 and g.b == 'uu' and num(g.c) == 1)

		db:commit()
	end)
end

-- delete --------------------------------------------------------------------

--del removes a row by pk, leaving others intact; deleting a missing row
--returns false,'not_found'.
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
		db:del('t', 2)
		assert(not db:exists('t', 2))
		assert(db:exists('t', 1) and db:exists('t', 3))
		assert(db:get('t', 'v', 2) == nil)
		local ids = {}
		for cur, id in db:each('t') do add(ids, num(id)) end
		assert(#ids == 2 and ids[1] == 1 and ids[2] == 3)
		--deleting a missing row -> false,'not_found'
		local ok, err = db:try_del('t', 2)
		assert(ok == false and err == 'not_found', ('%s,%s'):format(S(ok), S(err)))
		db:commit()
	end)
end

--del_exact removes a row, and returns false,'not_found' for a missing one.
function test.del_exact()
	with_db('del_exact', function(db)
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
		db:insert('t', '{}', {id = 2, v = 20})
		db:del_exact('t', '{}', {id = 1, v = 10})
		assert(not db:exists('t', 1))
		assert(db:exists('t', 2))
		local ok, err = db:del_exact('t', '{}', {id = 1, v = 10})
		assert(ok == false and err == 'not_found', ('%s,%s'):format(S(ok), S(err)))
		db:commit()
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
		local got = {}
		for cur, b in db:each_reverse('t', 'b') do add(got, b) end
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
		local cur = db:cursor('t', 'w')
		assert(cur:try_get(nil, 2)) --position on id=2
		local ok = cur:update('{a b}', {a = 99, b = 'YY'})
		assert(ok == true, S(ok))
		cur:close()
		local g = db:get('t', '{a b}', 2)
		assert(num(g.a) == 99 and g.b == 'YY', ('%s,%s'):format(S(g.a), S(g.b)))
		local g1 = db:get('t', '{a b}', 1) --row 1 unchanged
		assert(num(g1.a) == 10 and g1.b == 'x')
		db:commit()
	end)
end

-- schema validation ---------------------------------------------------------

--a stored schema validated against a matching paper schema passes; against a
--diverging one it returns false with a 'schema mismatch' message (no crash).
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
		db:begin()
		assert(db:open_table('t', nil, {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'i32'},
			},
			pk = {'id'},
		}))
		db:commit(); db:close()

		--diverging paper schema (v: i32 -> utf8) -> validation error, no crash
		db = mdbx_open(file)
		db:begin()
		local dbi, e = db:try_open_table('t', nil, {
			name = 't',
			fields = {
				{col = 'id', mdbx_type = 'u32', not_null = true},
				{col = 'v' , mdbx_type = 'utf8', maxlen = 8},
			},
			pk = {'id'},
		})
		assert(not dbi)
		assert(tostring(e):find('schema mismatch', 1, true), tostring(e))
		db:commit(); db:close()
	end, debug.traceback)
	cleanup(file)
	assert(ok, err)
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
