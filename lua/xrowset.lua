--[[

	Server-side rowsets for nav-based x-widgets.
	Written by Cosmin Apreutesei. Public Domain.

	Properties to set:
		fields           : {field1, ...} field list (required)
		pk               : 'col1 ...'    primary key (required)
		uks              : ['col1 ...',] unique keys (to validate on the client)
		field_attrs      : {col->field}  extra field attributes
		cols             : 'col1 ...'    default visible columns list
		hide_cols        : 'col1 ...'    columns hidden by default
		ro_cols          : 'col1 ...'    read-only columns
		rw_cols          : 'col1 ...'    read-write columns
		pos_col          : 'col'         pos column for manual ordering of rows
		id_col           : 'col'         id column for tree-building
		parent_col       : 'col'         parent column for tree-building
		name_col         : 'col'         default display_col in lookup rowsets
		tree_col         : 'col'         tree column (the one with [+] icons)
		params           : 'par1 ...'    detail param names for master-detail
		can_add_rows     : f             allow adding new rows
		can_remove_rows  : f             allow removing rows
		can_change_rows  : f             allow editing existing rows
		allow            : f|'r1 ...'    allow only if current user has a matching role

	Field attributes sent to client:
		name             : 'col'         name for use in code
		type             : 'number'|...  client-side type
		text             : 'Foo Bar'     input-box label / grid column header
		hint             : '...'         tooltip
		default          : val           default value (if it's a constant)
		internal         : t             cannot be made visible
		hidden           : t             not visible by default
		readonly         : f             cannot be changed
		enum_values      : ['foo',...]   enum values
		enum_texts       : ['bla',...]   enum texts in current language
		not_null         : t             can't be null
		min              : n             min allowed value
		max              : n             max allowed value
		decimals         : n             number of decimals
		maxlen           : n             max length in characters
		w                : px            default grid column width
		min_w            : px            min grid column width
		max_w            : px            max grid column width
		max_char_w       : n             max grid column width in characters

	Methods to implement:
		- load_rows(result, params)
		- insert_row(vals)
		- update_row(vals)
		- delete_row(vals)
		- load_row(vals)

	Sets by default:
		- `can_[add|change|remove]_rows` are set to false on missing row update methods.
		- `pos_col` and `parent_col` are set to hidden by default.
		- on client-side, `id_col` is set to pk if pk is single-column.

ACTIONS

	rowset.json               named rowsets action
	xrowset.events            rowset-refresh push-notifications

]]

require'webb_action'

local glue = require'glue'
local errors = require'errors'

local catch = errors.catch
local raise = errors.raise

local update = glue.update
local names = glue.names
local index = glue.index
local empty = glue.empty
local noop = glue.noop

rowset = {}

action['rowset.json'] = function(name)
	return checkfound(rowset[name])(name)
end

local client_field_attrs = {
	internal=1, hidden=1, readonly=1,
	name=1, type=1, text=1, hint=1, default=1,
	enum_values=1, enum_texts=1, not_null=1, min=1, max=1, decimals=1, maxlen=1,
	lookup_rowset_name=1, lookup_col=1, display_col=1, name_col=1,
	w=1, min_w=1, max_w=1, max_char_w=1,
	hour_step=1, minute_step=1, second_step=1, has_seconds=1,
	icon=1, bare=1,
}

function virtual_rowset(init, ...)

	local rs = {}
	setmetatable(rs, rs)

	function rs.init_fields(rs)

		local hide_cols = index(names(rs.hide_cols) or empty)
		local   ro_cols = index(names(rs.  ro_cols) or empty)
		local   rw_cols = rs.rw_cols and index(names(rs.rw_cols))

		if rs.pos_col == nil and rs.fields.pos then
			rs.pos_col = 'pos'
		end
		if rs.pos_col then
			local pos_field = assert(rs.fields[rs.pos_col])
			if not pos_field.w then
				pos_field.w = 40
			end
		end

		rs.client_fields = {}

		for i,f in ipairs(rs.fields) do
			if hide_cols[f.name]
				or f.name == rs.pos_col
				or f.name == rs.parent_col
			then
				f.hidden = true
			end
			if rw_cols and not rw_cols[f.name] then
				f.readonly = true
			end
			if ro_cols[f.name] then
				f.readonly = true
			end
			update(f, rs.field_attrs and rs.field_attrs[f.name])

			local client_field = {}
			for k,v in pairs(f) do
				if client_field_attrs[k] then
					client_field[k] = v
				end
			end
			rs.client_fields[i] = client_field
		end

		if not rs.insert_row then rs.can_add_rows    = false end
		if not rs.update_row then rs.can_change_rows = false end
		if not rs.delete_row then rs.can_remove_rows = false end
	end

	local function update_client_fields()
		for i,f in ipairs(rs.client_fields) do
			for k,v in pairs(f) do
				local v = rs.fields[i][k]
				if type(v) == 'function' then --value getter/generator
					f[k] = v()
				end
			end
		end
	end

	function rs:load(param_values)
		local res = {}
		rs:load_rows(res, param_values)
		update_client_fields()
		merge(res, {
			can_add_rows = rs.can_add_rows,
			can_remove_rows = rs.can_remove_rows,
			can_change_rows = rs.can_change_rows,
			fields = rs.client_fields,
			pk = rs.pk,
			pos_col = rs.pos_col,
			cols = rs.cols,
			params = rs.params,
			id_col = rs.id_col,
			parent_col = rs.parent_col,
			name_col = rs.name_col,
			tree_col = rs.tree_col,
		})
		return res
	end

	function rs:validate_field(name, val)
		local validate = rs.validators and rs.validators[name]
		if validate then
			return validate(val)
		end
	end

	function rs:validate_fields(values)
		local errors
		for k,v in sortedpairs(values) do --TODO: get these pre-sorted in UI order!
			local err = rs:validate_field(k, v)
			if type(err) == 'string' then
				errors = errors or {}
				errors[k] = err
			end
		end
		return errors
	end

	local function db_error(err, s)
		return config'hide_errors' and s or s..(err and err.message and ':\n'..err.message or '')
	end

	function rs:can_add_row(values)
		if rs.can_add_rows == false then
			return false, 'adding rows is not allowed'
		end
		local errors = rs:validate_fields(values)
		if errors then return false, nil, errors end
	end

	function rs:can_change_row(values)
		if rs.can_change_rows == false then
			return false, 'updating rows is not allowed'
		end
		local errors = rs:validate_fields(values)
		if errors then return false, nil, errors end
	end

	function rs:can_remove_row(values)
		if rs.can_remove_rows == false then
			return false, 'removing rows is not allowed'
		end
	end

	function rs:apply_changes(changes)

		local res = {rows = {}}

		for _,row in ipairs(changes.rows) do
			local rt = {type = row.type}
			if row.type == 'new' then
				local can, err, field_errors = rs:can_add_row(row.values)
				if can ~= false then
					local ok, err = catch('db', rs.insert_row, rs, row.values)
					if ok then
						if rs.load_row then
							local ok, row = catch('db', rs.load_row, rs, row.values)
							if ok then
								if not row then
									rt.error = S('inserted_row_not_found',
										'Inserted row could not be loaded back')
								else
									rt.values = row
								end
							else
								local err = row
								rt.error = db_error(err,
									S('load_inserted_row_error',
										'Error on loading back inserted row'))
							end
						end
					else
						if err.col then
							rt.field_errors = {[err.col] = err.message}
						else
							rt.error = db_error(err, S('insert_error', 'Error on inserting row'))
						end
					end
				else
					rt.error = err or true
					rt.field_errors = field_errors
				end
			elseif row.type == 'update' then
				local can, err, field_errors = rs:can_change_row(row.values)
				if can ~= false then
					local ok, err = catch('db', rs.update_row, rs, row.values)
					if ok then
						if rs.load_row then
							--copy :foo:old to :foo so we can select the row back.
							for k,v in pairs(row.values) do
								local k1 = k:match'^(.-):old$'
								if k1 and row.values[k1] == nil then
									row.values[k1] = v
								end
							end
							local ok, row = catch('db', rs.load_row, rs, row.values)
							if ok then
								if not row then
									rt.remove = true
									rt.error = S('updated_row_not_found',
										'Updated row could not be loaded back')
								else
									rt.values = row
								end
							else
								local err = row
								rt.error = db_error(err,
									S('load_updated_row_error',
										'Error on loading back updated row'))
							end
						end
					else
						if err.col then
							rt.field_errors = {[err.col] = err.message}
						else
							rt.error = db_error(err, S('update_error', 'Error on updating row'))
						end
					end
				else
					rt.error = err or true
					rt.field_errors = field_errors
				end
			elseif row.type == 'remove' then
				local can, err, field_errors = rs:can_remove_row(row.values)
				if can ~= false then
					local ok, err = catch('db', rs.delete_row, rs, row.values)
					if ok then
						if rs.load_row then
							local ok, row = catch('db', rs.load_row, rs, row.values)
							if ok then
								if row then
									rt.error = S('removed_row_found',
										'Removed row is still in db')
								end
							else
								local err = row
								rt.error = db_error(err,
									S('load_removed_row_error',
										'Error on loading back removed row'))
							end
						end
					else
						rt.error = db_error(err,
							S('delete_error', 'Error on removing row'))
					end
				else
					rt.error = err or true
					rt.field_errors = field_errors
				end
				rt.remove = not rt.error
			else
				assert(false)
			end
			add(res.rows, rt)
		end

		if #res.rows > 0 then
			rowset_changed(rs.name)
		end

		return res
	end

	function rs:respond(rowset_name)
		rs.name = rowset_name
		if type(rs.allow) == 'function' then
			allow(rs.allow())
		elseif type(rs.allow) == 'string' then
			allow(admin(rs.allow))
		end
		local filter = json_arg(args'filter') or {}
		local params = {}
		--params are prefixed so that they can be used in col_maps.
		--:old variants are added too for update where sql.
		for k,v in pairs{
			['param:lang'        ] = lang(),
			['param:default_lang'] = default_lang(),
			['param:filter'      ] = filter,
		} do
			params[k] = v
			params[k..':old'] = v
		end
		local post = post()
		local method = post and post.exec and post.exec or 'load'
		local method = checkfound(rs['exec_'..method], 'command not found')
		return method(rs, params, post)
	end

	function rs:exec_load(params, post)
		return rs:load(params, post)
	end

	function rs:exec_save(params, post)
		for _,row_change in ipairs(post.changes.rows) do
			if row_change.values then
				update(row_change.values, params)
			end
		end
		return rs:apply_changes(post.changes)
	end

	init(rs, ...)
	if not rs.manual_init_fields then
		rs:init_fields()
	end

	rs.__call = rs.respond

	return rs
end

--reload push-notifications --------------------------------------------------

local waiting_events_threads = {}
local changed_rowsets = {}

function rowset_changed(rowset_name)
	for _, rowsets in pairs(changed_rowsets) do
		rowsets[rowset_name] = true
	end
	for thread in pairs(waiting_events_threads) do
		resume(thread)
	end
end

action['xrowset.events'] = function()
	setheader('cache-control', 'no-cache')
	setconnectionclose()
	local waiting_thread
	thread(function()
		--hack to wait for client to close the connection so we can wake up
		--the sending thread if suspended and finish it so the server can
		--clean up the accept thread. this works because the client shouldn't
		--send anything anymore so recv() should only return on close.
		local tcp = cx().req.http.tcp
		local buf = glue.u8a(1)
		local sz, err = assert(tcp:recv(buf, 1) == 0) --clean close
		if waiting_thread then
			transfer(waiting_thread, 'closed')
		end
	end)
	local rowsets = {}
	local key = cx()
	changed_rowsets[key] = rowsets
	onrequestfinish(function()
		changed_rowsets[key] = nil
	end)
	while true do
		if not next(rowsets) then
			local thread = currentthread()
			waiting_events_threads[thread] = true
			waiting_thread = thread
			local action = suspend()
			waiting_events_threads[thread] = nil
			waiting_thread = nil
			if action == 'closed' then
				break
			end
		end
		local t = {}
		for rowset_name in pairs(rowsets) do
			t[#t+1] = 'data: '..rowset_name..'\n\n'
			rowsets[rowset_name] = nil
		end
		local events = table.concat(t)
		assert(not out_buffering())
		out(events)
	end
end
