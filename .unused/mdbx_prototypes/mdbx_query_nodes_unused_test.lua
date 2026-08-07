--archived tests for pk_join_hash (see mdbx_query_nodes_unused.lua). reference
--only: depends on with_db/with_u32_db/pk_id fixtures from
--tests/mdbx_query_nodes_test.lua and on Db.pk_join_hash, neither available
--here, so this file is not runnable as-is.

function test.pk_join_hash_exec()
	with_db('pk_join_hash_exec', function(db)
		db:atomic('r', function()
			-- driver in score order (users 4,1,2); output in FK-index order (user PK asc)
			local node = db:pk_join_hash(
				db:pk_range('users/score', '>=', 'LO'),
				'sessions/user_id')
			node:open({LO=70})
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			-- FK index order: user 1 first (not user 4 which led in score order)
			assert(cat(tuples, ',') == '1:11,1:12,1:13,2:14,4:15', S(tuples))
			-- driver with no matches: user 3 has no sessions
			local node2 = db:pk_join_hash(db:pk_get('users', 'K'), 'sessions/user_id')
			node2:open({K=3})
			assert(node2:next_group() == nil)
			node2:close()
		end)
	end)
end

function test.pk_join_hash_u32_exec()
	with_u32_db('pk_join_hash_u32_exec', function(db)
		db:atomic('r', function()
			local node = db:pk_join_hash(
				db:pk_seek('users/status', 'S'),
				'sessions/user_id')
			node:open({S=1})
			local tuples = {}
			while node:next_group() do
				tuples[#tuples+1] = pk_id(node, 'users', db)..':'..pk_id(node, 'sessions', db)
			end
			node:close()
			assert(cat(tuples, ',') == '1:11,1:12,2:13,4:14', S(tuples))

			local node2 = db:pk_join_hash(
				db:pk_seek('users/status', 'S'),
				'sessions/user_id')
			node2:open({S=9})
			assert(node2:next_group() == nil)
			node2:close()
		end)
	end)
end
