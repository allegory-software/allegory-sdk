require'mdbx_query'

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_mdbx_query_test_'..name..'_'..uuid()..'.mdb'
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

--deep-equal for scalars, strings and array tables (treats nil == nil).
local function valeq(a, b)
	if istab(a) and istab(b) then
		if #a ~= #b then return false end
		for i=1,#a do if a[i] ~= b[i] then return false end end
		return true
	end
	return a == b
end

--pk_seek/pk_and/pk_or/pk_except compose PK-level nodes into arbitrary predicate
--trees; fetch() bridges to base-table row bundles. col3 is non-indexed to prove
--fetch goes to the base table, not just the index cursor.
function test.pk_nodes()
	with_db('pk_nodes', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'col2', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'col3', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:add_index('t', {'col2'})
		db:insert('t', '{}', {id = 1, col1 = 'a', col2 = 'x', col3 = 'p'})
		db:insert('t', '{}', {id = 2, col1 = 'a', col2 = 'y', col3 = 'q'})
		db:insert('t', '{}', {id = 3, col1 = 'b', col2 = 'x', col3 = 'r'})
		db:insert('t', '{}', {id = 4, col1 = 'b', col2 = 'y', col3 = 's'})
		db:insert('t', '{}', {id = 5, col1 = 'a', col2 = 'x', col3 = 't'})

		local function rows(iter)
			local ids, col3s = {}, {}
			for bundle in iter do
				local r = bundle.t:current('{}')
				add(ids, num(r.id)); add(col3s, r.col3)
			end
			sort(ids); sort(col3s); return ids, col3s
		end

		--pk_seek: single index seek; col3 accessible (fetch hits base table)
		local ids, col3s = rows(db:pk_seek('t/col1', 'a'):fetch():iter())
		assert(valeq(ids,   {1, 2, 5}),       'seek a: ids')
		assert(valeq(col3s, {'p', 'q', 't'}), 'seek a: col3 from base table')
		assert(valeq((rows(db:pk_seek('t/col1', 'c'):fetch():iter())), {}), 'seek empty')

		--pk_and: intersection; same results as each_and
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_and(db:pk_seek('t/col2', 'x')):fetch():iter())), {1, 5}), 'and a+x')
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_and(db:pk_seek('t/col2', 'y')):fetch():iter())), {2}),    'and a+y')
		assert(valeq((rows(db:pk_seek('t/col1', 'b'):pk_and(db:pk_seek('t/col2', 'x')):fetch():iter())), {3}),    'and b+x')
		assert(valeq((rows(db:pk_seek('t/col1', 'c'):pk_and(db:pk_seek('t/col2', 'x')):fetch():iter())), {}),     'and left empty')
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_and(db:pk_seek('t/col2', 'z')):fetch():iter())), {}),     'and right empty')

		--pk_or: union with dedup; same results as each_or
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_or(db:pk_seek('t/col2', 'x')):fetch():iter())), {1, 2, 3, 5}), 'or a|x')
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_or(db:pk_seek('t/col2', 'y')):fetch():iter())), {1, 2, 4, 5}), 'or a|y')
		assert(valeq((rows(db:pk_seek('t/col1', 'c'):pk_or(db:pk_seek('t/col2', 'x')):fetch():iter())), {1, 3, 5}),    'or left empty')
		assert(valeq((rows(db:pk_seek('t/col1', 'c'):pk_or(db:pk_seek('t/col2', 'z')):fetch():iter())), {}),            'or both empty')

		--pk_except: difference; not expressible with old API
		--col1='a'={1,2,5}, col2='x'={1,3,5} -> except={2}
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_except(db:pk_seek('t/col2', 'x')):fetch():iter())), {2}), 'except a-x')
		--col1='b'={3,4}, col2='x'={1,3,5} -> except={4}
		assert(valeq((rows(db:pk_seek('t/col1', 'b'):pk_except(db:pk_seek('t/col2', 'x')):fetch():iter())), {4}), 'except b-x')
		assert(valeq((rows(db:pk_seek('t/col1', 'c'):pk_except(db:pk_seek('t/col2', 'x')):fetch():iter())), {}),  'except left empty')
		assert(valeq((rows(db:pk_seek('t/col1', 'a'):pk_except(db:pk_seek('t/col2', 'a')):fetch():iter())), {1, 2, 5}), 'except right empty')

		--composition: (col1='a' AND col2='x') OR col1='b' = {1,5} | {3,4} = {1,3,4,5}
		--not expressible with each_and/each_or
		local composed = db:pk_seek('t/col1', 'a')
			:pk_and(db:pk_seek('t/col2', 'x'))
			:pk_or (db:pk_seek('t/col1', 'b'))
			:fetch():iter()
		assert(valeq((rows(composed)), {1, 3, 4, 5}), 'composed (a AND x) OR b')

		db:commit()
	end)
end

--anti_join yields outer rows for which inner_fn produces no results.
--inner_fn receives the outer bundle and returns a fresh node (pk or row).
--test scenario: find col1='a' rows whose col2 value has no 'b' counterpart.
function test.anti_join()
	with_db('anti_join', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'col2', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:add_index('t', {'col2'})
		db:insert('t', '{}', {id = 1, col1 = 'a', col2 = 'x'})
		db:insert('t', '{}', {id = 2, col1 = 'a', col2 = 'y'})
		db:insert('t', '{}', {id = 3, col1 = 'b', col2 = 'x'})
		db:insert('t', '{}', {id = 4, col1 = 'b', col2 = 'y'})
		db:insert('t', '{}', {id = 5, col1 = 'a', col2 = 'z'}) --no 'b' counterpart

		local function ids(iter)
			local t = {}
			for bundle in iter do add(t, num(bundle.t:current('{}').id)) end
			sort(t); return t
		end

		--inner_fn: pk_and checking if col1='b' has a row with same col2 as outer
		local function has_b_counterpart(bundle)
			local col2 = bundle.t:current('{}').col2
			return db:pk_seek('t/col1', 'b'):pk_and(db:pk_seek('t/col2', col2))
		end

		--col1='a' rows: {1(x),2(y),5(z)}. 'b' has x={3} and y={4} but not z.
		--anti_join yields only id=5 (no 'b' row shares col2='z').
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():anti_join(has_b_counterpart):iter()), {5}), 'a anti b by col2')

		--all 'b' rows have 'a' counterparts -> anti_join yields nothing
		local function has_a_counterpart(bundle)
			local col2 = bundle.t:current('{}').col2
			return db:pk_seek('t/col1', 'a'):pk_and(db:pk_seek('t/col2', col2))
		end
		assert(valeq(ids(db:pk_seek('t/col1', 'b'):fetch():anti_join(has_a_counterpart):iter()), {}), 'b anti a: all have counterparts')

		--inner always empty -> all outer rows yielded
		local function inner_empty(_bundle)
			return db:pk_seek('t/col1', 'c') --no col1='c' rows
		end
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():anti_join(inner_empty):iter()), {1, 2, 5}), 'inner always empty')

		--empty outer -> no results regardless of inner
		assert(valeq(ids(db:pk_seek('t/col1', 'c'):fetch():anti_join(has_b_counterpart):iter()), {}), 'empty outer')

		db:commit()
	end)
end

--filter wraps any row stream and skips bundles where pred returns false.
--main use: WHERE non-indexed-col = X after a pk_seek/pk_and narrows by index.
function test.filter()
	with_db('filter', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'col2', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:insert('t', '{}', {id = 1, col1 = 'a', col2 = 'x'})
		db:insert('t', '{}', {id = 2, col1 = 'a', col2 = 'y'})
		db:insert('t', '{}', {id = 3, col1 = 'b', col2 = 'x'})
		db:insert('t', '{}', {id = 4, col1 = 'b', col2 = 'y'})
		db:insert('t', '{}', {id = 5, col1 = 'a', col2 = 'x'})

		local function ids(iter)
			local t = {}
			for bundle in iter do
				add(t, num(bundle.t:current('{}').id))
			end
			sort(t); return t
		end
		local function col2_eq(v)
			return function(b) return b.t:current('{}').col2 == v end
		end
		local function id_gt(n)
			return function(b) return num(b.t:current('{}').id) > n end
		end

		--filter on non-indexed col2 (the main use case)
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():filter(col2_eq('x')):iter()), {1, 5}), 'a AND col2=x')
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():filter(col2_eq('y')):iter()), {2}),    'a AND col2=y')
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():filter(col2_eq('z')):iter()), {}),     'a AND col2=z: none match')
		assert(valeq(ids(db:pk_seek('t/col1', 'c'):fetch():filter(col2_eq('x')):iter()), {}),     'empty source')
		--chained filters
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():filter(col2_eq('x')):filter(id_gt(1)):iter()), {5}), 'chained')

		db:commit()
	end)
end

function test.limit()
	with_db('limit', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:insert('t', '{}', {id = 1, col1 = 'a'})
		db:insert('t', '{}', {id = 2, col1 = 'a'})
		db:insert('t', '{}', {id = 3, col1 = 'a'})

		local function ids(iter)
			local t = {}
			for bundle in iter do add(t, num(bundle.t:current('{}').id)) end
			return t --preserve iteration order to verify limit cuts at the right point
		end
		local function seek_a() return db:pk_seek('t/col1', 'a'):fetch() end

		assert(valeq(ids(seek_a():limit(2):iter()), {1, 2}),    'limit 2')
		assert(valeq(ids(seek_a():limit(10):iter()), {1, 2, 3}), 'limit > count')
		assert(valeq(ids(seek_a():limit(0):iter()), {}),         'limit 0')
		assert(valeq(ids(db:pk_seek('t/col1', 'z'):fetch():limit(5):iter()), {}), 'empty source')

		db:commit()
	end)
end

function test.semi_join()
	with_db('semi_join', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'col2', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:add_index('t', {'col2'})
		db:insert('t', '{}', {id = 1, col1 = 'a', col2 = 'x'})
		db:insert('t', '{}', {id = 2, col1 = 'a', col2 = 'y'})
		db:insert('t', '{}', {id = 3, col1 = 'b', col2 = 'x'})
		db:insert('t', '{}', {id = 4, col1 = 'b', col2 = 'y'})
		db:insert('t', '{}', {id = 5, col1 = 'a', col2 = 'z'}) --no 'b' counterpart

		local function ids(iter)
			local t = {}
			for bundle in iter do add(t, num(bundle.t:current('{}').id)) end
			sort(t); return t
		end

		--semi_join: outer=col1='a', inner checks if col1='b' has same col2
		--ids 1(x) and 2(y) have counterparts; 5(z) does not
		local function has_b_counterpart(bundle)
			local col2 = bundle.t:current('{}').col2
			return db:pk_seek('t/col1', 'b'):pk_and(db:pk_seek('t/col2', col2))
		end
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():semi_join(has_b_counterpart):iter()), {1, 2}), 'a semi b by col2')

		--empty outer -> no results
		assert(valeq(ids(db:pk_seek('t/col1', 'c'):fetch():semi_join(has_b_counterpart):iter()), {}), 'empty outer')

		--inner always empty -> no outer rows pass
		local function inner_empty(_bundle)
			return db:pk_seek('t/col1', 'c')
		end
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():semi_join(inner_empty):iter()), {}), 'inner always empty')

		db:commit()
	end)
end

function test.union()
	with_db('union', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:insert('t', '{}', {id = 1, col1 = 'a'})
		db:insert('t', '{}', {id = 2, col1 = 'a'})
		db:insert('t', '{}', {id = 3, col1 = 'b'})
		db:insert('t', '{}', {id = 4, col1 = 'b'})
		db:insert('t', '{}', {id = 5, col1 = 'c'})

		local function ids(iter)
			local t = {}
			for bundle in iter do add(t, num(bundle.t:current('{}').id)) end
			sort(t); return t
		end

		--basic: disjoint sets
		assert(valeq(ids(db:pk_seek('t/col1','a'):fetch():union(db:pk_seek('t/col1','b'):fetch()):iter()), {1,2,3,4}), 'a union b')

		--three-way via chaining
		assert(valeq(ids(db:pk_seek('t/col1','a'):fetch():union(db:pk_seek('t/col1','b'):fetch()):union(db:pk_seek('t/col1','c'):fetch()):iter()), {1,2,3,4,5}), 'a union b union c')

		--empty left side
		assert(valeq(ids(db:pk_seek('t/col1','z'):fetch():union(db:pk_seek('t/col1','b'):fetch()):iter()), {3,4}), 'empty left')

		--empty right side
		assert(valeq(ids(db:pk_seek('t/col1','a'):fetch():union(db:pk_seek('t/col1','z'):fetch()):iter()), {1,2}), 'empty right')

		db:commit()
	end)
end

function test.nested_join()
	with_db('nested_join', function(db)
		db:begin'w'
		db:create_table('orders', {name = 'orders', fields = {
			{col = 'id',     mdbx_type = 'u32', not_null = true},
			{col = 'status', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('orders', {'status'})
		db:create_table('items', {name = 'items', fields = {
			{col = 'id',       mdbx_type = 'u32', not_null = true},
			{col = 'order_id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('items', {'order_id'})
		db:insert('orders', '{}', {id = 1, status = 'active'})
		db:insert('orders', '{}', {id = 2, status = 'active'})
		db:insert('orders', '{}', {id = 3, status = 'inactive'})
		db:insert('items', '{}', {id = 10, order_id = 1})
		db:insert('items', '{}', {id = 11, order_id = 1})
		db:insert('items', '{}', {id = 12, order_id = 2})
		--order 3 (inactive) has no items

		local function join_rows(iter)
			local t = {}
			for bundle in iter do
				local oid = num(bundle.orders:current('{}').id)
				local iid = num(bundle.items:current('{}').id)
				add(t, oid..':'..iid)
			end
			sort(t); return t
		end
		local function items_for(bundle)
			local oid = num(bundle.orders:current('{}').id)
			return db:pk_seek('items/order_id', oid):fetch()
		end

		--active orders (1,2) joined to their items; order 1 -> {10,11}, order 2 -> {12}
		assert(valeq(join_rows(db:pk_seek('orders/status', 'active'):fetch():nested_join(items_for):iter()),
			{'1:10', '1:11', '2:12'}), 'active orders join items')

		--outer with empty inner: inactive order 3 has no items -> 0 output rows
		assert(valeq(join_rows(db:pk_seek('orders/status', 'inactive'):fetch():nested_join(items_for):iter()),
			{}), 'outer with empty inner')

		--empty outer
		assert(valeq(join_rows(db:pk_seek('orders/status', 'pending'):fetch():nested_join(items_for):iter()),
			{}), 'empty outer')

		db:commit()
	end)
end

function test.pk_range()
	with_db('pk_range', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:insert('t', '{}', {id = 1, col1 = 'a'})
		db:insert('t', '{}', {id = 2, col1 = 'b'})
		db:insert('t', '{}', {id = 3, col1 = 'b'})
		db:insert('t', '{}', {id = 4, col1 = 'c'})
		db:insert('t', '{}', {id = 5, col1 = 'd'})
		db:insert('t', '{}', {id = 6, col1 = 'e'})
		db:insert('t', '{}', {id = 7, col1 = 'c'})

		local function ids(node)
			local t = {}
			for bundle in node:fetch():iter() do
				add(t, num(bundle.t:current('{}').id))
			end
			sort(t); return t
		end

		--bounded range [b, d]: col1 in {b, c, d}
		assert(valeq(ids(db:pk_range('t/col1', 'b', 'd')), {2, 3, 4, 5, 7}), '[b,d]')

		--left-unbounded: col1 <= b
		assert(valeq(ids(db:pk_range('t/col1', nil, 'b')), {1, 2, 3}), '[nil,b]')

		--right-unbounded: col1 >= d
		assert(valeq(ids(db:pk_range('t/col1', 'd', nil)), {5, 6}), '[d,nil]')

		--fully unbounded: all rows
		assert(valeq(ids(db:pk_range('t/col1', nil, nil)), {1, 2, 3, 4, 5, 6, 7}), '[nil,nil]')

		--exact match [c, c] = pk_seek equivalent
		assert(valeq(ids(db:pk_range('t/col1', 'c', 'c')), {4, 7}), '[c,c]')

		--empty: lo > hi
		assert(valeq(ids(db:pk_range('t/col1', 'd', 'b')), {}), 'lo > hi')

		--empty: range beyond all keys
		assert(valeq(ids(db:pk_range('t/col1', 'z', nil)), {}), 'beyond all keys')

		--composition with pk_and: range [b,d] AND seek c -> {c} keys = {4,7}
		assert(valeq(ids(db:pk_range('t/col1', 'b', 'd'):pk_and(db:pk_seek('t/col1', 'c'))), {4, 7}), 'pk_range and pk_seek')

		db:commit()
	end)
end

function test.pk_range_composite()
	with_db('pk_range_composite', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'uid' , mdbx_type = 'u32', not_null = true},
			{col = 'time', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'uid', 'time'})
		db:insert('t', '{}', {id = 1, uid = 1, time = 10})
		db:insert('t', '{}', {id = 2, uid = 1, time = 20})
		db:insert('t', '{}', {id = 3, uid = 1, time = 30})
		db:insert('t', '{}', {id = 4, uid = 2, time = 10})
		db:insert('t', '{}', {id = 5, uid = 2, time = 20})

		local function ids(node)
			local t = {}
			for bundle in node:fetch():iter() do
				add(t, num(bundle.t:current('{}').id))
			end
			sort(t); return t
		end

		--uid=1 AND time in [15, 25]: only id=2 (time=20)
		assert(valeq(ids(db:pk_range('t/uid,time', {1, 15}, {1, 25})), {2}), '[{1,15},{1,25}]')

		--uid=1 AND time in [0, 30]: ids 1,2,3
		assert(valeq(ids(db:pk_range('t/uid,time', {1, 0}, {1, 30})), {1, 2, 3}), '[{1,0},{1,30}]')

		--(1,20)..(2,10): includes (1,20),(1,30),(2,10) since (1,30) sorts before (2,10) -> ids 2,3,4
		assert(valeq(ids(db:pk_range('t/uid,time', {1, 20}, {2, 10})), {2, 3, 4}), '[{1,20},{2,10}]')

		--nil lo with composite hi: first through uid=1,time=20 -> ids 1,2
		assert(valeq(ids(db:pk_range('t/uid,time', nil, {1, 20})), {1, 2}), '[nil,{1,20}]')

		--composite lo with nil hi: from uid=2,time=10 to end -> ids 4,5
		assert(valeq(ids(db:pk_range('t/uid,time', {2, 10}, nil)), {4, 5}), '[{2,10},nil]')

		db:commit()
	end)
end

function test.pk_get()
	with_db('pk_get', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id',  mdbx_type = 'u32', not_null = true},
			{col = 'val', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'val'})
		db:insert('t', '{}', {id = 1, val = 'a'})
		db:insert('t', '{}', {id = 2, val = 'b'})
		db:insert('t', '{}', {id = 3, val = 'b'})

		local function ids(node)
			local t = {}
			for bundle in node:fetch():iter() do
				add(t, num(bundle.t:current('{}').id))
			end
			sort(t); return t
		end

		--existing row: yields exactly one PK
		assert(valeq(ids(db:pk_get('t', 2)), {2}), 'existing row')

		--non-existent row: empty stream
		assert(valeq(ids(db:pk_get('t', 99)), {}), 'missing row')

		--pk_get intersected with pk_seek: row 2 has val='b' -> match
		assert(valeq(ids(db:pk_get('t', 2):pk_and(db:pk_seek('t/val', 'b'))), {2}), 'pk_get and pk_seek match')

		--pk_get intersected with pk_seek: row 1 has val='a', not 'b' -> empty
		assert(valeq(ids(db:pk_get('t', 1):pk_and(db:pk_seek('t/val', 'b'))), {}), 'pk_get and pk_seek no match')

		--missing pk in pk_and: empty without crash
		assert(valeq(ids(db:pk_get('t', 99):pk_and(db:pk_seek('t/val', 'b'))), {}), 'missing pk_get in pk_and')

		db:commit()
	end)
end

function test.aggregate()
	with_db('aggregate', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id',       mdbx_type = 'u32',  not_null = true},
			{col = 'category', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'amount',   mdbx_type = 'u32',  not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'category'})
		db:insert('t', '{}', {id = 1, category = 'a', amount = 10})
		db:insert('t', '{}', {id = 2, category = 'a', amount = 20})
		db:insert('t', '{}', {id = 3, category = 'b', amount = 30})
		db:insert('t', '{}', {id = 4, category = 'b', amount = 40})
		db:insert('t', '{}', {id = 5, category = 'b', amount = 50})
		db:insert('t', '{}', {id = 6, category = 'c', amount = 60})

		local function by_category()
			return db:pk_range('t/category', nil, nil):fetch()
				:aggregate(
					function(b) return b.t:current('{}').category end,
					{count = function(_, n) return (n or 0) + 1 end,
					 total = function(b, n) return (n or 0) + num(b.t:current('{}').amount) end})
		end

		local groups = {}
		for g in by_category():iter() do add(groups, g) end

		assert(#groups == 3, 'three groups')
		assert(groups[1]._key == 'a' and groups[1].count == 2 and groups[1].total == 30, 'group a')
		assert(groups[2]._key == 'b' and groups[2].count == 3 and groups[2].total == 120, 'group b')
		assert(groups[3]._key == 'c' and groups[3].count == 1 and groups[3].total == 60, 'group c')

		--empty source emits no groups
		local empty_groups = {}
		for g in db:pk_seek('t/category','z'):fetch():aggregate(
			function(b) return b.t:current('{}').category end, {count = function(_, n) return (n or 0)+1 end}
		):iter() do add(empty_groups, g) end
		assert(#empty_groups == 0, 'empty source')

		--single group: all rows same key
		local single = {}
		for g in db:pk_seek('t/category','b'):fetch():aggregate(
			function(b) return b.t:current('{}').category end, {count = function(_, n) return (n or 0)+1 end}
		):iter() do add(single, g) end
		assert(#single == 1 and single[1].count == 3, 'single group')

		db:commit()
	end)
end

function test.seq_scan()
	with_db('seq_scan', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id',  mdbx_type = 'u32',  not_null = true},
			{col = 'val', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:insert('t', '{}', {id = 1, val = 'a'})
		db:insert('t', '{}', {id = 2, val = 'b'})
		db:insert('t', '{}', {id = 3, val = 'c'})

		local function ids(iter)
			local t = {}
			for bundle in iter do add(t, num(bundle.t:current('{}').id)) end
			return t
		end

		--full scan returns all rows in pk order
		assert(valeq(ids(db:seq_scan('t'):iter()), {1, 2, 3}), 'full scan')

		--empty table
		db:create_table('empty', {name = 'empty', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
		}, pk = {'id'}})
		assert(valeq(ids(db:seq_scan('empty'):iter()), {}), 'empty table')

		--composable with filter: skip val='b'
		local function vals(iter)
			local t = {}
			for bundle in iter do add(t, bundle.t:current('{}').val) end
			return t
		end
		assert(valeq(vals(db:seq_scan('t'):filter(function(b) return b.t:current('{}').val ~= 'b' end):iter()), {'a', 'c'}), 'filter')

		--composable with limit
		assert(valeq(ids(db:seq_scan('t'):limit(2):iter()), {1, 2}), 'limit')

		db:commit()
	end)
end

function test.distinct()
	with_db('distinct', function(db)
		db:begin'w'
		db:create_table('t', {name = 't', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'col1', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
			{col = 'col2', mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:add_index('t', {'col1'})
		db:add_index('t', {'col2'})
		db:insert('t', '{}', {id = 1, col1 = 'a', col2 = 'x'})
		db:insert('t', '{}', {id = 2, col1 = 'a', col2 = 'b'}) --appears in both index paths
		db:insert('t', '{}', {id = 3, col1 = 'c', col2 = 'b'})

		local function ids(iter)
			local t = {}
			for bundle in iter do add(t, num(bundle.t:current('{}').id)) end
			return t
		end

		--col1='a' -> {1,2}, col2='b' -> {2,3}; union gives 1,2,2,3; distinct -> 1,2,3
		local col1_a = db:pk_seek('t/col1', 'a'):fetch()
		local col2_b = db:pk_seek('t/col2', 'b'):fetch()
		assert(valeq(ids(col1_a:union(col2_b):distinct():iter()), {1, 2, 3}), 'dedup after union')

		--no duplicates: distinct is a pass-through
		assert(valeq(ids(db:pk_seek('t/col1', 'a'):fetch():distinct():iter()), {1, 2}), 'no dups')

		--empty source
		assert(valeq(ids(db:pk_seek('t/col1', 'z'):fetch():distinct():iter()), {}), 'empty')

		db:commit()
	end)
end

function test.merge_join()
	with_db('merge_join', function(db)
		db:begin'w'
		--two tables keyed by the same u32 id; merge_join joins on matching PKs
		db:create_table('a', {name = 'a', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'va', mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:create_table('b', {name = 'b', fields = {
			{col = 'id', mdbx_type = 'u32', not_null = true},
			{col = 'vb', mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
		}, pk = {'id'}})
		db:insert('a', '{}', {id = 1, va = 'a1'})
		db:insert('a', '{}', {id = 2, va = 'a2'}) --only in a
		db:insert('a', '{}', {id = 3, va = 'a3'})
		db:insert('b', '{}', {id = 1, vb = 'b1'})
		db:insert('b', '{}', {id = 3, vb = 'b3'})

		local function pairs_str(iter)
			local t = {}
			for bundle in iter do
				local va = bundle.a:current('{}').va
				local vb = bundle.b:current('{}').vb
				add(t, va..':'..vb)
			end
			sort(t); return t
		end

		--inner join: only ids present in both tables
		assert(valeq(pairs_str(db:merge_join('a', 'b'):iter()), {'a1:b1', 'a3:b3'}), 'inner join')

		--left join: a rows without a match get nil b
		local function left_str(iter)
			local t = {}
			for bundle in iter do
				local va = bundle.a:current('{}').va
				local vb = bundle.b and bundle.b:current('{}').vb or 'nil'
				add(t, va..':'..vb)
			end
			sort(t); return t
		end
		assert(valeq(left_str(db:merge_join('a', db.left('b')):iter()), {'a1:b1', 'a2:nil', 'a3:b3'}), 'left join')

		--composable with filter
		assert(valeq(
			pairs_str(db:merge_join('a', 'b'):filter(function(bundle)
				return bundle.a:current('{}').va == 'a1'
			end):iter()),
			{'a1:b1'}
		), 'filter after merge_join')

		db:commit()
	end)
end

------------------------------------------------------------------------------

local name = ...
if name == 'mdbx_query_test' then name = nil end
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
