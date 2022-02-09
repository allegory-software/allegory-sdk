
require'xrowset_sql'

rowset.users = sql_rowset{
	allow = 'admin',
	select = [[
		select
			usr         ,
			active      ,
			emailvalid  ,
			email       ,
			title       ,
			name        ,
			phonevalid  ,
			phone       ,
			facebookid  ,
			googleid    ,
			gimgurl     ,
			sex         ,
			birthday    ,
			newsletter  ,
			roles       ,
			note        ,
			clientip    ,
			atime       ,
			ctime       ,
			mtime
		from
			usr
	]],
	field_attrs = {
		note     = {hidden = true},
		clientip = {hidden = true},
	},
	where_all = 'anonymous = 0',
	pk = 'usr',
	order_by = 'active desc, ctime desc',
	insert_row = function(self, row)
		row.anonymous = false
		row.usr = insert_row('usr', row, [[
			active emailvalid email title name phonevalid phone sex birthday
			newsletter roles note anonymous
		]])
	end,
	update_row = function(self, row)
		update_row('usr', row, [[
			active emailvalid email title name phonevalid phone sex birthday
			newsletter roles note
		]])
	end,
	delete_row = function(self, row)
		delete_row('usr', row)
	end,
}
