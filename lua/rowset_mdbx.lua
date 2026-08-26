--[[

	MDBX rowsets.
	Written by Cosmin Apreutesei. Public Domain.

API
	scan_rowset   (opt) -> rs         rowset over a table scan
	table_rowset  (tbl, [opt]) -> rs  rowset over a whole table
	lookup_rowset (tbl) -> name, name_col   auto-created lookup rowset
	prepare_rowsets ()                prepare all of them, to validate at startup

	rowset.lookup_TABLE               same, created on first access

SCAN ROWSET OPTIONS

	scan     fn(db) -> scan    required; must end in select()
	pk       'col1 ...'        required; output names, not table cols
	db       db                optional; defaults to the app db

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

]]

require'rowset'
require'mdbx_scan'
require'glue'

local function rowset_db(rs)
	return rs.db or db()
end

--a lookup rowset has a one-col key, so fks over several cols have none.
local function fks_by_col(schema)
	local fks = {}
	for _, fk in pairs(schema.fks or empty) do
		if #fk.cols == 1 then fks[fk.cols[1]] = fk end
	end
	return fks
end

local function guess_name_col(schema)
	if schema.name_col then return schema.name_col end
	if schema.fields.name then return 'name' end
end

--the client sends a row's key under 'COL:old', a changed value under 'COL'.
local function val_or_old(vals, name)
	local v = vals[name]
	if v == nil then v = vals[name..':old'] end
	return v
end

--respond() prefixes param values with 'param:' and adds an ':old' copy of
--each, both only for the sql rowsets' col maps and update where clauses.
--TODO: drop this once respond() passes param values through unchanged.
local function scan_args(param_vals)
	local args = {}
	for k, v in pairs(param_vals) do
		local name = k:match'^param:([^:]+)$'
		if name then args[name] = v end
	end
	return args
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

function scan_rowset(...)

	return virtual_rowset(function(rs, opt, ...)

		update(rs, opt, ...)

		assert(rs.scan, 'scan missing')
		rs.pk = collect(words(assert(rs.pk, 'pk missing')))
		assert(#rs.pk > 0, 'pk empty')

		rs.manual_init_fields = true

		local scan      --the prepared scan, built on first use
		local row_scan  --loads one row back by pk; nil when it can't be built
		local write_table
		local write_cols = {} --{NAME -> COL} cols we may write
		local key_names = {}  --{NAME,...} outputs holding write_table's pk
		local key_cols  = {}  --{COL,...}  the pk cols themselves
		local seq_name        --output holding write_table's auto-inc col

		local insert_row, update_row, delete_row, load_row --fw. decl.

		--building a scan resolves its table schema, which needs a transaction,
		--so this runs on the first request rather than at load time.
		function rs:prepare()
			if scan then return end
			local db = rowset_db(rs)
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
						if not f.readonly then write_cols[f.name] = f.col end
					end
				end
				for i, col in ipairs(schema.pk) do
					key_names[i] = name_of_col[col]
					key_cols[i] = col
				end
				local seq_field = schema.autoinc_field
				seq_name = seq_field and name_of_col[seq_field.col]
				rs.insert_row = insert_row
				rs.update_row = update_row
				rs.delete_row = delete_row
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

			local params = {}
			for arg in pairs(scan.arg_fields) do
				if isstr(arg) then add(params, arg) end
			end
			rs.params = sort(params)

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

			rs:init_fields(true)
		end

		--load_rows() and load_row() run in the transaction their caller opened.
		--exec_load() opens one; a reload from apply_changes() is already
		--inside the save's write transaction.
		local exec_load = rs.exec_load
		function rs:exec_load(...)
			return rowset_db(rs):atomic('r', exec_load, self, ...)
		end

		--after a run that died mid-iteration the scan still holds a cursor from
		--a dead transaction; close() drops it before the next seek.
		function rs:load_rows(res, param_vals)
			rs:prepare()
			scan.close()
			res.rows = scan:rows_array('[]', scan_args(param_vals))
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
			for name, col in pairs(write_cols) do
				local v = vals[name]
				if v ~= nil then t[col] = v end
			end
			return t
		end

		--[[local]] function insert_row(self, vals)
			rowset_db(rs):atomic('w', function()
				local seq = rowset_db(rs):insert(write_table, '{}',
					written_vals(vals))
				--load_row() looks the row up by pk, so put a minted key in vals.
				if seq and seq_name then vals[seq_name] = seq end
				self:table_changed(write_table)
			end)
		end

		--[[local]] function update_row(self, vals)
			rowset_db(rs):atomic('w', function()
				local t = written_vals(vals)
				for i, name in ipairs(key_names) do
					t[key_cols[i]] = val_or_old(vals, name)
				end
				rowset_db(rs):update(write_table, '{}', t)
				self:table_changed(write_table)
			end)
		end

		--[[local]] function delete_row(self, vals)
			rowset_db(rs):atomic('w', function()
				local keys = {}
				for i, name in ipairs(key_names) do
					keys[i] = val_or_old(vals, name)
				end
				rowset_db(rs):del(write_table, unpack(keys, 1, #key_names))
				self:table_changed(write_table)
			end)
		end

		--every row change runs in a child transaction of this one, so a failed
		--row rolls back on its own and the rest of the batch still applies.
		local apply_changes = rs.apply_changes
		function rs:apply_changes(...)
			rs:prepare()
			return rowset_db(rs):atomic('w', apply_changes, self, ...)
		end

	end, ...)
end

--LOOKUP ROWSETS -------------------------------------------------------------

function lookup_rowset(tbl)
	local rs_name = 'lookup_'..tbl
	local rs = rawget(rowset, rs_name)
	if not rs then
		local schema = checkfound(db():table_schema(tbl))
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
	db():atomic('r', function()
		local prepared = {}
		local found_new = true
		while found_new do
			found_new = false
			for name, rs in sortedpairs(rowset) do
				if not prepared[name] then
					prepared[name] = true
					found_new = true
					rs.name = name
					rs:prepare()
				end
			end
		end
	end)
end

--TABLE ROWSETS --------------------------------------------------------------

function table_rowset(tbl, opt)
	local schema = checkfound(db():table_schema(tbl))
	local sel = cat(schema.cols, ', ')
	return scan_rowset(update({
		scan = function(db) return db:scan(tbl, ''):select(sel) end,
		pk = cat(schema.pk, ' '),
	}, opt))
end
