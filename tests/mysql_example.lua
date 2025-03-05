require'mysql'
require'sock'

run(function()

	local cn = mysql_connect{
		host = '10.0.0.5',
		port = 3307,
		user = 'root',
		password = 'root',
		charset = 'utf8mb4',
		max_packet_size = 1024 * 1024,
	}

	cn:query'create database if not exists example'
	cn:use'example'
	cn:query'drop table if exists cats'

	local res = cn:query('create table cats '
				  .. '(id serial primary key, '
				  .. 'name varchar(5))')

	local res = cn:query('insert into cats (name) '
		.. "values ('Bob'),(''),(null)")

	print(res.affected_rows, ' rows inserted into table cats ',
			'(last insert id: ', res.insert_id, ')')

	pr(cn:query('select * from cats order by id asc'))

	cn:close()

end)
