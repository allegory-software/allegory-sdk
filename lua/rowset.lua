--[[

	Server-side rowsets for nav-based widgets.
	Written by Cosmin Apreutesei. Public Domain.

Rowset attributes to set (* = server-only):

	REQUIRED
		fields           : [field1, ...] fields (required)
		rows             : [row1,...]    values: rows[ri][fi] = val, or:
		col_vals         : [vals1,...]   values: col_vals[fi][ri] = val
		pk               : 'col1 ...'    primary key (required)
	OPTIONAL
		label            : 'Foo Bar'     label of a master in a detail's toggle
	*	field_attrs      : {col->field}  extra field attributes
		cols             : 'col1 ...'    default visible columns list
	*	hide_cols        : 'col1 ...'    columns hidden by default
		pos_col          : 'col'         pos column for manual ordering of rows
		params           : {name->def}   params, each def a field def plus:
		  .for_cols      : 'col1 ...'    the param filters these cols
		  .accept_many   : false         the param can only take one value
		uks              : ['col1 ...',] unique keys (to validate on the client)
	TREE
		id_col           : 'col'         id column for tree-building
		parent_col       : 'col'         parent column for tree-building
		tree_col         : 'col'         tree column (the one with [+] icons)
	ACCESS
	*	ro_cols          : 'col1 ...'    read-only columns
	*	rw_cols          : 'col1 ...'    read-write columns
		can_add_rows     : f             allow adding new rows
		can_remove_rows  : f             allow removing rows
		can_change_rows  : f             allow editing existing rows
		can_move_rows    : f             allos changing rows' position in the rowset
	*	allow            : f|'r1 ...'    allow only if current user has a matching role

Field attributes to set:

	REQUIRED
		name             : 'col'         for identification and referencing
		type             : 'number'|...  client-side type
	DISPLAY
		label            : 'Foo Bar'     input-box label / grid column label
		info             : '...'         input-box info / grid column info
		align            : 'left'|'right'|'center'   cell alignment
		w                : px            default grid column width
		min_w            : px            min grid column width
		max_w            : px            max grid column width
		null_text        : ''            text for null
		empty_text       : ''            text for ''
		internal         : t             cannot be made visible
		hidden           : t             not visible by default
	EDITING
		client_default   : val           value that new rows start with
		has_server_default: t            the server fills this in for new rows
		auto_increment   : t             id reserved before save
		readonly         : f             cannot be changed
		nosave           : f             client-side; should not be saved
		not_null         : t             can't be null
	COMPUTED
		compute          : f(rs, vals) -> val   comppute value
	TEXT
		maxlen           : n             max length in bytes
		sort_collation   : signature     'ai_ci' or 'list\0ITEM1\0ITEM2...'
	NUMBER
		min              : n             min allowed value
		max              : n             max allowed value
		decimals         : n             number of decimals
		scale            : n             scale for fixed-point decimal numbers
		slider_min       : n             slider display range min
		slider_max       : n             slider display range max
		slider_markers   : b             show slider markers
		slider_scale_base: n             slider marker scale base
		slider_scales    : {n...}        slider marker scale multiples
	ENUM
		enum_values      : ['foo',...]   enum values
		enum_labels      : {v->label}    enum labels in current language
		enum_info        : {v->info}     enum info in current language
	DATE/TIME/TIMEOFDAY
		hour_step        : n             for the time picker
		minute_step      : n             for the time picker
		second_step      : n             for the time picker
		precision        : 'd|s|ms'      date type precision
		timeago          : f             format as relative time (see format_timeago())
	DURATION
		duration_format  :               format for duration type (see format_duration())
	FILESIZE
		magnitude        : 'K|M|G|..'    unit to pin to, filesize/count types
		magnitude_decimals: n            decimals shown at that magnitude
		gray_min         : n             filesize type: below this, draw gray
	LOOKUP
		lookup_rowset_name:              lookup rowset name
		lookup_cols      :               lookup rowset cols
		display_col      :               lookup display col

Methods to implement:

		prepare()                        prepare rowset (called on first request)
		load_rows(result, param_vals, load_opt)
		insert_row(vals)
		update_row(vals)
		delete_row(vals)
		load_row(vals)
		load_changed_rows(result, param_vals, since_txn_id)   optional
		reserve_ids(n) -> {id1,...}    required for a single auto_increment pk

	param_vals is {name -> val}: the request's values for rs.params. The row
	methods read them from self.param_vals. load_opt is {recursive = true |
	false}: load whole subtrees, or one level below the requested parents.

	reserve_ids() is for reserving ids from server and assigning them by the
	client before saving the row in order to prevent double-inserts on network
	loss. the server will refuse the second insert with the same id.

Sets by default:

	- `can_[add|change|remove]_rows` are set to false on missing row update methods.
	- `pos_col` and `parent_col` are set to hidden by default.
	- on client-side, `id_col` is set to pk if pk is single-column.

API

	push_rowset_changed_events({rowset_name->true}, txn_id)
	decode_params({name->def}) -> {name->val}   the request's params
	dynamic_rowset(match_name, create_rowset)

ACTIONS

	rowset.json               named rowsets action
	rowset.events             rowset-refresh push-notifications

]]

require'webb_action'

require'glue'
local xlsx_workbook = require'xlsxwriter.workbook'

local rowset_mt = {}
rowset = setmetatable({}, rowset_mt)

function dynamic_rowset(match_name, create_rowset)
	if isstr(match_name) then
		local patt = match_name
		match_name = function(rs_name)
			return rs_name:match(patt)
		end
	end
	override(rowset_mt, '__index', function(inherited, self, rs_name)
		local rs = inherited(self, rs_name)
		if rs == nil then
			local name = match_name(rs_name)
			if name then rs = create_rowset(name) end
		end
		rawset(self, rs_name, rs)
		return rs
	end)
end

action['rowset.json'] = function(name)
	return checkfound(rowset[checkarg(name)])(name, 'json')
end

action['rowset.xlsx'] = function(name)
	return checkfound(rowset[checkarg(name)])(name, 'xlsx')
end

local client_field_attrs = {
	internal=1, hidden=1, readonly=1, null_text=1,
	filter = 1,
	icon = 1,
	name=1, type=1, label=1, info=1, client_default=1, align=1,
	has_server_default=1, auto_increment=1,
	enum_values=1, enum_labels=1, enum_info=1, not_null=1, min=1, maxlen=1,
	scale=1, decimals=1,
	slider_min = 1, slider_max = 1,
	slider_markers = 1, slider_scale_base = 1, slider_scales = 1,
	lookup_rowset_name=1, lookup_cols=1, display_col=1,
	w=1, min_w=1, max_w=1,
	hour_step=1, minute_step=1, second_step=1, precision=1,
	timeago=1, duration_format=1,
	magnitude=1, magnitude_decimals=1, gray_min=1,
	max = 1, control = 1, empty_text = 1, focusable = 1, sortable = 1,
	local_cols = 1, null_lookup_col = 1, nosave = 1,
}

--the field attrs that describe a value, without the column and row attrs,
--plus the param attrs.
local client_param_attrs = { -- {attr -> 1}
	for_cols = 1, accept_many = 1,
	type = 1, label = 1, info = 1, align = 1,
	not_null = 1, min = 1, max = 1, maxlen = 1,
	scale = 1, decimals = 1, precision = 1,
	enum_values = 1, enum_labels = 1, enum_info = 1,
	slider_min = 1, slider_max = 1,
	slider_markers = 1, slider_scale_base = 1, slider_scales = 1,
	hour_step = 1, minute_step = 1, second_step = 1,
	timeago = 1, duration_format = 1,
	magnitude = 1, magnitude_decimals = 1, gray_min = 1,
	lookup_rowset_name = 1, lookup_cols = 1, display_col = 1,
	control = 1, null_text = 1, empty_text = 1,
}

local row_errtypes = 'row field'

--most specific text: in this rowset, in this table, anywhere, then en_text.
--rowset ids are keyed by name, table ids by col, per xlang.lua.
local function S_text(attr, en_text, name, col, tbl_name, rowset_name)
	return rowset_name and S(_('%s:%s.%s.rowset', attr, name, rowset_name))
		or tbl_name and S(_('%s:%s.%s.table', attr, col, tbl_name))
		or S(_('%s:%s', attr, name)) or en_text
end

local function resolve_enum_texts(t, en_attr, attr, text_attr)
	if not t[en_attr] then return end
	t[attr] = function(rowset_name)
		local name, col = t.name or t.col, t.col or t.name
		local texts = {}
		for i, v in ipairs(t.enum_values) do
			texts[v] = S_text(text_attr, t[en_attr][v],
				name..'.'..v, col..'.'..v, t.table, rowset_name)
		end
		return texts
	end
end

local function make_translatable_fields_attrs(t)
	for i,attr in ipairs{'label', 'info'} do
		local en_attr = 'en_'..attr
		t[attr] = function(rowset_name)
			return S_text(attr, call(t[en_attr]), t.name, t.col or t.name,
				t.table, rowset_name)
		end
	end
	--enum ids carry the value after the col.
	resolve_enum_texts(t, 'en_enum_labels', 'enum_labels', 'enum_label')
	resolve_enum_texts(t, 'en_enum_info', 'enum_info', 'enum_info')
end

--a param takes a list of values, or its first tuple if accept_many
--is false: a value, or a list of values for a composite param.
--names that the rowset doesn't declare are ignored.
function decode_params(param_defs)
	local param_vals = {} -- {name -> val}
	for name, vals in pairs(post'params' or empty) do
		local def = param_defs[name] -- param def, or nil
		if def then
			if def.accept_many == false and #vals > 0 then
				--tuple size
				local n = def.for_cols and #collect(words(def.for_cols)) or 1
				if n == 1 then
					vals = vals[1]
				else
					vals = {unpack(vals, 1, n)}
				end
			end
			param_vals[name] = vals
		end
	end
	return param_vals
end

function virtual_rowset(init, ...)

	local rs = {}
	setmetatable(rs, rs)

	local update_computed_fields

	rs.after = after
	rs.before = before
	rs.override = override

	function rs.init_fields(rs, resolve_types)

		if resolve_types ~= false then --assume fields are not resolved
			local schema = config'db_schema'
			if schema then
				for i,f in ipairs(rs.fields) do
					schema:resolve_type(f)
				end
			end
		end

		for i,f in ipairs(rs.fields) do
			assertf(isstr(f.name), 'field name not a string: %s: %s', rs.name, type(f.name))
			assertf(not rs.fields[f.name], 'duplicate field name: %s.%s', rs.name, f.name)
			rs.fields[i] = f
			rs.fields[f.name] = f
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
				pos_field.w = 3
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
			make_translatable_fields_attrs(f)
			update(f, rs.field_attrs and rs.field_attrs[f.name])

			if f.compute then
				computed_fields = computed_fields or {}
				add(computed_fields, f)
				f.readonly = true
			end
			if f.default_expr or f.default_fn or f.auto_increment then
				f.has_server_default = true
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
					f[k] = v(rs.name)
				end
			end
		end
	end

	rs.compute_row_vals = noop

	local repl = repl

	local function check_no_rows(param_vals)
		for name, def in pairs(rs.params or empty) do
			local v = param_vals[name] -- [val, ...], val, or nil
			--missing non-col param: no rows
			if v == nil and not def.for_cols then
				return true
			elseif istab(v) and #v == 0 then --empty list: no rows
				return true
			end
		end
	end

	function rs:load(param_vals, load_opt)
		local res = {}
		if check_no_rows(param_vals) then
			res.rows = {}
		else
			rs:load_rows(res, param_vals, load_opt)
		end
		assert(res.rows[1] == nil or istab(res.rows[1]),
			'first row is not a table')
		if update_computed_fields then
			for _,row in ipairs(res.rows) do
				update_computed_fields(row)
			end
		end
		update_client_fields()
		rs.client_params = {} -- {name -> client field def}
		for name, def in pairs(rs.params or empty) do
			local client_param = {} -- {client attr -> value}
			for k, v in pairs(def) do
				if client_param_attrs[k] then
					if isfunc(v) then --value getter/generator
						v = v(rs.name)
					end
					client_param[k] = v
				end
			end
			rs.client_params[name] = client_param
		end
		merge(res, {
			can_add_rows = rs.can_add_rows,
			can_remove_rows = rs.can_remove_rows,
			can_change_rows = rs.can_change_rows,
			can_move_rows = rs.can_move_rows,
			can_load_changed_rows = rs.load_changed_rows ~= nil,
			label = rs.label,
			fields = rs.client_fields,
			params = rs.client_params,
			pk = rs.pk,
			pos_col = rs.pos_col or nil,
			cols = rs.cols,
			id_col = rs.id_col,
			parent_col = rs.parent_col,
			tree_col = rs.tree_col,
			has_children_col = rs.has_children_col,
		})
		return res
	end

	local function db_error(err, s)
		return catany(':\n', s, err and err.message)
	end

	local function reload_row(op, rt, row_values)
		if not rs.load_row then return end
		local ok, row = catch(row_errtypes, rs.load_row, rs, row_values)
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
	end

	function rs:validate_fields(values, only_present_values)
		local errors
		for i,fld in ipairs(rs.fields) do
			if fld.validate then
				local val = values[fld.name]
				if val ~= nil or not only_present_values then
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

	function rs:apply_changes(changes, param_vals)

		update_client_fields()
		local res = {rows = {}, fields = rs.client_fields}
		local self = object(rs)
		self.param_vals = param_vals -- {name -> val}
		--rows that the row ops changed besides the sent rows, in field order.
		self.changed_rows = {}

		for _,row in ipairs(changes.rows) do
			local rt = {type = row.type}
			if row.type == 'new' then
				local can, err, field_errors = rs:can_add_row(row.values)
				if can ~= false then
					local ok, err = catch(row_errtypes, rs.insert_row, self, row.values)
					if ok then
						reload_row('insert', rt, row.values)
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
					local ok, err = catch(row_errtypes, rs.update_row, self, row.values)
					if ok then
						--copy :foo:old to :foo so we can select the row back.
						for k,v in pairs(row.values) do
							local k1 = k:match'^(.-):old$'
							if k1 and row.values[k1] == nil then
								row.values[k1] = v
							end
						end
						reload_row('update', rt, row.values)
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
					local ok, err = catch(row_errtypes, rs.delete_row, self, row.values)
					if ok then
						reload_row('delete', rt, row.values)
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

		if self.changed_rows[1] then
			if update_computed_fields then
				for _, row in ipairs(self.changed_rows) do
					update_computed_fields(row)
				end
			end
			res.changes = {rows = self.changed_rows}
		end

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
				local w = field.w and round(field.w * 1.3) --width in chars
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
		local post = post() or empty
		local method = post.exec or 'load'
		local method = checkfound(rs['exec_'..method], 'command not found')
		if rs.prepare then rs:prepare() end --prepare() sets rs.params
		local param_vals = decode_params(rs.params or empty) -- {name -> val}
		local res = method(rs, param_vals, post)

		if out_format == 'json' then
			return res
		elseif out_format == 'xlsx' then
			download_as_xlsx(rowset_name, res)
		else
			assert(false)
		end
	end

	function rs:exec_load(params, post)
		return rs:load(params, {recursive = post.recursive ~= false})
	end

	function rs:exec_load_changed_rows(params, post)
		local res = {}
		if rs.load_changed_rows then
			rs:load_changed_rows(res, params, post.since_txn_id)
		else
			res.reload = true
		end
		res.can_load_changed_rows = rs.load_changed_rows ~= nil
		if update_computed_fields and not res.reload then
			for _, row in ipairs(res.rows) do
				update_computed_fields(row)
			end
		end
		return res
	end

	function rs:exec_save(params, post)
		return rs:apply_changes(post.changes, params)
	end

	--the client asks for ids before its first save of new rows, so that a
	--resent insert carries the same id and the backend can recognize it.
	function rs:exec_reserve_ids(params, post)
		checkfound(rs.reserve_ids, 'command not found')
		local n = checkarg(tonumber(post.n))
		checkarg(n >= 1 and n <= 1000 and n == floor(n))
		return {ids = rs:reserve_ids(n)}
	end

	init(rs, ...)
	if not rs.manual_init_fields then
		rs:init_fields()
	end

	rs.__call = rs.respond

	return rs
end

rowset.rowsets = virtual_rowset(function(rs) --rowset reflection
	rs.fields = {
		{name = 'name'}
	}
	rs.pk = 'name'
	function rs:load_rows(res, params)
		res.rows = {}
		for name, rs in sortedpairs(rowset) do
			add(res.rows, {name})
		end
	end
end)

--reload push-notifications --------------------------------------------------

local waiting_events_threads = {}
local changed_rowsets = {} --{req->{rowset->'txn_id1 ...'}}

function push_rowset_changed_events(rowsets, txn_id)
	for rowset_name in pairs(rowsets) do
		for _, rt in pairs(changed_rowsets) do
			rt[rowset_name] = catany(' ', rt[rowset_name], txn_id)
		end
	end
	for thread in pairs(waiting_events_threads) do
		resume(thread)
	end
end

action['rowset.events'] = function()
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
	http_request().tcp:onclose(resume_waiting_thread)
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
		for rowset_name, txn_ids in pairs(rowsets) do
			t[#t+1] = 'data: '..rowset_name..' '..txn_ids..'\n\n'
			rowsets[rowset_name] = nil
		end
		local events = concat(t)
		assert(not out_buffering())
		out(events)
	end
end
