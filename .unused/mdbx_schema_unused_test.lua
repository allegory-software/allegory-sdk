--each_join: all required args = inner join; db.left args = left join.
--tests the inner join case: only keys present in all required cursors are yielded.
function test.each_join_inner()
	with_db('each_join_inner', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 8},
		}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
			{col = 'val', mdbx_type = 'utf8', maxlen = 8},
		}, pk = {'id'}})
		db:add_index('child', {'pid'})
		db:insert('parent', '{}', {id = 1, name = 'p1'})
		db:insert('parent', '{}', {id = 2, name = 'p2'})
		db:insert('parent', '{}', {id = 3, name = 'p3'})
		db:insert('child', '{}', {id = 10, pid = 2, val = 'c10'})
		db:insert('child', '{}', {id = 11, pid = 2, val = 'c11'})
		db:insert('child', '{}', {id = 12, pid = 3, val = 'c12'})
		db:insert('child', '{}', {id = 13, pid = 5, val = 'c13'}) --pid=5 has no parent row

		local results = {} --{parent_id -> sorted child vals}
		for cur_p, cur_c in db:each_join('parent', 'child/pid') do
			local p = cur_p:current('{}')
			local children = {}
			for _, c in cur_c:each_dup_current('{}') do add(children, c.val) end
			sort(children)
			results[num(p.id)] = children
		end
		assert(not results[1], 'parent 1 has no children: must not appear')
		assert(not results[5], 'pid=5 has no parent row: must not appear')
		assert(valeq(results[2], {'c10', 'c11'}), 'parent 2')
		assert(valeq(results[3], {'c12'}), 'parent 3')
		local count = 0; for _ in pairs(results) do count = count + 1 end
		assert(count == 2, 'expected 2 joined pairs, got '..count)
		db:commit()
	end)
end

--each_join left join case: db.left args yield nil when no row at current key.
function test.each_join_left()
	with_db('each_join_left', function(db)
		db:begin'w'
		db:create_table('parent', {name = 'parent', fields = {
			{col = 'id'  , mdbx_type = 'u32', not_null = true},
			{col = 'name', mdbx_type = 'utf8', maxlen = 8},
		}, pk = {'id'}})
		db:create_table('child', {name = 'child', fields = {
			{col = 'id' , mdbx_type = 'u32', not_null = true},
			{col = 'pid', mdbx_type = 'u32', not_null = true},
			{col = 'val', mdbx_type = 'utf8', maxlen = 8},
		}, pk = {'id'}})
		db:add_index('child', {'pid'})
		db:insert('parent', '{}', {id = 1, name = 'p1'}) --no children
		db:insert('parent', '{}', {id = 2, name = 'p2'}) --two children
		db:insert('parent', '{}', {id = 3, name = 'p3'}) --one child
		db:insert('child', '{}', {id = 10, pid = 2, val = 'c10'})
		db:insert('child', '{}', {id = 11, pid = 2, val = 'c11'})
		db:insert('child', '{}', {id = 12, pid = 3, val = 'c12'})
		db:insert('child', '{}', {id = 13, pid = 5, val = 'c13'}) --pid=5 has no parent: must not appear

		local results = {} --{parent_id -> sorted child vals, or false if no children}
		for cur_p, cur_c in db:each_join('parent', db.left'child/pid') do
			local p = cur_p:current('{}')
			local pid = num(p.id)
			if cur_c then
				local children = {}
				for _, c in cur_c:each_dup_current('{}') do add(children, c.val) end
				sort(children)
				results[pid] = children
			else
				results[pid] = false
			end
		end
		assert(results[1] == false,                'parent 1: no children, nil right cursor')
		assert(valeq(results[2], {'c10', 'c11'}),  'parent 2: two children')
		assert(valeq(results[3], {'c12'}),          'parent 3: one child')
		assert(results[5] == nil,                   'pid=5 has no parent: must not appear')
		local count = 0; for _ in pairs(results) do count = count + 1 end
		assert(count == 3, 'expected 3 parents, got '..count)
		db:commit()
	end)
end

--each_and finds records matching conditions on two different indexes of the
--same table: only rows whose pk appears in both indexes' dup lists are returned.
function test.each_and()
	with_db('each_and', function(db)
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
		db:insert('t', '{}', {id = 5, col1 = 'a', col2 = 'x'}) --second a+x row

		local function intersect(...)
			local ids = {}
			for cur in db:each_and(...) do
				local r = cur:current('{}')
				add(ids, num(r.id))
			end
			sort(ids); return ids
		end

		assert(valeq(intersect('t/col1', 'a', 't/col2', 'x'), {1, 5}), 'a+x: two matches')
		assert(valeq(intersect('t/col1', 'a', 't/col2', 'y'), {2}),    'a+y: one match')
		assert(valeq(intersect('t/col1', 'b', 't/col2', 'x'), {3}),    'b+x: one match')
		assert(valeq(intersect('t/col1', 'b', 't/col2', 'y'), {4}),    'b+y: one match')
		assert(valeq(intersect('t/col1', 'c', 't/col2', 'x'), {}),     'no col1=c: empty')
		assert(valeq(intersect('t/col1', 'a', 't/col2', 'z'), {}),     'no col2=z: empty')
		db:commit()
	end)
end

--each_or merges dup lists with deduplication: a PK appearing in multiple
--indexes is yielded once; an empty-key index contributes nothing (not noop).
function test.each_or()
	with_db('each_or', function(db)
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
		db:insert('t', '{}', {id = 5, col1 = 'a', col2 = 'x'}) --second a+x

		local function union(...)
			local ids = {}
			for cur in db:each_or(...) do
				local r = cur:current('{}')
				add(ids, num(r.id))
			end
			sort(ids); return ids
		end

		--ids 1,5 appear in both; deduplication gives {1,2,3,5}
		assert(valeq(union('t/col1', 'a', 't/col2', 'x'), {1, 2, 3, 5}), 'a|x: dedup')
		--col1='a' has {1,2,5}, col2='y' has {2,4}: union = {1,2,4,5}
		assert(valeq(union('t/col1', 'a', 't/col2', 'y'), {1, 2, 4, 5}), 'a|y')
		--col1='c' has no entries: result is only col2='x' = {1,3,5}
		assert(valeq(union('t/col1', 'c', 't/col2', 'x'), {1, 3, 5}), 'c|x: one empty side')
		--both sides empty
		assert(valeq(union('t/col1', 'c', 't/col2', 'z'), {}), 'c|z: both empty')
		db:commit()
	end)
end
