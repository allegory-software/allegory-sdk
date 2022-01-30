local mysql = require'mysql'
local sock = require'sock'

sock.run(function()

	assert(mysql.connect{
		host = '127.0.0.1',
		port = 3306,
		user = 'bar',
		password = 'baz',
		db = 'foo',
		charset = 'utf8mb4',
		max_packet_size = 1024 * 1024,
	})

	assert(cn:query('drop table if exists cats'))

	local res = assert(cn:query('create table cats '
				  .. '(id serial primary key, '
				  .. 'name varchar(5))'))

	local res = assert(cn:query('insert into cats (name) '
		.. "values ('Bob'),(''),(null)"))

	print(res.affected_rows, ' rows inserted into table cats ',
			'(last insert id: ', res.insert_id, ')')

	require'pp'(assert(cn:query('select * from cats order by id asc', 10)))

	assert(cn:close())

end)
