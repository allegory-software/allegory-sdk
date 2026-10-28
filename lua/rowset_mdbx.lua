--[[

	MDBX rowsets.
	Written by Cosmin Apreutesei. Public Domain.

API
	scan_rowset   (opt) -> rs         rowset over a table scan
	table_rowset  (tbl, [opt]) -> rs  rowset over a whole table
	lookup_rowset (tbl) -> name, name_col   auto-created lookup rowset
	prepare_rowsets ()                prepare all of them, to validate at startup
	watch_row_changes (db)            push changed rowsets to events clients

	rowset.lookup_TABLE               same, created on first access

SCAN ROWSET OPTIONS

	scan     fn(db) -> scan    required; must end in select()
	pk       'col1 ...'        required; output names, not table cols
	db       db                optional; defaults to the app db
	on_rows_changed            optional; see LOADING CHANGED ROWS

	plus every rowset.lua property (cols, hide_cols, ro_cols, rw_cols,
	field_attrs, name_col, ...).

	Fields come from the scan's output cols. An output col that comes from a
	table col gets its type, label, enum values, bounds and defaults from the
	paper schema. One that doesn't -- an expression, an aggregate -- is
	read-only and untyped.

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

local table_rowset_names = {} -- {db -> {table -> {rowset_name -> true}}}

--a lookup rowset has a one-col key, so fks over several cols have none.
local function fks_by_col(schema)
	local fks = {}
	for _, fk in pairs(schema.fks or empty) do
		if #fk.cols == 1 then fks[fk.cols[1]] = fk end
	end
	return fks
end

local function guess_name_col(schema)
	if schema.name_col ~= nil then return schema.name_col or nil end
	if schema.fields.name then return 'name' end
end

--the client sends a row's key under 'COL:old', a changed value under 'COL'.
local function val_or_old(vals, name)
	local v = vals[name]
	if v == nil then v = vals[name..':old'] end
	return v
end

--the one table whose rows match the rowset's rows one-to-one: every pk output
--col comes from it, and together they are exactly its pk.
local function find_write_table(db, out_specs, pk)
	local tbl, cols = nil, {}
	for _, name in ipairs(pk) do
		local spec = assertf(out_specs[name], 'pk col not in output: %s', name)
		if not spec.table or (tbl and spec.table ~= tbl) then return end
		tbl = spec.table
		cols[spec.col] = true
	end
	local table_pk = db:table_schema(tbl).pk
	if #table_pk ~= #pk then return end
	for _, col in ipairs(table_pk) do
		if not cols[col] then return end
	end
	return tbl
end

local function scan_rowset_init(rs, opt, ...)

	update(rs, opt, ...)

	assert(rs.scan, 'scan missing')
	rs.pk = collect(words(assert(rs.pk, 'pk missing')))
	assert(#rs.pk > 0, 'pk empty')

	rs.manual_init_fields = true

	local scan     --the prepared scan, built on first use
	local row_scan --loads one row back by pk; nil when it can't be built
	local is_prepared     --prepare() ran to the end
	local write_table
	local key_names = {}  --{NAME,...} outputs holding write_table's pk
	local key_cols  = {}  --{COL,...}  the pk cols themselves
	local seq_name        --output holding write_table's auto-inc col
	local is_seq_pk       --the auto-inc col is the whole pk: ids reservable

	local insert_row, update_row, delete_row, load_row --fw. decl.
	local reserve_ids --fw. decl.

	local function rs_db()
		return rs.db or db()
	end

	--building a scan resolves its table schema, which needs a transaction,
	--so this runs on the first request rather than at load time.
	local function prepare()
		local db = rs_db()
		scan = rs.scan(db)
		scan:null_value(null)

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
		end

		--so the client shows and picks a name instead of a raw fk value.
		for _, f in ipairs(fields) do
			if f.table then
				local fk = fks_by_col(db:table_schema(f.table))[f.col]
				if fk then
					f.lookup_rowset_name, f.display_col =
						lookup_rowset(fk.ref_table)
					f.lookup_cols = fk.ref_cols[1]
				end
			end
		end

		rs.params = rs.params or {} -- {param name -> def}
		for arg, field in pairs(scan.arg_fields) do
			if isstr(arg) then
				rs.params[arg] = update({accept_many = false}, field)
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

		rs:init_load_changed_rows()

		rs:init_fields(false)

		for tbl in pairs(scan.source_tables) do
			attr(attr(table_rowset_names, db), tbl)[rs.name] = true
		end

		is_prepared = true
	end
	function rs:prepare()
		if is_prepared then return end
		rs_db():atomic('r', prepare)
	end

	--TODO: after a run that died mid-iteration the scan still holds a cursor from
	--a dead transaction; close() drops it before the next seek but it's a HACK.
	local function load_rows(res, param_vals)
		res.rows = scan:rows_array('[]', param_vals)
		res.txn_id = rs_db():txn_id()
	end
	function rs:load_rows(res, param_vals)
		scan.close()
		rs_db():atomic('r', load_rows, res, param_vals)
	end

	--[[local]] function load_row(self, vals)
		local args = {}
		for _, name in ipairs(key_names) do
			args[name] = val_or_old(vals, name)
		end
		row_scan.close()
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

	--row change notifications ---------------------------------------------

	local pk_decoders -- {table -> fn(raw_pk) -> pk_val1, ...}
	local load_scan_changed_rows -- fn(...) -> {rows, removed_pks}

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
				next_row = db:each_row_change(batch, scan.source_tables)
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

	function rs:init_load_changed_rows()
		local db = rs_db()
		if rs.on_rows_changed then
			pk_decoders = {}
			for tbl in pairs(scan.source_tables) do
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
		else
			load_scan_changed_rows = scan:make_load_changed_rows(rs.pk)
		end
		if rs.on_rows_changed or load_scan_changed_rows then
			function rs:load_changed_rows(...)
				return rs_db():atomic('r', load_changed_rows, self, ...)
			end
		end
	end

end

function scan_rowset(...)
	return virtual_rowset(scan_rowset_init, ...)
end

--ROW CHANGE PUSH ------------------------------------------------------------

--the db owns the thread, so db:close() cancels the thread's wait.
function watch_row_changes(db)
	local tables = attr(table_rowset_names, db) -- {table -> rowset_names}
	local th = thread(function()
		local f = inotify() -- woken by each commit, from any process
		f:add_watch(db.file..'.changes', IN_MODIFY)
		local since_txn_id = db:atomic('r', db.txn_id, db) -- last read txn
		while true do
			f:read_event()
			local rowset_names = {} -- {rowset_name -> true}
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
				since_txn_id = db:txn_id()
			end)
			if next(rowset_names) then
				push_rowset_changed_events(rowset_names, since_txn_id)
			end
		end
	end, 'rowset-changes %s', db.file)
	th:setowner(db)
	resume(th)
end

--LOOKUP ROWSETS -------------------------------------------------------------

local function table_schema(tbl)
	return checkfound(db():atomic('any', function(tbl)
		return db():table_schema(tbl)
	end, tbl))
end

function lookup_rowset(tbl)
	local rs_name = 'lookup_'..tbl
	local rs = rawget(rowset, rs_name)
	if not rs then
		local schema = checkfound(table_schema(tbl))
		local name_col = guess_name_col(schema)
		local cols = extend({}, schema.pk)
		if name_col then add(cols, name_col) end
		local sel = cat(cols, ', ')
		rs = scan_rowset{
			scan = function(db) return db:scan(tbl, ''):select(sel) end,
			pk = cat(schema.pk, ' '),
			name_col = name_col,
		}
		rawset(rowset, rs_name, rs)
	end
	return rs_name, rs.name_col
end

setmetatable(rowset, {__index = function(self, rs_name)
	local tbl = rs_name:match'^lookup_(.+)$'
	if tbl then
		lookup_rowset(tbl)
		return rawget(rowset, rs_name)
	end
end})

--STARTUP VALIDATION ---------------------------------------------------------

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
					rs.name = name
					if rs.prepare then
						rs:prepare()
					end
				end
			end
		end
	end
end

--TABLE ROWSETS --------------------------------------------------------------

function table_rowset(tbl, opt)
	local schema = table_schema(tbl)
	local sel = cat(schema.cols, ', ')
	return scan_rowset(update({
		scan = function(db) return db:scan(tbl, ''):select(sel) end,
		pk = cat(schema.pk, ' '),
	}, opt))
end
