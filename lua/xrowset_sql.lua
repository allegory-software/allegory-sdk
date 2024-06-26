--[[

	SQL rowsets.
	Written by Cosmin Apreutesei. Public Domain.

	What must be specified manually:
		- select          : select without where clause.
		- where_all       : where clause for all rows (without the word "where").
		- order_by        : order-by clause.
		- limit           : limit clause.
		- pk              : 'foo bar ...', required as it can't be inferred reliably.
		- db              : optional, connection alias to query on.

	More complex cases can specify:
		- select_all    : instead of select + where_all.
		- where_row     : where clause for single row: 'tbl.pk1 = :as_pk1 and ...'.
		- select_row    : instead of select + where_row.
		- select_none   : instead of select_row or (select + 'where 1 = 0').

	If all else fails, you can always implement the rowset's S/U/I/D methods yourself.

	Inferred field attributes:
		name             : column alias.
		type             : field type.
		min, max         : numeric range (integers).
		decimals         : number of decimals (integers and decimals).
	Additionally, for fields that can be traced back to their origin table:
		enum_values      : enum values.
		default          : default value.
		not_null         : not-null flag.
		maxlen           : max length in characters.
		min, max         : numeric range (decimals).
		ref_table        : reference table (foreign key).
		ref_col          : column name in reference table (single-column fk).

	Fields without an origin table (SQL expressions) are made readonly.
	Auto-increment fields are made readonly.

	How to use rowset param values in queries:
		- in where_all:
			- `:param:filter`
				- `tbl.pk in (:param:filter)`, if the rowset's pk is a single column.
				- `$filter(foo = :foo and bar = :bar, :param:filter)` for composite pks.
			- `:param:lang`         : current language.
			- `:param:default_lang` : default language.
		- in insert and update queries:
			- `:COL`      : the column's new or changed value.
		- in update and delete where clause:
			- `:COL:old`  : the column's old value.

	Field methods to implement:
		mysql_to_lua(v)  : convert value for select result sets.
		mysql_to_sql(v)  : convert value for update queries (SQL statements).
		mysql_to_bin(v)  : convert value for update queries (prepared statements).

]]

require'xrowset'
require'query'
require'glue'

--usage in sql:
	-- single-key : `foo in (:param:filter)`
	-- multi-key  : `$filter("foo <=> :foo and bar <=> :bar", :param:filter)`
function qmacro.filter(self, expr, filter)
	local t = {}
	for i,vals in ipairs(filter) do
		t[i] = sqlparams(expr, vals)
	end
	return cat(t, ' or ')
end

--usage in sql: `$andor_filter(:param:filter)`
function qmacro.andor_filter(self, filter)
	local t = {}
	for i,vals in ipairs(filter) do
		local tt = {}
		for k,v in sortedpairs(vals) do
			add(tt, sqlname(k) .. ' <=> ' .. sqlval(v))
		end
		t[i] = cat(tt, ' and ')
	end
	return cat(t, ' or ')
end

local function guess_name_col(tdef)
	if tdef.name_col then return tdef.name_col end
	if tdef.fields.name then return 'name' end
end

function lookup_rowset(tbl)
	local rs_name = 'lookup_'..tbl
	local rs = rawget(rowset, rs_name)
	if not rs then
		local tdef = checkfound(table_def(tbl))
		local name_col = guess_name_col(tdef)
		local t = extend({name_col}, tdef.pk)
		local cols = cat(imap(t, sqlname), ', ')
		local order_by = tdef.pos_col or cat(tdef.pk, ' ')
		rs = sql_rowset{
			select = format('select %s from %s %s', cols, tbl, order_by),
			pk = cat(tdef.pk, ' '),
			name_col = name_col,
		}
		rawset(rowset, rs_name, rs)
	end
	return rs_name, rs.name_col
end

setmetatable(rowset, {__index = function(self, rs_name)
	if starts(rs_name, 'lookup_') then
		local tbl = checkfound(rs_name:match'lookup_(.+)')
		lookup_rowset(tbl)
		return rawget(rowset, rs_name)
	end
end})

function sql_rowset(...)

	return virtual_rowset(function(rs, sql, ...)

		if isstr(sql) then
			rs.select = sql
		else
			update(rs, sql, ...)
		end

		rs.manual_init_fields = true

		--the rowset's pk cannot be reliably inferred so it must be user-supplied.

		rs.pk = collect(words(rs.pk))
		assert(rs.pk and #rs.pk > 0, 'pk missing')

		--static query generation (just stitching together user-supplied parts).

		if not rs.select_all and rs.select then
			rs.select_all = outdent(rs.select)
				.. (rs.where_all and '\nwhere '..rs.where_all or '')
				.. (rs.order_by and '\norder by '..rs.order_by or '')
				.. (rs.limit and '\nlimit '..rs.limit or '')
		end

		if not rs.select_row and rs.select and rs.where_row then
			rs.select_row = outdent(rs.select) .. '\nwhere ' .. rs.where_row
		end

		if not rs.select_none and rs.select then
			rs.select_none = rs.select .. '\nwhere 1 = 0'
		end

		--query wrappers.

		local load_opt = {
			compact = true,
			to_array = false,
			null_value = null,
			field_attrs = rs.field_attrs,
		}

		--see if we can make a static load_row().

		if not rs.load_row and rs.select_row then
			function rs:load_row(vals)
				local rows = db(rs.db):query(load_opt, rs.select_row, vals)
				assert(#rows < 2, 'loaded back multiple rows for one inserted row')
				return rows[1]
			end
		end

		--dynamic generation of update queries based on the mapping of the
		--selected columns to their origin tables obtained from running the
		--select query the first time. if any of the update methods are called
		--before the select is run, it runs the select_none query once to get
		--the column mappings.

		local configure

		if not rs.load_rows then
			assert(rs.select_all, 'select_all missing')
			function rs:load_rows(res, param_vals)
				local db = isfunc(rs.db) and rs.db(param_vals) or db(rs.db)
				if rs.get_params then
					param_vals = rs:get_params(param_vals)
				end
				local rows, fields, params = db:query(load_opt, rs.select_all, param_vals)
				if configure then
					configure(fields)
					rs.params = params
				end
				res.rows = rows
			end
		end

		function rs:query(...)
			return db(self.db):query(...)
		end

		local user_methods = {}
		assert(rs.select_none, 'select_none missing')
		local apply_changes = rs.apply_changes
		function rs:apply_changes(...)
			if configure then
				local _, fields = self:query(load_opt, rs.select_none)
				configure(fields)
			end
			return apply_changes(self, ...)
		end

		local rw_col_map

		--[[local]] function configure(fields)

			configure = nil --one-shot.

			rs.fields = fields
			rw_col_map = {}
			for i,f in ipairs(fields) do
				if not f.readonly then
					rw_col_map[f.name] = f.name
				end
				if f.ref_table then
					f.lookup_rowset_name, f.display_col = lookup_rowset(f.ref_table)
					f.lookup_cols = f.ref_col
				end
			end
			rs:init_fields()

			local function where_row_sql()
				local t = {}
				for i, as_col in ipairs(rs.pk) do
					local f = assertf(fields[as_col], 'invalid pk col %s', as_col)
					local tbl = f.db..'.'..f.table
					local where_col = (f.table_alias or tbl)..'.'..f.col
					if i > 1 then add(t, ' and ') end
					add(t, where_col..' = :'..as_col)
				end
				return cat(t)
			end

			if not rs.load_row then
				assert(rs.select, 'select missing to create load_row()')
				local where_row = where_row_sql()
				function rs:load_row(vals)
					local sql = outdent(rs.select) .. (where_all
						and format('\nwhere (%s) and (%s)', where_all, where_row)
						 or format('\nwhere %s', where_row))
					return first_row(load_opt, sql, vals)
				end
			end

		end

		function rs:insert_into(tbl, vals, col_map, opt)
			local db = db(rs.db)
			local id, ret = db:insert_row(tbl, vals, col_map or rw_col_map, opt)
			if ret.affected_rows > 0 then
				assert(ret.affected_schema == db.db)
				self:table_changed(ret.affected_table)
			end
			return id, ret
		end

		function rs:update_into(tbl, vals, col_map, security_filter, opt)
			local db = db(rs.db)
			local ret = db:update_row(tbl, vals, col_map or rw_col_map, security_filter, opt)
			if ret.affected_rows > 0 then
				assert(ret.affected_schema == db.db)
				self:table_changed(ret.affected_table)
			end
			return ret
		end

		function rs:insert_or_update_into(tbl, vals, col_map, opt)
			local db = db(rs.db)
			local id, ret = db:insert_or_update_row(tbl, vals, col_map or rw_col_map, opt)
			if ret.affected_rows > 0 then
				assert(ret.affected_schema == db.db)
				self:table_changed(ret.affected_table)
			end
			return id, ret
		end

		function rs:delete_from(tbl, ...)
			return delete_row(tbl, ...)
		end

	end, ...)
end

--TODO: finish this.
function table_rowset(tbl, opt)
	opt = opt or empty
	local tdef = table_def(tbl)
	local rw_cols = opt.rw_cols
	local cols = opt.cols
	if not cols then
		for i,f in ipairs(tdef.fields) do
			add(cols, f.col)
		end
	end
	if not rw_cols then
		rw_cols = {}
		for i,f in ipairs(tdef.fields) do
			add(rw_cols, f.col)
		end
		rw_cols = cat(rw_cols, ' ')
	end

	local rs = sql_rowset(update({
		select = format('select %s from %s', cat(cols, ', '), sqlname(tbl)),
		where_all = opt.detail and '%s in (:param:filter)',
		pk = tdef.pk,
		order_by = cat(imap(tdef.pk, sqlname), ', '),
		hide_cols = opt.detail and tdef.pk..(' '..opt.hide_cols or ''),
		insert_row = function(self, row)
			self:insert_into(tbl, row, rw_cols)
		end,
		update_row = function(self, row)
			self:update_into(tbl, row, rw_cols)
		end,
		delete_row = function(self, row)
			self:delete_from(tbl, row)
		end,
	}, opt))

	return rs
end
