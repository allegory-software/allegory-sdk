--[[

	MDBX rowsets.
	Written by Cosmin Apreutesei. Public Domain.

API
	scan_rowset       (opt) -> rs     rowset over a table scan
	prepare_rowsets   ()              prepare all rowsets (validates schema)
	watch_row_changes (db)            push changed rowsets to events clients
	changed_rowsets_since(db, txn_id) -> {rowset_name->true}, txn_id

	rowset.lookup_TABLE               lookup rowset, created on first access
	rowset.table_TABLE                full table rowset, created on first access

SCAN ROWSET OPTIONS

	scan     fn(db, param_names) -> scan
	                           required; must end in select(); see COL PARAMS
	pk       'col1 ...'        required; output names, not table cols; when
	                           they are a table's pk, in that table's pk order
	db       db                optional; defaults to the app db
	is_lookup bool             optional; omit FK lookup attributes
	on_rows_changed            optional; see LOADING CHANGED ROWS

	plus every rowset.lua property (cols, hide_cols, ro_cols, rw_cols, etc.

	Fields come from the scan's output cols. An output col that comes from a
	table col gets its type, label, enum values, bounds and defaults from the
	paper schema. One that doesn't -- an expression, an aggregate -- is
	read-only and untyped.

	Table actions are published as rowset actions if the rowset has table's pk.

COL PARAMS

	A col param is a param with for_cols and without client_filter. A request
	can omit it, and then it doesn't filter. So the scan can take a different
	access path for each set of col params present: the rowset calls
	rs.scan(db, param_names) once per set, with param_names {name -> true},
	keeps that scan, and loads and fetches with it. Every scan must output the
	same cols and read the same tables as the scan for no params, which the
	rowset takes its fields and table deps from.

	Example: table_* rowsets scan the fk's index when the request has the fk
	param, and the whole table when it doesn't.

WRITING

	One table is written: the one whose rows match the rowset's rows
	one-to-one, per the pk. Its cols are writable, every other col is
	read-only. To edit a joined-in table, use that table's own rowset.

	Saving runs in one write transaction with a child transaction per changed
	row, so a failed row rolls back alone.

	When the write table's pk is its auto-inc col alone, the client reserves
	ids before saving new rows (reserve_ids() advances the table's sequence),
	and a new row whose pk is already in the table gets an already_exists
	error.

LOADING CHANGED ROWS

	The client asks for the rows changed since its last load. The rowset reads
	the row change notification records containing the scan's source tables,
	and rebuilds the affected rowset rows if it can. If it can't, it tells the
	client to reload everything.

	For simple scans, the scanner can rebuild the rows itself. For complex
	scans you need to implement rs:on_rows_changed() to avoid full reloads.

	rs:on_rows_changed (changes, param_vals) -> {rows=, removed_pks=} | false

		changes      iter() -> table, pk_val1, ...: the changed source rows,
		             once per change, so a row can come more than once.
		rows         changed and added rows, in field order.
		removed_pks  pks of the rows to remove, in rs.pk order.
		false        the client reloads everything.

]]

require'rowset'
require'mdbx_scan'
require'glue'

local table_rowset_deps = {} -- {db -> {table -> {rowset_name -> true}}}

--a lookup rowset has a one-col key, so fks over several cols have none.
local function fks_by_col(schema)
	local fks = {}
	for _, fk in pairs(schema.fks or empty) do
		if #fk.cols == 1 then fks[fk.cols[1]] = fk end
	end
	return fks
end

--a link table's pk cols are each a single-col fk.
local function is_link_table(schema)
	local fks = fks_by_col(schema)
	for _, col in ipairs(schema.pk) do
		if not fks[col] then return false end
	end
	return true
end

--the client sends a row's key under 'COL:old', a changed value under 'COL'.
local function val_or_old(vals, name)
	local v = vals[name]
	if v == nil then v = vals[name..':old'] end
	return v
end

--so the client shows and picks a name instead of a raw fk value.
local function set_lookup_attrs(db, fields)
	for _, f in ipairs(fields) do
		if f.table then
			local fk = fks_by_col(db:table_schema(f.table))[f.col]
			if fk then
				local lrs_name = 'lookup_'..fk.ref_table
				local lrs = rowset[lrs_name]
				f.lookup_rowset_name = lrs_name
				f.display_col = lrs.name_col
				f.lookup_cols = fk.ref_cols[1]
				local ref_schema = db:table_schema(fk.ref_table)
				local display_field = ref_schema.fields[lrs.name_col]
				f.icon = ref_schema.icon or display_field and display_field.icon
					or f.icon
			end
		end
	end
end

--the one table whose rows match the rowset's rows one-to-one: every pk output
--col comes from it, and together they are exactly its pk.
local function find_write_table(db, out_specs, pk)
	local tbl, cols = nil, {} -- cols: {col -> position in pk}
	for i, name in ipairs(pk) do
		local spec = assertf(out_specs[name], 'pk col not in output: %s', name)
		if not spec.table or (tbl and spec.table ~= tbl) then return end
		tbl = spec.table
		cols[spec.col] = i
	end
	local table_pk = db:table_schema(tbl).pk
	if #table_pk ~= #pk then return end
	for _, col in ipairs(table_pk) do
		if not cols[col] then return end
	end
	for i, col in ipairs(table_pk) do
		assertf(cols[col] == i, 'pk cols not in the pk order of table %s', tbl)
	end
	return tbl
end

--row change notifications ---------------------------------------------------

local function init_load_changed_rows(rs, source_tables, load_scan_changed_rows)

	local function rs_db()
		return rs.db or db()
	end

	local pk_decoders -- {table -> fn(raw_pk) -> pk_val1, ...}

	local function load_changed_rows(self, res, param_vals, since_txn_id)
		local db = rs_db()
		res.txn_id = db:txn_id()
		--read the batches while the handler iterates the changes; a gap
		--ends the iteration and the handler's result is discarded.
		local next_batch = db:read_changes(since_txn_id)
		local next_row -- iter() -> table, raw_pk over the current batch
		local has_gap -- a gap was found: the client must reload
		local function next_change()
			while true do
				if next_row then
					local tbl, raw_pk = next_row()
					if tbl then
						if pk_decoders then
							return tbl, pk_decoders[tbl](raw_pk)
						else
							return tbl, raw_pk
						end
					end
				end
				local txn_id, batch, gap = next_batch()
				if not txn_id then return end
				if gap then
					has_gap = true
					return
				end
				next_row = db:each_row_change(batch, source_tables)
			end
		end
		local changes -- {rows, removed_pks} | false
		if rs.on_rows_changed then
			changes = rs:on_rows_changed(next_change, param_vals)
		else
			changes = load_scan_changed_rows(next_change, param_vals)
		end
		if has_gap or changes == false then
			res.reload = true
			return
		end
		res.rows = changes.rows or {}
		res.removed_pks = changes.removed_pks or {}
	end

	local db = rs_db()
	if rs.on_rows_changed then
		pk_decoders = {}
		for tbl in pairs(source_tables) do
			local schema = db:table_schema(tbl)
			local key_rec = MDBX_val() -- {data, size}, encoded source PK
			local getters = {} -- {key_i -> get()}, source-PK order
			for key_i, col in ipairs(schema.pk) do
				getters[key_i] = db:col_decoder(schema, col,
					nil, key_rec)
			end
			local n = #getters -- pk col count
			local pk_vals = {} -- reused for every row: {val1, ...}
			pk_decoders[tbl] = function(raw_pk)
				key_rec.data, key_rec.size = raw_pk, #raw_pk
				for key_i = 1, n do pk_vals[key_i] = getters[key_i]() end
				return unpack(pk_vals, 1, n)
			end
		end
	end
	if rs.on_rows_changed or load_scan_changed_rows then
		function rs:load_changed_rows(...)
			return rs_db():atomic('r', load_changed_rows, self, ...)
		end
	end

end

local function scan_rowset_init(rs, opt, ...)

	update(rs, opt, ...)

	assert(rs.scan, 'scan missing')
	rs.pk = collect(words(assert(rs.pk, 'pk missing')))
	assert(#rs.pk > 0, 'pk empty')

	rs.manual_init_fields = true

	local scan     --the prepared scan, built on first use
	local scans_by_params = {} --{'NAME1 NAME2' -> scan}; params sorted; '' for none.
	local row_scan        --loads one row by params + pk; nil if it can't be built
	local is_prepared     --prepare() ran to the end
	local write_table
	local key_names = {}  --{NAME,...} outputs holding write_table's pk
	local key_cols  = {}  --{COL,...}  the pk cols themselves
	local seq_name        --output holding write_table's auto-inc col
	local is_seq_pk       --the auto-inc col is the whole pk: ids reservable

	local insert_row, update_row, delete_row, load_row --fw. decl.
	local reserve_ids --fw. decl.
	local changed_rows_loader, load_scan_changed_rows --fw. decl.

	local function rs_db()
		return rs.db or db()
	end

	--the scan for the col params present in a request (see COL PARAMS),
	--built on first use. needs a transaction: building a scan resolves its
	--table schema.
	local function scan_for_params(param_vals)
		local names = {} -- {name1, ...}
		local param_names = {} -- {name -> true}
		for name, def in pairs(rs.params) do
			if def.for_cols and not def.client_filter
				and param_vals[name] ~= nil
			then
				add(names, name)
				param_names[name] = true
			end
		end
		sort(names)
		local key = cat(names, ' ')
		local scan = scans_by_params[key]
		if not scan then
			scan = rs.scan(rs_db(), param_names):null_value(null)
			scans_by_params[key] = scan
		end
		return scan
	end

	--building a scan resolves its table schema, which needs a transaction,
	--so this runs on the first request rather than at load time.
	local function prepare()
		local db = rs_db()
		--rs.params is not complete yet: the scan for no params adds its args.
		scan = rs.scan(db, empty):null_value(null)
		scans_by_params[''] = scan

		local fields = {}
		for i, name in ipairs(scan.out_cols) do
			local spec = scan.out_specs[name]
			local f
			if spec.table then
				f = update({}, db:table_schema(spec.table).fields[spec.col])
				f.table = spec.table
			else
				f = {readonly = true}
			end
			f.name = name
			f.index = i
			fields[i] = f
		end
		rs.fields = fields

		write_table = find_write_table(db, scan.out_specs, rs.pk)

		for _, f in ipairs(fields) do
			if f.table ~= write_table then f.readonly = true end
		end

		if write_table then
			local schema = db:table_schema(write_table)
			local name_of_col = {}
			for _, f in ipairs(fields) do
				if f.table == write_table then
					name_of_col[f.col] = f.name
				end
			end
			for i, col in ipairs(schema.pk) do
				key_names[i] = name_of_col[col]
				key_cols[i] = col
			end
			local seq_field = schema.autoinc_field
			seq_name = seq_field and name_of_col[seq_field.col]
			is_seq_pk = seq_name ~= nil and #key_names == 1
				and key_names[1] == seq_name
			rs.insert_row = insert_row
			rs.update_row = update_row
			rs.delete_row = delete_row
			if is_seq_pk then rs.reserve_ids = reserve_ids end

			--add table actions to rowset actions.
			if schema.actions then
				rs.actions = extend({}, rs.actions)
				local names = {} -- {action name -> true}
				for _, action in ipairs(rs.actions) do
					names[action.name] = true
				end
				for _, action in ipairs(schema.actions) do
					assertf(not names[action.name],
						'rowset %s: action name taken: %s', rs.name, action.name)
					names[action.name] = true
					add(rs.actions, {
						name = action.name, label = action.label,
						reload = action.reload,
						fn = function(self, pks)
							action.fn(rs_db(), pks)
						end,
					})
				end
			end
		end

		if not rs.is_lookup then
			set_lookup_attrs(db, fields)
		end

		rs.params = rs.params or {} -- {param name -> def}
		for arg, field in pairs(scan.arg_fields) do
			if isstr(arg) then
				rs.params[arg] = update({accept_many = false}, field, rs.params[arg])
			end
		end

		--reloading one row repeats the same output over a pk lookup, which
		--is only possible with one member and every output col coming
		--from a table col.
		local member = next(scan.member_scans)
		local outputs = write_table and not next(scan.member_scans, member)
			and {}
		for i, name in ipairs(scan.out_cols) do
			local spec = scan.out_specs[name]
			if outputs and spec.col then
				outputs[i] = {name = name, member = member, col = spec.col}
			else
				outputs = nil
			end
		end
		if outputs then
			local terms = {}
			for i, col in ipairs(key_cols) do
				terms[i] = col..' = :'..key_names[i]
			end
			row_scan = db:scan(write_table, cat(terms, ', '), member)
				:select(outputs):null_value(null)
			--reload_row() reads a missing load_row() as nothing to reload,
			--but a load_row() returning nothing as the row being gone.
			rs.load_row = load_row
		end

		init_load_changed_rows(rs, scan.source_tables,
			not rs.on_rows_changed and changed_rows_loader(scan)
				and load_scan_changed_rows)

		rs:init_fields(false)

		for tbl in pairs(scan.source_tables) do
			attr(attr(table_rowset_deps, db), tbl)[rs.name] = true
		end

		is_prepared = true
	end
	function rs:prepare()
		if is_prepared then return end
		rs_db():atomic('r', prepare)
	end

	local function load_rows(res, param_vals, load_opt)
		local scan = scan_for_params(param_vals)
		if load_opt.rows then
			res.rows = scan:rows_array('[]', param_vals)
		else
			res.col_vals = scan:cols_array(param_vals)
		end
		res.txn_id = rs_db():txn_id()
	end
	function rs:load_rows(res, param_vals, load_opt)
		rs_db():atomic('r', load_rows, res, param_vals, load_opt)
	end

	--loading changed rows

	local changed_rows_loaders = {} --{scan -> load_changed_rows() | false}

	--the scan's load_changed_rows(), or false if the scan can't fetch.
	--[[local]] function changed_rows_loader(scan)
		local load = changed_rows_loaders[scan]
		if load == nil then
			load = scan:make_load_changed_rows(rs.pk) or false
			changed_rows_loaders[scan] = load
		end
		return load
	end

	--fetch with the scan for the request's col params; for a scan that
	--can't fetch, answer reload.
	--[[local]] function load_scan_changed_rows(changes, param_vals)
		local load = changed_rows_loader(scan_for_params(param_vals))
		if not load then return false end
		return load(changes, param_vals)
	end

	--[[local]] function load_row(self, vals)
		local args = {}
		for _, name in ipairs(key_names) do
			args[name] = val_or_old(vals, name)
		end
		return row_scan:first('[]', args)
	end

	local function written_vals(vals)
		local t = {}
		for _, f in ipairs(rs.fields) do
			if f.table == write_table and not f.readonly then
				local v = vals[f.name]
				if v ~= nil then t[f.col] = v end
			end
		end
		return t
	end

	--[[local]] function insert_row(self, vals)
		rs_db():atomic('w', function()
			local t = written_vals(vals)
			--written_vals() leaves the pk col out when it's read-only.
			for i, name in ipairs(key_names) do
				local v = vals[name]
				check_for('row', nil, 'insert', v ~= nil,
					'pk required: %s', name)
				t[key_cols[i]] = v
			end
			rs_db():insert(write_table, '{}', t)
		end)
	end

	--[[local]] function reserve_ids(self, n)
		return rs_db():atomic('w', function()
			local first_id = rs_db():seq(write_table, n) + 1
			local ids = {}
			for i = 1, n do ids[i] = first_id + i - 1 end
			return ids
		end)
	end

	--[[local]] function update_row(self, vals)
		rs_db():atomic('w', function()
			local db = rs_db()
			local t = written_vals(vals)
			local keys = {}
			for i, name in ipairs(key_names) do
				keys[i] = val_or_old(vals, name)
				t[key_cols[i]] = keys[i]
			end
			--row deleted by another user: write nothing; reload_row() finds
			--it gone and answers remove.
			if not db:exists(write_table, unpack(keys, 1, #key_names)) then
				return
			end
			db:update(write_table, '{}', t)
		end)
	end

	--[[local]] function delete_row(self, vals)
		rs_db():atomic('w', function()
			local keys = {}
			for i, name in ipairs(key_names) do
				keys[i] = val_or_old(vals, name)
			end
			rs_db():del(write_table, unpack(keys, 1, #key_names))
		end)
	end

	local apply_changes = rs.apply_changes
	function rs:apply_changes(...)
		return rs_db():atomic('w', apply_changes, self, ...)
	end

end

function scan_rowset(...)
	return virtual_rowset(scan_rowset_init, ...)
end

--ROW CHANGE PUSH ------------------------------------------------------------

-- -> {rowset_name -> true}, txn_id of the read txn
function changed_rowsets_since(db, since_txn_id)
	local tables = attr(table_rowset_deps, db) -- {table -> rowset_names}
	local rowset_names = {} -- {rowset_name -> true}
	local read_txn_id -- txn_id of the read txn
	db:atomic('r', function()
		for txn_id, batch, gap in db:read_changes(since_txn_id) do
			--gap: the changed tables are unknown, push every rowset.
			if gap then
				for _, names in pairs(tables) do
					update(rowset_names, names)
				end
				break
			end
			for tbl in db:each_row_change(batch, tables) do
				update(rowset_names, tables[tbl])
			end
		end
		read_txn_id = db:txn_id()
	end)
	return rowset_names, read_txn_id
end

--the db owns the thread, so db:close() cancels the thread's wait.
function watch_row_changes(db)
	local th = thread(function()
		local f = inotify() -- woken by each commit, from any process
		f:add_watch(db.file..'.changes', IN_MODIFY)
		local since_txn_id = db:atomic('r', db.txn_id, db) -- last read txn
		while true do
			f:read_event()
			local rowset_names -- {rowset_name -> true}
			rowset_names, since_txn_id = changed_rowsets_since(db, since_txn_id)
			if next(rowset_names) then
				push_rowset_changed_events(rowset_names, since_txn_id)
			end
		end
	end, 'rowset-changes %s', db.file)
	th:setowner(db)
	resume(th)
end

--STARTUP VALIDATION ---------------------------------------------------------

function prepare_table_rowsets()
	for tbl, schema in sortedpairs(db().schema.tables) do
		local name = 'table_'..tbl
		local rs = rowset[name]
		rs:prepare()
		if is_link_table(schema) then
			rowset['members_'..tbl]:prepare()
		end
	end
end

--prepare every registered rowset, to fail at startup instead of on a first
--request. run it after sync_schema(): the checking happens while resolving
--each scan's table schema. preparing one rowset can register the lookup
--rowsets for its fk cols, so keep going while new names appear.
function prepare_rowsets()
	local prepared = {}
	local found_new = true
	while found_new do
		found_new = false
		for name, rs in sortedpairs(rowset) do
			if not prepared[name] then
				prepared[name] = true
				found_new = true
				if istab(rs) then --function rowset: nothing to prepare.
					if rs.prepare then
						rs:prepare()
					end
				end
			end
		end
	end
end

--LOOKUP ROWSETS -------------------------------------------------------------

dynamic_rowset('^lookup_(.+)$', function(tbl)
	local schema = checkfound(db():atomic('any', function(tbl)
		return db():table_schema(tbl)
	end, tbl))
	local name_col = schema.name_col or schema.fields.name and 'name'
	local cols = extend({}, schema.pk)
	if name_col then
		local f = schema.fields[name_col]
		if not f then
			name_col = nil --TODO: warn here
		elseif not f.key_index then
			add(cols, name_col)
		end
	end
	local sel = cat(cols, ', ')
	return scan_rowset{
		is_lookup = true,
		scan = function(db) return db:scan(tbl, ''):select(sel) end,
		pk = cat(schema.pk, ' '),
		name_col = name_col,
		internal = true,
		can_add_rows = false,
		can_change_rows = false,
		can_remove_rows = false,
	}
end)

--TABLE ROWSETS --------------------------------------------------------------

local function table_label(tbl, schema)
	return schema.label or tbl:gsub('_', ' '):gsub('^.', string.upper)
end

dynamic_rowset('^table_(.+)$', function(tbl)
	local schema = checkfound(db():atomic('any', function(tbl)
		return db():table_schema(tbl)
	end, tbl))
	checkfound(not schema.is_index)
	local params = {}
	local pk_cols = index(schema.pk)
	for name, fk in pairs(schema.fks or empty) do
		local is_fk_on_pk = true
		for _, col in ipairs(fk.cols) do
			is_fk_on_pk = is_fk_on_pk and pk_cols[col] ~= nil
		end
		params[name] = {
			for_cols = cat(fk.cols, ' '),
			lookup_cols = cat(fk.ref_cols, ' '),
			lookup_rowset_name = 'table_'..fk.ref_table,
			client_filter = true,
			auto_bind = is_fk_on_pk or fk.ondelete == 'cascade',
		}
	end

	--the server filters by the one single-col auto_bind fk, if the table has
	--only one, through that fk's index. the nav filters by the others.
	local server_param -- fk name; false when the table has several
	for name, def in pairs(params) do
		if def.auto_bind and #schema.fks[name].cols == 1 then
			if server_param then
				server_param = false
				break
			end
			server_param = name
		end
	end
	if server_param then
		params[server_param].client_filter = false
	end

	local sel = cat(schema.cols, ', ')
	local name_col = schema.name_col or schema.fields.name and 'name'
	return scan_rowset{
		label = table_label(tbl, schema),
		category = schema.category,
		icon = schema.icon,
		scan = function(db, param_names)
			if server_param and param_names[server_param] then
				local fk = db:table_schema(tbl).fks[server_param]
				return db:scan(fk.index.name, fk.cols[1]..' in :'..server_param)
					:select(sel)
			end
			return db:scan(tbl, ''):select(sel)
		end,
		pk = cat(schema.pk, ' '),
		params = params,
		parent_col = schema.parent_col,
		tree_col = schema.parent_col and name_col,
	}
end)

--MEMBERS ROWSETS ------------------------------------------------------------

local function members_rowset_init(rs, link_table)

	rs.manual_init_fields = true
	rs.allow_unfiltered = false

	local is_prepared
	local lookups    -- {{key_col=, table=, col=, param=},...} in pk order
	local outputs    -- {{name=, member=, col=},...} in field order
	local scans = {} -- {'1'|'0' per key col's param presence -> scan}

	local function rs_db()
		return rs.db or db()
	end

	local function prepare()
		local db = rs_db()
		local schema = db:table_schema(link_table)

		local fk_names = {} -- {col -> fk name}
		for name, fk in pairs(schema.fks or empty) do
			if #fk.cols == 1 then
				fk_names[fk.cols[1]] = name
			end
		end

		local fields = {}
		outputs = {}
		local function add_field(f, member, col)
			add(fields, f)
			f.index = #fields
			outputs[f.index] = {name = f.name, member = member, col = col}
		end

		add_field({name = '$member', type = 'bool', not_null = true,
			en_label = 'Member'}, link_table, schema.pk[1])

		lookups = {}
		rs.params = {}
		for i, col in ipairs(schema.pk) do
			local fk_name = assertf(fk_names[col], 'members: no fk: %s.%s',
				link_table, col)
			local fk = schema.fks[fk_name]
			local lrs = rowset['lookup_'..fk.ref_table]
			local lookup = {
				key_col = col,
				table = fk.ref_table,
				col = fk.ref_cols[1],
				param = fk_name,
			}
			lookups[i] = lookup
			rs.params[lookup.param] = {
				for_cols = col,
				lookup_cols = lookup.col,
				lookup_rowset_name = 'table_'..lookup.table,
			}
			local f = update({}, schema.fields[col])
			f.name = col
			f.table = link_table
			f.readonly = true
			f.hidden = lrs.name_col ~= nil
			add_field(f, col, lookup.col)
		end

		for _, col in ipairs(schema.cols) do
			if not schema.fields[col].key_index then
				local f = update({}, schema.fields[col])
				f.name = col
				f.table = link_table
				add_field(f, link_table, col)
			end
		end

		for _, lookup in ipairs(lookups) do
			local lschema = db:table_schema(lookup.table)
			local name_col = rowset['lookup_'..lookup.table].name_col
			for _, col in ipairs(lschema.cols) do
				if col ~= lookup.col then
					local f = update({}, lschema.fields[col])
					f.name = lookup.key_col..'_'..col
					f.table = lookup.table
					f.readonly = true
					if col ~= name_col then f.hidden = true end
					add_field(f, lookup.key_col, col)
				end
			end
		end

		set_lookup_attrs(db, fields)

		rs.fields = fields
		rs.pk = cat(schema.pk, ' ')

		local source_tables = {[link_table] = true} -- {table -> true}
		for _, lookup in ipairs(lookups) do
			source_tables[lookup.table] = true
		end
		init_load_changed_rows(rs, source_tables)

		rs:init_fields(false)

		for tbl in pairs(source_tables) do
			attr(attr(table_rowset_deps, db), tbl)[rs.name] = true
		end

		is_prepared = true
	end
	function rs:prepare()
		if is_prepared then return end
		rs_db():atomic('r', prepare)
	end

	local function create_scan(param_vals)
		local db = rs_db()
		local scan
		local link_path = {}
		for i, lookup in ipairs(lookups) do
			local path = param_vals[lookup.param]
				and {{lookup.col, 'in_list', {arg = lookup.param}}} or ''
			local lookup_scan = db:scan(lookup.table, path, lookup.key_col)
			if scan then
				scan = scan:join(lookup_scan)
			else
				scan = lookup_scan
			end
			link_path[i] = {lookup.key_col, '=',
				{scan = lookup_scan, col = lookup.col}}
		end
		return scan:left_join(db:scan(link_table, link_path, link_table))
			:select(outputs):null_value(null)
	end

	local function read_rows(param_vals)
		local key = ''
		for _, lookup in ipairs(lookups) do
			key = key..(param_vals[lookup.param] and '1' or '0')
		end
		local scan = scans[key]
		if not scan then
			scan = create_scan(param_vals)
			scans[key] = scan
		end
		scan.close()
		local rows = scan:rows_array('[]', param_vals)
		for _, row in ipairs(rows) do
			row[1] = row[1] ~= null
		end
		return rows
	end

	local function load_rows(res, param_vals)
		res.rows = read_rows(param_vals)
		res.txn_id = rs_db():txn_id()
	end
	function rs:load_rows(res, param_vals)
		rs_db():atomic('r', load_rows, res, param_vals)
	end

	function rs:load_row(vals)
		local param_vals = {}
		for _, lookup in ipairs(lookups) do
			param_vals[lookup.param] = {val_or_old(vals, lookup.key_col)}
		end
		return read_rows(param_vals)[1]
	end

	function rs:update_row(vals)
		rs_db():atomic('w', function()
			local db = rs_db()
			local keys = {}
			for i, lookup in ipairs(lookups) do
				keys[i] = val_or_old(vals, lookup.key_col)
			end
			if vals['$member'] == false then
				db:del(link_table, unpack(keys, 1, #lookups))
			else
				local t = {}
				for i, lookup in ipairs(lookups) do
					t[lookup.key_col] = keys[i]
				end
				for _, f in ipairs(rs.fields) do
					if f.table == link_table and not f.readonly then
						local v = vals[f.name]
						if v ~= nil then t[f.col] = v end
					end
				end
				db:upsert(link_table, '{}', t)
			end
		end)
	end

	local apply_changes = rs.apply_changes
	function rs:apply_changes(...)
		return rs_db():atomic('w', apply_changes, self, ...)
	end

	function rs:on_rows_changed(changes, param_vals)
		local db = rs_db()
		local rows = {}
		local seen = {} -- {'KEY1\0KEY2...' -> true}
		local n = #lookups
		local function add_rows(param_vals)
			for _, row in ipairs(read_rows(param_vals)) do
				local k = concat(row, '\0', 2, n + 1)
				if not seen[k] then
					seen[k] = true
					add(rows, row)
				end
			end
		end
		local function is_requested(param, v)
			local vals = param_vals[param]
			return vals == nil or indexof(v, vals) ~= nil
		end
		while true do
			local change = {changes()} -- {table, pk_val1, ...}
			local tbl = change[1]
			if tbl == nil then break end
			if tbl == link_table then
				local key_vals = {} -- {param -> {val}}
				local is_in_params = true
				for i, lookup in ipairs(lookups) do
					local v = change[i + 1]
					is_in_params = is_in_params and is_requested(lookup.param, v)
					key_vals[lookup.param] = {v}
				end
				if is_in_params then add_rows(key_vals) end
			end
			for _, lookup in ipairs(lookups) do
				local id = change[2]
				if tbl == lookup.table and is_requested(lookup.param, id) then
					if not db:exists(lookup.table, id) then return false end
					local narrowed_vals = update({}, param_vals)
					narrowed_vals[lookup.param] = {id}
					add_rows(narrowed_vals)
				end
			end
		end
		return {rows = rows}
	end

end

function members_rowset(...)
	return virtual_rowset(members_rowset_init, ...)
end

dynamic_rowset('^members_(.+)$', function(tbl)
	local schema = checkfound(db():atomic('any', function(tbl)
		return db():table_schema(tbl)
	end, tbl))
	checkfound(is_link_table(schema))
	local rs = members_rowset(tbl)
	rs.label = table_label(tbl, schema)..' (members)'
	rs.category = schema.category
	return rs
end)
