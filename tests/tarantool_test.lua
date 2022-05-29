
require'tarantool'
require'sock'
require'glue'
require'logging'

run(function()
	local c = assert(tarantool_connect{
		host     = '10.0.0.6',
		user     = 'admin',
		password = 'admin',
		tracebacks = true,
		expires  = clock() + 1,
	})
	c = c:stream()
	assert(c:ping())
	local pass = 12
	if pass == 1 then
		pr(c:eval[[
			box.schema.space.create('test')
			box.space.test:create_index('primary', {parts = {1}})
			box.space.test:insert{'e', 4, 7}
			box.space.test:insert{'c', 5, 6}
			box.space.test:insert{'d', 6, 5}
		]])
	elseif pass == 2 then
		pr(c:exec[[
			CREATE TABLE table2 (
				column1 INTEGER,
				column2 VARCHAR(100),
				column3 SCALAR,
				column4 DOUBLE,
				PRIMARY KEY (column1, column2));
		]])
	elseif pass == 3 then
		pr(c:exec[[
			insert into table2 values (1, 'a', 5, 7);
			insert into table2 values (1, 'b', 3, 1);
			insert into table2 values (2, 'a', 4, 2);
			insert into table2 values (2, 'b', 3, 6);
		]])
	elseif pass == 4 then
		local st = c:prepare('select * from table2 where column1 = ? and column2 = :c2')
		pr(st:exec{1, c2 = 'b'})
		pr(st:free())
		--pr(st:exec{1, c2 = 'b'})
	elseif pass == 5 then
		pr(c:insert('test', {'h', 2}))
	elseif pass == 6 then
		pr(c:replace('test', {'h', 3, 6}))
	elseif pass == 7 then
		pr(c:update('test', nil, 'h', {{'+', 1, 100}, {'-', 2, 100}}))
		pr(c:select('test', nil, ''))
	elseif pass == 8 then
		pr(c:delete('test', 'h'))
	elseif pass == 9 then
		pr(c:eval([[
			return 'hello', {1, nil, 3, a = {b = 2}, c = 3}, ...
		]], 5, nil, 7))
	elseif pass == 10 then
		--NOTE: this currently doesn't work if your LuaJIT is using GC64 mode.
		local strip = true
		pr(c:eval([[
			local strip = true
			local f = function(...)
				return 'hello', ...
			end
			local s = string.dump(f, strip)
			return 'tt lua', s:gsub('.', function(c) return tostring(string.byte(c))..' ' end)
			--return loadstring(s)(1, 6)
			--return 'tt lua', string.dump(function(...)
			--	return 'hello', ...
			--end, strip)
		]]))
		pr('my lua', string.dump(function(...)
			return 'hello', ...
		end, strio):gsub('.', function(c) return tostring(byte(c))..' ' end))
		pr(c:eval(function(...)
			return 'hello', ...
		end, 5, nil, 7))
	elseif pass == 11 then
		pr(c:eval([[
			local decimal = require'decimal'
			return decimal.new(2/3)
		]]))
	elseif pass == 12 then
		local u, su = c:eval[[
			local uuid = require'uuid'
			local u = uuid()
			return u, tostring(u)
		]]
		print(tohex(u))
		print(su)
	end
	assert(not c.tcp:closed())
	pr('close', c:close())
end)
