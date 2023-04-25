--[[

	Server-side rowsets for nav-based widgets.
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
		can_move_rows    : f             allos changing rows' position in the rowset
		allow            : f|'r1 ...'    allow only if current user has a matching role

	Field attributes sent to client:
		name             : 'col'         name for use in code
		type             : 'number'|...  client-side type
		label            : 'Foo Bar'     input-box label / grid column label
		info             : '...'         input-box info / grid column info
		default          : val           default value (if it's a constant)
		internal         : t             cannot be made visible
		hidden           : t             not visible by default
		readonly         : f             cannot be changed
		null_text        : ''            text for null value
		align            : 'left'|'right'|'center' cell alignment
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
		display_width    : c             display width in characters
		hour_step        : n             for the time picker
		minute_step      : n             for the time picker
		second_step      : n             for the time picker
		precision        : 'd|s|ms'      date type precision
		timeago          : f             format as relative time (see timeago())
		duration_format  :               format for duration type (see duration())
		filesize_decimals: 0             decimals, for filesize type
		filesize_magnitude:              magnitude for filesize type
		filesize_min     :               threshold for not making it gray

		lookup_rowset_name:              lookup rowset name
		lookup_cols      :               lookup rowset cols
		display_col      :               lookup display col
		name_col         :               default display col when used as lookup rowset

	Methods to implement:
		load_rows(result, params)
		insert_row(vals)
		update_row(vals)
		delete_row(vals)
		load_row(vals)

	Methods to call:
		rowset_changed(rowset_name)
		table_changed(table_name)

	Sets by default:
		- `can_[add|change|remove]_rows` are set to false on missing row update methods.
		- `pos_col` and `parent_col` are set to hidden by default.
		- on client-side, `id_col` is set to pk if pk is single-column.

GLOBALS
	rowset_changed(rowset_name, [update_id])

ACTIONS

	rowset.json               named rowsets action
	xrowset.events            rowset-refresh push-notifications

]]

require'webb_action'

require'glue'
local xlsx_workbook = require'xlsxwriter.workbook'

rowset = {}

action['rowset.json'] = function(name)
	return checkfound(rowset[checkarg(name)])(name, 'json')
end

action['rowset.xlsx'] = function(name)
	return checkfound(rowset[checkarg(name)])(name, 'xlsx')
end

local client_field_attrs = {
	internal=1, hidden=1, readonly=1, null_text=1,
	name=1, type=1, label=1, info=1, default=1, client_default=1, align=1,
	enum_values=1, enum_texts=1, not_null=1, min=1, max=1, decimals=1, maxlen=1,
	lookup_rowset_name=1, lookup_cols=1, display_col=1, name_col=1,
	w=1, min_w=1, max_w=1, display_width=1,
	hour_step=1, minute_step=1, second_step=1, precision=1,
	timeago=1, duration_format=1,
	filesize_decimals=1, filesize_magnitude=1, filesize_min=1,
}

local rowset_tables = {} --{table -> {rowset->true}}
local push_rowset_changed_events --fw. decl.

function virtual_rowset(init, ...)

	local rs = {}
	setmetatable(rs, rs)

	local update_computed_fields

	rs.after = after
	rs.before = before
	rs.override = override

	function rs.init_fields(rs, check_duplicates)

		local schema = config'db_schema'
		if schema then
			schema:resolve_types(rs.fields, rs.name, check_duplicates)
		end

		local hide_cols = index(collect(words(rs.hide_cols) or empty))
		local ro_cols = index(collect(words(rs.ro_cols) or empty))
		local rw_cols = rs.rw_cols and index(collect(words(rs.rw_cols)))

		if rs.pos_col == nil and rs.fields.pos then
			rs.pos_col = 'pos'
		end
		if rs.pos_col then
			local pos_field = assert(rs.fields[rs.pos_col])
			if not pos_field.w then
				pos_field.w = 40
			end
			rs.can_move_rows = true
		end

		rs.client_fields = {}
		local computed_fields

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

			if f.table then
				attr(rowset_tables, f.table)[rs.name] = true
			end
			if f.compute then
				computed_fields = computed_fields or {}
				add(computed_fields, f)
				f.readonly = true
			end

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

		if computed_fields then
			local current_row
			local function get_val(_, k)
				local field = rs.fields[k]
				return field and current_row[field.index]
			end
			local vals = setmetatable({}, {__index = get_val})
			--[[local]] function update_computed_fields(row)
				current_row = row
				rs:compute_row_vals(vals)
				for i,f in ipairs(computed_fields) do
					row[f.index] = repl(f.compute(rs, vals), nil, null)
				end
				for k in pairs(vals) do
					vals[k] = nil
				end
			end
		end

	end

	local function update_client_fields()
		for i,f in ipairs(rs.client_fields) do
			for k,v in pairs(f) do
				local v = rs.fields[i][k]
				if isfunc(v) then --value getter/generator
					f[k] = v()
				end
			end
		end
	end

	rs.compute_row_vals = noop

	local repl = repl

	function rs:load(param_values)
		local res = {}
		rs:load_rows(res, param_values)
		assert(res.rows[1] == nil or istab(res.rows[1]),
			'first row not a table')
		if update_computed_fields then
			for _,row in ipairs(res.rows) do
				update_computed_fields(row)
			end
		end
		update_client_fields()
		merge(res, {
			can_add_rows = rs.can_add_rows,
			can_remove_rows = rs.can_remove_rows,
			can_change_rows = rs.can_change_rows,
			can_move_rows = rs.can_move_rows,
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

	local function reload_row(op, rt, row_values)
		if not rs.load_row then return end
		local ok, row = catch('db', rs.load_row, rs, row_values)
		if ok then
			if op == 'insert' or op == 'update' then
				if not row then
					if op == 'insert' then
						rt.error = S('inserted_record_not_found',
							'Inserted record could not be loaded back')
					else
						rt.remove = true
						rt.error = S('updated_record_not_found',
							'Updated record could not be loaded back')
					end
				else
					if update_computed_fields then
						update_computed_fields(row)
					end
					rt.values = row
				end
			elseif row and op == 'delete' then
				rt.error = S('removed_record_found',
					'Removed record is still in db')
			end
		else
			local err = row
			if op == 'insert' then
				rt.error = db_error(err,
					S('load_inserted_record_error',
						'Error on loading back inserted row'))
			elseif op == 'update' then
				rt.error = db_error(err,
					S('load_updated_record_error',
						'Error on loading back updated record'))
			elseif op == 'delete' then
				rt.error = db_error(err,
					S('load_removed_record_error',
						'Error on loading back removed record'))
			else
				assert(false)
			end
		end
		return not rt.error
	end

	function rs:validate_fields(values, only_present_values)
		local errors
		for i,fld in ipairs(rs.fields) do
			if fld.validate then
				local val = values[fld.name]
				if val ~= nil or only_present_values then
					local err = fld.validate(val, fld, rs)
					if isstr(err) then
						errors = errors or {}
						errors[fld.name] = err
					end
				end
			end
		end
		return errors
	end

	local function db_error(err, s)
		return catany(':\n', s, err and err.message)
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
		local errors = rs:validate_fields(values, true)
		if errors then return false, nil, errors end
	end

	function rs:can_remove_row(values)
		if rs.can_remove_rows == false then
			return false, 'removing rows is not allowed'
		end
	end

	function rs:rowset_changed(rowset_name, filter)
		if filter then rowset_name = rowset_name..':'..filter end
		self.changed_rowsets[rowset_name] = true
	end

	function rs:table_changed(table_name)
		local rowsets = rowset_tables[table_name]
		if rowsets then
			for rowset_name in pairs(rowsets) do
				self:rowset_changed(rowset_name)
			end
		end
	end

	function rs:apply_changes(changes, update_id)

		local res = {rows = {}}
		local self = object(rs)
		self.changed_rowsets = {}
		local rowset_changed = true

		for _,row in ipairs(changes.rows) do
			local rt = {type = row.type}
			if row.type == 'new' then
				local can, err, field_errors = rs:can_add_row(row.values)
				if can ~= false then
					local ok, err = catch('db', rs.insert_row, self, row.values)
					if ok then
						if reload_row('insert', rt, row.values) then
							rowset_changed = true
						end
					else
						if err.col then
							rt.field_errors = {[err.col] = err.message}
						else
							rt.error = db_error(err)
						end
					end
				else
					rt.error = err or true
					rt.field_errors = field_errors
				end
			elseif row.type == 'update' then
				local can, err, field_errors = rs:can_change_row(row.values)
				if can ~= false then
					local ok, err = catch('db', rs.update_row, self, row.values)
					if ok then
						--copy :foo:old to :foo so we can select the row back.
						for k,v in pairs(row.values) do
							local k1 = k:match'^(.-):old$'
							if k1 and row.values[k1] == nil then
								row.values[k1] = v
							end
						end
						if reload_row('update', rt, row.values) then
							rowset_changed = true
						end
					else
						if err.col then
							rt.field_errors = {[err.col] = err.message}
						else
							rt.error = db_error(err)
						end
					end
				else
					rt.error = err or true
					rt.field_errors = field_errors
				end
			elseif row.type == 'remove' then
				local can, err, field_errors = rs:can_remove_row(row.values)
				if can ~= false then
					local ok, err = catch('db', rs.delete_row, self, row.values)
					if ok then
						if reload_row('delete', rt, row.values) then
							rowset_changed = true
						end
					else
						rt.error = db_error(err)
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

		if rowset_changed then
			self:rowset_changed(rs.name, args'filter')
		end
		push_rowset_changed_events(self.changed_rowsets, update_id)

		return res
	end

	local function download_as_xlsx(rs_name, rs)
		setheader('content-disposition', {'attachment', filename = rs_name..'.xlsx'})
		local file = tmppath('rowset-{name}-{request_id}.xlsx', {name = rs_name})
		local wb = assert(xlsx_workbook:new(file))
		fcall(function(finally, onerror)
			onerror(function()
				if wb then wb:close() end
				fs.remove(file)
			end)
			local ws = wb:add_worksheet()
			local bold = wb:add_format({bold = true})
			local d    = wb:add_format({num_format = country('date_format')})
			local dt   = wb:add_format({num_format = country('date_format')..' hh:mm'})
			local dts  = wb:add_format({num_format = country('date_format')..' hh:mm:ss'})
			for i,field in ipairs(rs.fields) do
				ws:write(0, i-1, field.label or capitalize(field.name), bold)
				local w = field.display_width
				w = field.hidden and 1 or w and min(32, w)
				local fmt
				if field.type == 'date' then
					fmt = field.precision == 'd' and d
						or field.precision == 's' and dts or dt
				end
				if w or fmt then
					ws:set_column(i-1, i-1, w, fmt)
				end
			end
			for i,row in ipairs(rs.rows) do
				for j,field in ipairs(rs.fields) do
					local v = row[j]
					if v ~= null then
						if field.type == 'date' then
							v = v:gsub(' ', 'T')
							ws:write_date_string(i, j-1, v)
						else
							ws:write(i, j-1, v)
						end
					end
				end
			end
			wb:close()
			wb = nil
			outfile(file)
			rm(file)
		end)
	end

	function rs:respond(rowset_name, out_format)
		rs.name = rowset_name
		if isfunc(rs.allow) then
			allow(rs:allow())
		elseif isstr(rs.allow) then
			allow(usr('roles')[rs.allow])
		end
		local filter = json_decode(args'filter', null) or {}
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
		local rs = method(rs, params, post)

		if out_format == 'json' then
			return rs
		elseif out_format == 'xlsx' then
			download_as_xlsx(rowset_name, rs)
		else
			assert(false)
		end
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
		return rs:apply_changes(post.changes, post.update_id)
	end

	init(rs, ...)
	if not rs.manual_init_fields then
		rs:init_fields(true)
	end

	rs.__call = rs.respond

	return rs
end

--reload push-notifications --------------------------------------------------

local waiting_events_threads = {}
local changed_rowsets = {} --{req->{rowset->'update_id1 ...'}}

function rowset_changed(rowset_name, update_id, push_to_clients)
	local rowsets = istab(rowset_name) and rowset_name or {[rowset_name] = true}
	push_rowset_changed_events(rowsets, update_id or 'server', push_to_clients)
end

function table_changed(table_name, update_id, push_to_clients)
	local rowsets = rowset_tables[table_name]
	push_rowset_changed_events(rowsets, update_id, push_to_clients)
end

--[[local]] function push_rowset_changed_events(rowsets, update_id, push_to_clients)
	if rowsets then
		for rowset_name in pairs(rowsets) do
			for _, rt in pairs(changed_rowsets) do
				rt[rowset_name] = catany(' ', rt[rowset_name], update_id)
			end
		end
	end
	if push_to_clients ~= false then
		for thread in pairs(waiting_events_threads) do
			resume(thread)
		end
	end
end

action['xrowset.events'] = function()
	setheader('cache-control', 'no-cache')
	setconnectionclose()
	setcompress(false)
	local waiting_thread
	local rowsets = {}
	local req = http_request()
	changed_rowsets[req] = rowsets
	local function resume_waiting_thread()
		changed_rowsets[req] = nil
		if waiting_thread then
			return resume(waiting_thread, 'closed')
		end
	end
	--when client closes the socket...
	http_request():onfinish(resume_waiting_thread)
	--when we close the socket from another thread...
	http_request().http.f:onclose(resume_waiting_thread)
	while true do
		if isempty(rowsets) then
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
		for rowset_name, update_ids in pairs(rowsets) do
			t[#t+1] = 'data: '..rowset_name..' '..update_ids..'\n\n'
			rowsets[rowset_name] = nil
		end
		local events = concat(t)
		assert(not out_buffering())
		out(events)
	end
end
