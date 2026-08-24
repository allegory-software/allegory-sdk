--[=[

	RDBMS schema definition language & operations
	Written by Cosmin Apreutesei. Public Domain.

This module implements a Lua-based Data Definition Language (DDL) for RDBMS
schemas. Lua-based means that instead of a textual format like SQL DDL,
we use Lua syntax to write table definitions in, and generate an Abstract
Syntax Tree (AST) from that. Using setfenv and metamethod magic we create
a language that is very readable and at the same time more expressive than
any textual format could be, giving us full programming power in an otherwise
declarative language. Basically a metaprogrammed DDL.

So why would you want to keep your database schema definition in the
application anyway, and not in SQL files containing DDL statements?

Here's some reasons:

* you want to generate SQL DDL scripts for different SQL dialects
from a common structured format.
* you want to diff between a live database and your "on paper" schema
to make sure that the database was migrated properly.
* you want to generate schema migrations (semi-)automatically without having
to create and maintain schema versions and migration scripts.
* you don't want to care about declaration order for foreign key constraints.
* you want to annotate table fields with extra information for use in
data-bound widget toolkits, and you don't want to do that off-band
in a separate file.
* your app has modules or extensions and you want each module to define its
own part of the app schema, including adding columns to common tables
or even adding foreign keys that reference tables from other modules.
* you want to use a boolean type in MySQL.
* you want a "shell" API for bulk DML ops like copying tables between
databases with different engines.
* use it as a base for a scriptable ETL tool.

## Usage

See `schema_mdbx.lua` for type definitions and `lang_schema()` in lang.lua
and `auth_schema()` in `webb_auth_mdbx.lua` for examples of table definitions.

### How this works / caveats

#### TL;DR

Field names in `my_schema` that clash with flag names need to be quoted.
Field names, type names and flag names that clash with globals from `sc.env`
or locals from the outer scope also need to be quoted.

#### Long version

Using Lua for syntax instead of our own means that Lua's lexical rules apply,
including lexical scoping which cannot be turned off, so there are some
quirks to this that you have to know.

When calling `sc:def(my_schema)`, the function `my_schema` is run in an
environment (available at `sc.env`) that resolves every unknown keyword
to itself, so `foo_id` simply turns into `'foo_id'`. This is so that you
don't have to quote the names of fields, types or flags, unless you have to.

Because of this, you need to define `my_schema` in a clean lexical scope,
ideally at the top of your script before you declare any locals, otherwise
those locals will be captured by `my_schema` and your names will resolve to
the locals instead of to themselves. Globals declared in `sc.env` are also
captured so they can also clash with any unquoted names. Flag names can
also clash but only with unquoted field names.

If you don't want to put the schema definition at the top of the script
for some reason, one simple way to fix an unwanted capture of an outer local
is with an override: `local unsigned = 'unsigned'`.

Also because of this, you cannot use globals inside `my_schema` directly,
you'll have to _bring them into scope_ via locals, or access them through
`_G`, which _is_ available. A DDL is mostly static however so you'd rarely
need to do this.

Q: Flags and types look like they do the same thing, why the distinction?

A: Because column definitions have the form `name, type, flag1, ...`
instead of `name, flag1|type1, ...` which would have allowed a field to
inherit from multiple types but would've also made type names clash with
field names. With the first variant only flag names clash with field names
which is more acceptable.

API
	schema.new(opt) -> sc`          create a new schema object
	schema.diff(sc1, sc2) -> diff`  find out what changed between `sc1` and `sc2`
	diff:pp()`                      pretty print a schema diff

INTEGRATION WITH DB ENGINES

API
	schema.cols_change_affects(old_tbl, new_tbl, cols, attrs) -> changed, col
	schema.pk_change_affects(old_tbl, new_tbl, attrs) -> changed, col
schema.new() options:
	engine                     engine name used for engine-specific attributes.
	diff_table_attrs           {attr->true}: attributes included in table diffs.
	diff_field_attrs           {attr->true}: attributes included in field diffs.
	supports_fks               include foreign keys in schema diffs.
	supports_checks            include checks in schema diffs.
	supports_triggers          include triggers in schema diffs.
	supports_procs             include procedures in schema diffs.
	index_field_attrs          {attr->true}: field changes that require indexes
	                           containing the field to be dropped and recreated.
	fk_field_attrs             {attr->true}: field changes that require foreign
	                           keys using the field at either endpoint to be
	                           dropped and recreated.
	indexes_store_pk           indexes store or otherwise depend on the encoded
	                           base-table PK, so PK changes rebuild all indexes.
	fk_indexes_store_pk        FK enforcement indexes store or otherwise depend
	                           on the encoded child-table PK, so child PK changes
	                           rebuild all foreign keys on the table.

]=]

--if not ... then require'schema_test'; return end
if not ... then require'schema_diff_test'; return end

require'glue'

--definition parsing ---------------------------------------------------------

--NOTE: flag names clash with unquoted field names!
--NOTE: env names clash with all unquoted names!

local function isschema(t) return istab(t) and t.is_schema end

schema = {is_schema = true, package = {}, isschema = isschema}

--NOTE: the double-underscore is for disambiguation, not for aesthetics.
schema.fk_name_format = 'fk_%s__%s'
schema.ck_name_format = 'ck_%s__%s'
schema.ix_name_format = '%s_%s__%s'

local function resolve_type(self, fld, t, i, n, fld_ct, allow_types, allow_flags, allow_unknown)
	for i = i, n do
		local k = t[i]
		local v = k
		if isstr(v) then --type name, flag name or next field
			v = allow_types and self.types[k] or allow_flags and self.flags[k] or nil
			if not v and allow_unknown then --next field
				return i
			end
		end
		assertf(v ~= nil, 'unknown flag or type name `%s`', k)
		v = call(v, self, fld_ct, fld)
		if v then
			resolve_type(self, fld, v, 1, #v, fld_ct, true, true) --recurse
			for k,v in pairs(v) do --copy named attrs
				if isstr(k) then
					fld[k] = v
				end
			end
		end
	end
	return n + 1
end

local function update_type(self, fld)
	update(fld, rawget(self.type_attrs, fld.type))
end

local function parse_cols(self, t, dt, loc1, fld_ct)
	local dt_i = #dt + 1
	if t.after_col then
		dt_i = dt[t.after_col].col_pos + 1
	end
	local i = 1
	while i <= #t do --[out], field_name, type_name, flag_name|{attr->val}, ...
		if i == 1 and not isstr(t[1]) then --aka for renaming the table.
			t[1](self, fld_ct)
			i = i + 1
		end
		local col, mode
		if not fld_ct.is_table then --this is a proc param, not a table field.
			mode = t[i]
			if mode == 'out' then
				i = i + 1
			else
				mode = nil --'in' (default)
			end
		end
		col = t[i]
		assertf(isstr(col), 'column name expected for `%s`, got %s', loc1, type(col))
		assertf(not dt[col], 'duplicate field name: %s.%s', loc1, col)
		i = i + 1
		local fld = {col = col, mode = mode}
		insert(dt, dt_i, fld); dt_i = dt_i + 1
		dt[col] = fld
		i = resolve_type(self, fld, t, i, i , fld_ct, true , false , false)
		i = resolve_type(self, fld, t, i, #t, fld_ct, false, true  , true )
		update_type(self, fld)
	end
	if fld_ct.is_table then
		for i, fld in ipairs(dt) do
			fld.col_pos = i
			fld.col_in_front = i > 1 and dt[i-1].col
		end
	end
end

local function resolve_fk(fk, tbl, ref_tbl)
	assertf(ref_tbl.pk, 'ref table `%s` has no PK', ref_tbl.name)
	fk.ref_cols = extend({}, ref_tbl.pk)
	--add convenience ref fields for automatic lookup in widgets.
	if #fk.cols == 1 then
		local fld = tbl.fields[fk.cols[1]]
		fld.ref_table = ref_tbl.name
		fld.ref_col   = ref_tbl.pk[1]
	end
end

local function parse_table(self, name, t)
	local tbl = {is_table = true, name = name, fields = {}}
	parse_cols(self, t, tbl.fields, name, tbl)
	--resolve fks that ref this table.
	local fks = self.table_refs and self.table_refs[name]
	if fks then
		for fk in pairs(fks) do
			local fk_tbl =
				fk.table == name and tbl --self-reference
				or self.tables[fk.table]
			resolve_fk(fk, fk_tbl, tbl)
		end
		self.table_refs[name] = nil
	end
	--add API to table to add more cols after-definition.
	function tbl.add_cols(t)
		parse_cols(self, t, tbl.fields, name, tbl)
	end
	return tbl
end

local function parse_ix_cols(fld, ...) --'col1 [desc], ...'
	if not ... then
		return {fld.col}
	end
	local s = cat({...}, ',')
	local dt = {desc = {}}
	for s in s:gmatch'[^,]+' do
		s = trim(s)
		local name, desc = s:match'(.-)%s+desc$'
		if name then
			desc = true
		else
			name, desc = s, false
		end
		add(dt, name)
		add(dt.desc, desc and true or false)
	end
	return dt
end

local function check_cols(T, tbl, cols)
	for i,col in ipairs(cols) do
		local found = false
		for i,fld in ipairs(tbl.fields) do
			if fld.col == col then found = true; break end
		end
		assertf(found, 'unknown `%s` column: `%s.%s`', T, tbl.name, col)
	end
	return cols
end

local function return_false() return false end

local function add_pk(self, tbl, cols)
	assertf(not tbl.pk, 'pk already applied for table `%s`', tbl.name)
	tbl.pk = check_cols('pk', tbl, cols)
	tbl.pk.desc = imap(cols, return_false)
	--apply `not_null` flag to fields.
	for _,col in ipairs(tbl.pk) do
		local fld = tbl.fields[col]
		fld.not_null = true
	end
end

function schema:format_ix_name(tbl_name, cols, unique)
	return _(self.ix_name_format, unique and 'uk' or 'ix', tbl_name, cat(cols, '_'))
end

function schema:format_fk_name(tbl_name, cols)
	return _(self.fk_name_format, tbl_name, cat(cols, '_'))
end

local function add_ix(self, tbl, cols, unique)
	local t = attr(tbl, 'ixs')
	local k = self:format_ix_name(tbl.name, cols, unique)
	assertf(not t[k], 'duplicate index `%s`', k)
	check_cols('index', tbl, cols)
	t[k] = cols
	if unique then
		cols.is_unique = true
	end
end

local function add_fk(self, tbl, cols, ref_tbl_name, ondelete, onupdate, fld)
	local fks = attr(tbl, 'fks')
	local k = self:format_fk_name(
		tbl.name, cols, ref_tbl_name, ondelete, onupdate)
	assertf(not fks[k], 'duplicate fk `%s`', k)
	ref_tbl_name = ref_tbl_name or assert(#cols == 1 and cols[1])
	local cols = check_cols('fk', tbl, cols)
	cols.desc = imap(cols, return_false)
	local fk = {name = k, table = tbl.name, cols = cols,
		ref_table = ref_tbl_name, ondelete = ondelete, onupdate = onupdate or 'cascade'}
	fks[k] = fk
	local ref_tbl =
		ref_tbl_name == tbl.name and tbl --self-reference
		or self.tables[ref_tbl_name]
	if ref_tbl then
		resolve_fk(fk, tbl, ref_tbl)
	else --we'll resolve it when the table is defined later.
		attr(attr(self, 'table_refs'), ref_tbl_name)[fk] = true
	end
end

--functions created inside the schema DSL inherit the DSL env which is not
--what we want the function's env to be, so we restore it.
local function restore_env(self, fn)
	if getfenv(fn) == self.env then setfenv(fn, _G) end
	return fn
end

do
	local function add_global(t, k, v)
		assertf(not t.flags [k], 'global overshadows flag `%s`', k)
		assertf(not t.types [k], 'global overshadows type `%s`', k)
		assertf(not t.tables[k], 'global overshadows table `%s`', k)
		assertf(not t.procs [k], 'global overshadows proc `%s`', k)
		rawset(t, k, v)
	end
	local T = function() end
	local function getter(t, k) return t[T][k] end
	local function init(self, env, k, parse)
		local k1 = k:gsub('s$', '')
		local t = update({}, schema[k])
		self[k] = t
		env[k] = setmetatable({}, {
			__index = t,
			__newindex = function(_, k, v)
				assertf(not t[k], 'duplicate %s `%s`', k1, k)
				t[k] = parse(self, k, v)
			end,
		})
	end
	function schema.new(opt)
		assert(opt ~= schema, 'use dot notation')
		local self = object(schema, opt)
		local env = update({self = self}, schema.env)
		self.flags = update({}, schema.flags)
		self.types = update({}, schema.types)
		self.procs = {}
		self.type_attrs = update({}, schema.type_attrs)
		setmetatable(self.type_attrs, {__index = function(ta, k)
			local t = {}; rawset(ta, k, t); return t
		end})
		env.flags = self.flags
		env.types = self.types
		env.type_attrs = self.type_attrs
		init(self, env, 'tables', parse_table)
		local function resolve_symbol(t, k)
			return k --symbols resolve to their name as string.
		end
		setmetatable(env, {__index = resolve_symbol, __newindex = add_global})
		self.env = env
		self.loaded = {}

		function env.import       (...) self:import       (...) end
		function env.add_fk       (...) self:add_fk       (...) end
		function env.add_child_fk (...) self:add_child_fk (...) end
		function env.add_weak_fk  (...) self:add_weak_fk  (...) end
		function env.trigger      (...) self:add_trigger  (...) end
		function env.proc         (...) self:add_proc     (...) end
		function env.add_cols     (...) self:add_cols     (...) end

		for _, event in ipairs{
			'before_insert', 'after_insert',
			'before_update', 'after_update',
			'before_delete', 'after_delete',
		} do
			env[event] = function(arg1, arg2)
				if isstr(arg1) then --standalone: before_insert('usr', fn)
					local tbl = assertf(self.tables[arg1],
						'unknown table for trigger: %s', arg1)
					local fn = assertf(isfunc(arg2) and arg2,
						'function expected for %s.%s', arg1, event)
					add(attr(attr(tbl, 'triggers'), event),
						restore_env(self, fn))
				else --inline: before_insert(fn) -- returns a table-level flag
					local fn = assertf(isfunc(arg1) and arg1,
						'function expected for trigger %s', event)
					return function(sc, tbl)
						add(attr(attr(tbl, 'triggers'), event),
							restore_env(sc, fn))
					end
				end
			end
		end

		return self
	end
end

local function import(self, k, sc)
	local k1 = k:gsub('s$', '')
	local dst = self[k]
	for name,v in pairs(sc[k]) do
		assertf(dst[name] == nil, 'duplicate %s `%s`', k1, name)
		dst[name] = v
	end
end
function schema:import(src)
	if isstr(src) then --module
		src = schema.package[src] or require(src)
	end
	if isfunc(src) then --def
		if not self.loaded[src] then
			setfenv(src, self.env)
			src()
			self.loaded[src] = true
		end
	elseif isschema(src) then --schema
		if not self.loaded[src] then
			import(self, 'types' , src)
			import(self, 'tables', src)
			import(self, 'procs' , src)
			update(self.type_attrs, src.type_attrs)
			self.loaded[src] = true
		end
	elseif istab(src) then --plain table: use as environment.
		update(self.env, src)
	else
		assert(false)
	end
	return self
end

schema.env = {_G = _G}

local function fk_func(force_ondelete, force_onupdate)
	return function(arg1, ...)
		if isschema(arg1) then --used as flag: make a fk on current field.
			local self, tbl, fld = arg1, ...
			add_fk(self, tbl, {fld.col}, nil,
				force_ondelete,
				force_onupdate,
				fld)
		else --called by user, return a flag generator.
			local ref_tbl, ondelete, onupdate = arg1, ...
			return function(self, tbl, fld)
				add_fk(self, tbl, {fld.col}, ref_tbl,
					force_ondelete or ondelete,
					force_onupdate or onupdate,
					fld)
			end
		end
	end
end
schema.env.fk       = fk_func()
schema.env.child_fk = fk_func'cascade'
schema.env.weak_fk  = fk_func'set null'

function schema:add_fk(tbl, cols, ...)
	local tbl = assertf(self.tables[tbl], 'unknown table `%s`', tbl)
	add_fk(self, tbl, collect(words(cols)), ...)
end

function schema:add_child_fk(tbl, cols, ref_tbl)
	self:add_fk(tbl, cols, ref_tbl, 'cascade')
end

function schema:add_weak_fk(tbl, cols, ref_tbl)
	self:add_fk(tbl, cols, ref_tbl, 'set null')
end

local function ix_func(unique)
	return function(arg1, ...)
		if isschema(arg1) then --used as flag: make an index on current field.
			local self, tbl, fld = arg1, ...
			add_ix(self, tbl, {fld.col, desc = {false}}, unique)
			fld.ix = true
		else --called by user, return a flag generator.
			local cols = pack(arg1, ...)
			return function(self, tbl, fld)
				local cols = parse_ix_cols(fld, unpack(cols))
				add_ix(self, tbl, cols, unique)
			end
		end
	end
end
schema.env.uk = ix_func(true)
schema.env.ix = ix_func()

schema.flags = {} --not used
schema.types = {} --not used
schema.type_attrs = {} --not used

function schema.env.pk(arg1, ...)
	if isschema(arg1) then --used as flag.
		local self, tbl = arg1, ...
		add_pk(self, tbl, imap(tbl.fields, 'col'))
	else --called by user, return a flag generator.
		local cols = pack(arg1, ...)
		return function(self, tbl, fld)
			local cols = parse_ix_cols(fld, unpack(cols))
			add_pk(self, tbl, cols)
		end
	end
end

function schema.env.check(body)
	return function(self, tbl, fld)
		local name = _(self.ck_name_format, tbl.name, fld.col)
		local ck = {}
		if istab(body) then
			update(ck, body) --mysql'...'
		else
			ck.body = body
		end
		attr(tbl, 'checks')[name] = ck
	end
end

function schema.env.aka(old_names)
	return function(self, tbl, fld)
		local entity = fld or tbl --table rename or field rename.
		for old_name in words(old_names) do
			attr(entity, 'aka')[old_name] = true
		end
	end
end

function schema.env.as(gen_fn_version, fn)
	if isfunc(gen_fn_version) then gen_fn_version, fn = nil, gen_fn_version end
	assertf(isfunc(fn), 'function expected for as()')
	return function(self, tbl, fld)
		fld.gen_fn = restore_env(self, fn)
		fld.gen_fn_version = gen_fn_version
	end
end

local function trigger_pos(tgs, when, op)
	local i = 1
	for _,tg in pairs(tgs) do
		if tg.when == when and tg.op == op then
			i = i + 1
		end
	end
	return i
end
function schema:add_trigger(name, when, op, tbl_name, ...)
	name = _('%s_%s_%s%s', tbl_name, name, when:sub(1,1), op:sub(1,1))
	local tbl = assertf(self.tables[tbl_name], 'unknown table `%s`', tbl_name)
	local triggers = attr(tbl, 'triggers')
	assertf(not triggers[name], 'duplicate trigger `%s`', name)
	triggers[name] = update({name = name, when = when, op = op,
		table = tbl_name, pos = trigger_pos(triggers, when, op)}, ...)
end

function schema:add_proc(name, args, ...)
	local p = {name = name, args = {}}
	parse_cols(self, args, p.args, name, p)
	update(p, ...)
	self.procs[name] = p
end

function schema:add_cols(tbl_name, t)
	local nt = collect(words(tbl_name))
	local tbl_name = nt[1]
	if nt[2] then
		assert(nt[2] == 'after')
		t.after_col = assert(nt[3])
	else
		assert(#nt == 1)
	end
	self.tables[tbl_name].add_cols(t)
end

function schema:add_table(tbl_name, t)
	assertf(not self.tables[tbl_name], 'table already exists: `%s`', tbl_name)
	local tbl = parse_table(self, tbl_name, t)
	self.tables[tbl_name] = tbl
	return tbl
end

function schema:check_refs()
	if not self.table_refs or isempty(self.table_refs) then return end
	assertf(false, 'unresolved refs to tables: %s', cat(keys(self.table_refs, true), ', '))
end

--schema diff'ing ------------------------------------------------------------

local function map_fields(flds)
	local t = {}
	for i,fld in ipairs(flds) do
		t[fld.col] = fld
	end
	return t
end

local function table_field(tbl, col)
	local f = tbl.fields[col]
	if f then return f end
	for _, f in ipairs(tbl.fields) do
		if f.col == col then return f end
	end
end

local function field_change_affects(old_tbl, new_tbl, col, attrs)
	local old_f = table_field(old_tbl, col)
	local new_f = table_field(new_tbl, col)
	if not old_f or not new_f then return true end
	for attr in pairs(attrs) do
		if old_f[attr] ~= new_f[attr] then return true end
	end
	return false
end

function schema.cols_change_affects(old_tbl, new_tbl, cols, attrs)
	for _, col in ipairs(cols or empty) do
		if field_change_affects(old_tbl, new_tbl, col, attrs) then
			return true, col
		end
	end
	return false
end

function schema.pk_change_affects(old_tbl, new_tbl, attrs)
	if #old_tbl.pk ~= #new_tbl.pk then return true end
	for i, old_col in ipairs(old_tbl.pk) do
		if old_col ~= new_tbl.pk[i]
			or (old_tbl.pk.desc and old_tbl.pk.desc[i] or false)
				~= (new_tbl.pk.desc and new_tbl.pk.desc[i] or false)
		then
			return true, old_col
		end
	end
	return schema.cols_change_affects(old_tbl, new_tbl, old_tbl.pk, attrs)
end

local function diff_maps(self, t1, t0, diff_vals, map, sc0, supported) --sync t0 to t1.
	if not supported then return nil end
	t1 = t1 and (map and map(t1) or t1) or empty
	t0 = t0 and (map and map(t0) or t0) or empty

	--map out current renames.
	local new_name --{old_name->new_name}
	local old_name --{new_name->old_name}
	for k1, v1 in pairs(t1) do
		if istab(v1) and v1.aka then
			for k0 in pairs(v1.aka) do
				if t0[k0] ~= nil then
					if not old_name then
						old_name = {}
						new_name = {}
					end
					assertf(not old_name[k1], 'double rename for `%s`', k1)
					new_name[k0] = k1
					old_name[k1] = k0
				end
			end
		end
	end

	local dt = {}

	--remove names not present in new schema and not renamed.
	for k0,v0 in pairs(t0) do
		local v1 = new_name and t1[new_name[k0]] --must rename, not remove.
		if v1 == nil and t1[k0] ~= nil then --old name in new schema, keep it?
			if not (old_name and old_name[k0]) then --not a rename of other field, keep it.
				v1 = t1[k0]
			end
		end
		if v1 == nil then
			attr(dt, 'remove')[k0] = v0
		end
	end

	--add names not present in old schema and not renamed, or update.
	for k1,v1 in pairs(t1) do
		local v0 = t0[k1]
		if v0 == nil and old_name then --not present in old schema, check if renamed.
			v0 = t0[old_name[k1]]
		end
		if v0 == nil then
			attr(dt, 'add')[k1] = v1
		elseif diff_vals then
			local k0 = old_name and old_name[k1] or k1
			local vdt = diff_vals(self, v1, v0, sc0)
			if vdt == true then
				attr(dt, 'remove')[k0] = v0
				attr(dt, 'add'   )[k1] = v1
			elseif vdt then
				attr(dt, 'update')[k0] = vdt
			end
		end
	end

	return next(dt) and dt or nil
end

local function diff_arrays(a1, a0)
	a1 = a1 or empty
	a0 = a0 or empty
	if #a1 ~= #a0 then return true end
	for i,s in ipairs(a1) do
		if a0[i] ~= s then return true end
	end
	return false
end
local function diff_ixs(self, c1, c0)
	return diff_arrays(c1, c0)
		or diff_arrays(c1.desc, c0.desc)
		or (c1.is_unique or false) ~= (c0.is_unique or false)
end

local function not_eq(_, a, b) return a ~= b end
local function diff_keys(self, t1, t0, keys)
	local dt = {}
	for k, diff in pairs(keys) do
		if not isfunc(diff) then diff = not_eq end
		if diff(self, t1[k], t0[k]) then
			dt[k] = true
		end
	end
	return next(dt) and {old = t0, new = t1, changed = dt}
end

local function diff_fields(self, f1, f0, sc0)
	return diff_keys(self, f1, f0, assert(sc0.diff_field_attrs))
end

local function diff_fks(self, fk1, fk0)
	return diff_keys(self, fk1, fk0, {
		table=1,
		ref_table=1,
		onupdate=1,
		ondelete=1,
		cols=function(self, c1, c0) return diff_ixs(self, c1, c0) end,
		ref_cols=function(self, c1, c0) return diff_ixs(self, c1, c0) end,
	}) and true
end

local function diff_checks(self, c1, c0)
	local BODY = self.engine..'_body'
	local b1 = c1[BODY] or c1.body
	local b0 = c0[BODY] or c0.body
	return b1 ~= b0
end

local function diff_triggers(self, t1, t0)
	local BODY = self.engine..'_body'
	return diff_keys(self, t1, t0, {
		pos=1,
		when=1,
		op=1,
		[BODY]=1,
	}) and true
end

local function diff_procs(self, p1, p0, sc0)
	local BODY = self.engine..'_body'
	return diff_keys(self, p1, p0, {
		[BODY]=1,
		args=function(self, a1, a0)
			return diff_maps(self, a1, a0, diff_fields, map_fields, sc0, true) and true
		end,
	}) and true
end

local function diff_tables(self, t1, t0, sc0)
	if (t1.raw or nil) ~= (t0.raw or nil) then --can't convert
		return true
	end
	local d = {}
	local table_attrs = sc0.diff_table_attrs
	local td = table_attrs and diff_keys(self, t1, t0, table_attrs)
	d.changed  = td and td.changed
	d.fields   = diff_maps(self, t1.fields  , t0.fields  , diff_fields   , map_fields, sc0, true)
	local pk   = diff_maps(self, {pk=t1.pk} , {pk=t0.pk} , diff_ixs      , nil, sc0, true)
	d.ixs      = diff_maps(self, t1.ixs     , t0.ixs     , diff_ixs      , nil, sc0, true)
	d.fks      = diff_maps(self, t1.fks     , t0.fks     , diff_fks      , nil, sc0, sc0.supports_fks     )
	d.checks   = diff_maps(self, t1.checks  , t0.checks  , diff_checks   , nil, sc0, sc0.supports_checks  )
	d.triggers = diff_maps(self, t1.triggers, t0.triggers, diff_triggers , nil, sc0, sc0.supports_triggers)
	d.add_pk    = pk and pk.add    and pk.add.pk
	d.remove_pk = pk and pk.remove and pk.remove.pk
	if isempty(d) and t1.name == t0.name then return nil end
	d.old = t0
	d.new = t1
	return d
end

local function table_update(self, name, old, new)
	local updates = self.tables and self.tables.update
	local d = updates and updates[name]
	if d then return d end
	self.tables = self.tables or {}
	self.tables.update = self.tables.update or {}
	d = {old = old, new = new}
	self.tables.update[name] = d
	return d
end

local function replace_dependency(d, kind, name, old, new)
	local deps = attr(d, kind)
	attr(deps, 'remove')[name] = old
	attr(deps, 'add')[name] = new
end

local function expand_index_dependencies(self, sc0, sc1)
	local attrs = sc0.index_field_attrs
	if not attrs then return end
	local updates = self.tables and self.tables.update or empty

	for tbl_name, old_tbl in pairs(sc0.tables) do
		local new_tbl = sc1.tables[tbl_name]
		local d = new_tbl and updates[tbl_name]
		if d then
			local pk_changed =
				sc0.indexes_store_pk
				and schema.pk_change_affects(old_tbl, new_tbl, attrs)
			for ix_name, old_ix in pairs(old_tbl.ixs or empty) do
				local new_ix = new_tbl.ixs and new_tbl.ixs[ix_name]
				if new_ix and (
					pk_changed
					or schema.cols_change_affects(
						old_tbl, new_tbl, old_ix, attrs)
				) then
					replace_dependency(d, 'ixs', ix_name, old_ix, new_ix)
				end
			end
		end
	end
end

local function expand_fk_dependencies(self, sc0, sc1)
	local attrs = sc0.fk_field_attrs
	if not sc0.supports_fks or not attrs then return end
	local updates = self.tables and self.tables.update or empty

	for child_name, old_child in pairs(sc0.tables) do
		local new_child = sc1.tables[child_name]
		if new_child then
			for fk_name, old_fk in pairs(old_child.fks or empty) do
				local new_fk = new_child.fks and new_child.fks[fk_name]
				if new_fk then
					local child_d = updates[child_name]
					local parent_d = updates[old_fk.ref_table]
					local affected = child_d and (
						schema.cols_change_affects(
							old_child, new_child, old_fk.cols, attrs)
						or sc0.fk_indexes_store_pk
							and schema.pk_change_affects(
								old_child, new_child, attrs)
					)
					if not affected and parent_d then
						affected =
							schema.cols_change_affects(
								parent_d.old, parent_d.new,
								old_fk.ref_cols, attrs)
							or schema.pk_change_affects(
								parent_d.old, parent_d.new, attrs)
					end
					if affected then
						child_d = table_update(
							self, child_name, old_child, new_child)
						replace_dependency(
							child_d, 'fks', fk_name, old_fk, new_fk)
					end
				end
			end
		end
	end
end

local diff = {is_diff = true}

function schema.diff(sc0, sc1) --sync sc0 to sc1.
	local sc0 = assertf(isschema(sc0) and sc0, 'schema expected, got `%s`', type(sc0))
	sc0:check_refs()
	sc1:check_refs()
	local self = {engine = sc0.engine, __index = diff, old_schema = sc0, new_schema = sc1}

	--Diff schema objects.
	self.tables = diff_maps(self, sc1.tables, sc0.tables, diff_tables, nil, sc0, true)
	self.procs  = diff_maps(self, sc1.procs , sc0.procs , diff_procs , nil, sc0, sc0.supports_procs)

	--Recreate dependencies invalidated by field and primary-key changes.
	expand_index_dependencies(self, sc0, sc1)
	expand_fk_dependencies(self, sc0, sc1)

	return setmetatable(self, self)
end

--diff pretty-printing -------------------------------------------------------

local function dots(s, n) return #s > n and s:sub(1, n-2)..'..' or s end
local kbytes = function(x) return x and format_kbytes(x) or '' end
local function P(...) print(_(...)) end
function diff:pp(opt)
	local BODY = self.engine..'_body'
	print()
	local function P_fld(fld, prefix)
		P(' %1s %3s %-2s%-16s %-8s %-5s %7s %-2s %6s %-18s %s',
			fld.auto_increment and 'A' or '',
			prefix or '',
			fld.not_null and '*' or '',
			dots(fld.col, 16), fld.type or '',
			fld[self.engine..'_type'] or '',
			fld.scale and 'x'..fld.scale or '',
			(fld.fixed and 'F' or '')..(fld.nozero and 'Z' or ''),
			kbytes(fld.maxlen) or '',
			fld[self.engine..'_collation'] or '',
			repl(repl(fld[self.engine..'_default'], nil, fld.default), nil, '')
		)
	end
	local function format_fk(fk)
		return _('(%s) -> %s (%s)%s%s', cat(fk.cols, ','), fk.ref_table,
				cat(fk.ref_cols, ','),
				fk.ondelete and ' D:'..fk.ondelete or '',
				fk.onupdate and ' U:'..fk.onupdate or ''
			)
	end
	local function ix_cols(ix)
		local dt = {}
		for i,s in ipairs(ix) do
			dt[i] = s .. (ix.desc and ix.desc[i] and ':desc' or '')
		end
		return cat(dt, ',')
	end
	local function P_tg(tg, prefix)
		if not tg[BODY] then return end
		P('   %1sTG %d %s %s `%s`', prefix or '', tg.pos, tg.when, tg.op, tg.name)
		if prefix ~= '-' then
			print(outdent(tg[BODY], '         '))
		end
	end
	if self.tables and self.tables.add then
		for tbl_name, tbl in sortedpairs(self.tables.add) do
			P(' %-24s %-8s %-5s %7s %-2s %6s %-18s %s', '+ TABLE '..tbl_name,
				'type', self.engine, 'scale', 'FZ', 'maxlen', 'collation', 'default')
			print(('-'):rep(80))
			local pk = tbl.pk and index(tbl.pk)
			for i,fld in ipairs(tbl.fields) do
				local pki = pk and pk[fld.col]
				local desc = pki and tbl.pk.desc and tbl.pk.desc[pki]
				P_fld(fld, pki and _('%sK%d', desc and 'p' or 'P', pki))
			end
			print('    -------')
			if tbl.ixs then
				for ix_name, ix in sortedpairs(tbl.ixs) do
					P('    IX   %s', ix_cols(ix))
				end
			end
			if tbl.fks then
				for fk_name, fk in sortedpairs(tbl.fks) do
					P('    FK   %s', format_fk(fk))
				end
			end
			if tbl.checks then
				for ck_name, ck in sortedpairs(tbl.checks) do
					P('    CK   %s', ck[BODY] or ck.body)
				end
			end
			local tgs = tbl.triggers
			if tgs then
				local function cmp_tg(tg1, tg2)
					local a = tgs[tg1]
					local b = tgs[tg2]
					if a.op ~= b.op then return a.op < b.op end
					if a.when ~= b.when then return a.when < b.when end
					return a.pos < b.pos
				end
				for tg_name, tg in sortedpairs(tgs, cmp_tg) do
					P_tg(tg)
				end
			end
			print()
		end
	end
	if self.tables and self.tables.update then
		local hide_attrs = opt and opt.hide_attrs
		for old_tbl_name, d in sortedpairs(self.tables.update) do
			if opt and opt.tables and not opt.tables[old_tbl_name] then
				goto skip
			end
			P(' ~ TABLE %s%s', old_tbl_name,
				d.new.name ~= old_tbl_name and ' -> '..d.new.name or '')
			print(('-'):rep(80))
			if d.changed then
				for k in sortedpairs(d.changed) do
					P('       %-18s %s -> %s', k, d.old[k], d.new[k])
				end
			end
			if d.fields and d.fields.add then
				for col, fld in sortedpairs(d.fields.add) do
					P_fld(fld, '+')
				end
			end
			if d.fields and d.fields.remove then
				for col, fld in sortedpairs(d.fields.remove) do
					P_fld(fld, '-')
				end
			end
			if d.fields and d.fields.update then
				for col, d in sortedpairs(d.fields.update) do
					P_fld(d.old, '<')
					P_fld(d.new, '>')
					for k in sortedpairs(d.changed) do
						P('           %-14s %s -> %s', k, d.old[k], d.new[k])
					end
				end
			end
			if d.remove_pk then
					P('   -PK   %s', ix_cols(d.remove_pk))
			end
			if d.add_pk then
					P('   +PK   %s', ix_cols(d.add_pk))
			end
			if d.ixs and d.ixs.remove then
				for ix_name, ix in sortedpairs(d.ixs.remove) do
					P('   -IX   %s', ix_cols(ix))
				end
			end
			if d.ixs and d.ixs.add then
				for ix_name, ix in sortedpairs(d.ixs.add) do
					P('   +IX   %s', ix_cols(ix))
				end
			end
			if d.checks and d.checks.remove then
				for ck_name, ck in sortedpairs(d.checks.remove) do
					P('   -CK   %s', ck[BODY] or ck.body)
				end
			end
			if d.checks and d.checks.add then
				for ck_name, ck in sortedpairs(d.checks.add) do
					P('   +CK   %s', ck[BODY] or ck.body)
				end
			end
			if d.fks and d.fks.remove then
				for fk_name, fk in sortedpairs(d.fks.remove) do
					P('   -FK   %s', format_fk(fk))
				end
			end
			if d.fks and d.fks.add then
				for fk_name, fk in sortedpairs(d.fks.add) do
					P('   +FK   %s', format_fk(fk))
				end
			end
			if d.triggers and d.triggers.remove then
				for tg_name, tg in sortedpairs(d.triggers.remove) do
					P_tg(tg, '-')
				end
			end
			if d.triggers and d.triggers.add then
				for tg_name, tg in sortedpairs(d.triggers.add) do
					P_tg(tg, '+')
				end
			end
			print()
			::skip::
		end
	end
	if self.tables and self.tables.remove then
		for tbl_name in sortedpairs(self.tables.remove) do
			P('  - TABLE %s', tbl_name)
		end
		print()
	end
	if self.procs and self.procs.remove then
		for proc_name, proc in sortedpairs(self.procs.remove) do
			if proc[BODY] then
				P(' - PROC %s', proc_name)
			end
		end
		print()
	end
	if self.procs and self.procs.add then
		for proc_name, proc in sortedpairs(self.procs.add) do
			if proc[BODY] then
				P(' + PROC %s(', proc_name)
				for i,arg in ipairs(proc.args) do
					P_fld(arg)
				end
				P('\t)\n%s', proc[BODY])
			end
		end
		print()
	end
end

function schema:resolve_type(t, opt) --{attr = val, flag1, ...}

	resolve_type(self, t, t, 1, #t, empty, true, true)
	update_type(self, t)
	for i=#t,1,-1 do t[i] = nil end --remove flags

	--add translatable field attributes.
	for i,attr in ipairs{'text', 'info'} do
		local en_attr = 'en_'..attr
		t[attr] = function()
			local name = t.name
			return
					S(_('%s:%s', attr, name))
				or S(_('%s:%s.%s.%s', attr, name, tbl, tbl_type))
				or call(t[en_attr])
		end
		if opt and opt.translate then
			t[attr] = t[attr]()
		end
	end

	return t
end

function schema:resolve_types(fields, opt) --{field1, ...}
	for i,f in ipairs(fields) do
		local f = self:resolve_type(f, opt)
		if opt and opt.check_duplicates then
			assertf(isstr(f.name), 'field name not a string: %s: %s', opt.table_name, type(f.name))
			assertf(not fields[f.name], 'duplicate field name: %s.%s', opt.table_name, f.name)
		end
		fields[i] = f
		fields[f.name] = f
	end
	return fields
end

return schema
