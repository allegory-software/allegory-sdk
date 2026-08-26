--[[

	MDBX table scanner over mdbx_schema.
	Written by Cosmin Apreutesei. Public Domain.

TABLE SCAN
	db:scan           (table, path|path_spec, [alias]) -> scan
	- path_spec: 'COL =|is|>|>=|<|<=|starts|is_not_null|~=|in ?|:KEY [asc|desc], ...'
JOIN
	scan:[left_]join  (join_spec|inner_scan, [accept]) -> new_join_scan
	scan:child_scan   (join_spec|inner_scan) -> inner_scan
	- join_spec: 'TABLE|INDEX[@ALIAS].COL[,COL...] = MEMBER.COL[,COL...]'
FILTER
	scan:filter       (['[MEMBER.]COL [NAME],...', ]fn); fn({col->val}) -> t|f
	scan:in_|not_in   ('[MEMBER.]COL', values)   keep rows in/not-in list
	scan:where_has[nt](join_spec|inner_scan)     keep rows with/without a match
	scan:limit        (n|{arg = 'KEY'}, [offset|{arg = 'KEY'}])
	db:collate        (table, col, v) -> v       get comparison value
SELECT
	scan:select       ('[MEMBER.]COL [NAME],...'|outputs)
TERMINALS
	scan:each         ([args]) -> iter() -> true | nil
	scan:try_first    ([args]) -> scan | nil
	scan:exists       ([args]) -> true | false
	scan:count        ([args]) -> n
	scan:rows         ([shape], [args]) -> iter() -> scan, vals...|row
	scan:left_rows    ([shape], [args]) -> iter() -> scan [, vals...|row]
	scan:rows_array   ([shape], [args]) -> {row1,...}
	scan:first        ([shape], [args]) -> vals... | row | nil
	scan:one          ([shape], [args]) -> vals... | row | nil
	scan:must_one     ([shape], [args]) -> vals... | row
ORDER
	scan:sort      (spec|fn(row1, row2))
GROUP
	scan:group_by  (cols)
	scan:aggregate (agg, [cols], [hash]) -> scan
	scan:distinct  (cols, [hash]) -> scan; cols: {{name = NAME},...}
SET OPS
	scan:union      (scan2) -> new_union_scan     concatenates scan2 rows
	scan:intersect  (scan2)        rows in both, deduped (needs output)
	scan:except     (scan2)        rows not in scan2, deduped (needs output)
UPDATE
	scan:for_update ()   call it last: ensure all rows are loaded on first row.

LOW-LEVEL API ----------------------------------------------------------------

TABLE SCAN
	scan.reset         ([args])
	scan.next          ([by_group]) -> true | nil
	scan.next_group    () -> true | nil
	scan.next_in_group () -> true | nil
	scan.found         () -> true | nil
	scan.close         ()
	scan:col_decoder   (member, col, [comparison]) -> getter, collator
	scan.key_rec, scan.val_rec, scan.is_index, scan.can_next_group
MERGE UNION
	scan:merge_union (scan2) -> scan      ordered, deduped merge
OUTPUT SCAN (after select() or aggregate())
	scan.out_cols -> {'NAME',...}
	scan.out_specs -> {NAME -> {[table=], [col=], [op=]}}
	scan.get           ([row]) -> scan, vals... | scan, row
	scan:col_decoder   (name, [comparison]) -> getter, collator
MEMBER SCAN (after select() or aggregate())
	scan:materialized_scan (alias)        load rows and wrap scan as alias
	scan:streamed_scan     (alias)        wrap scan as alias (hide members)
JOIN
	scan.member_scans    -> {MEMBER -> scan}

]]

if not ... then require'mdbx_scan_test'; return end

require'mdbx_schema'
local C = ffi.load'mdbx_schema' --see src/c/mdbx_schema/mdbx_schema.c

local
	assertf, assert, copy, null =
	assertf, assert, copy, null

local Db = mdbx_db

--scratch space for building one key and reading one field; written and read
--within a single call, never handed to another file.
local pp = new'u8*[1]'
local pout = new'const u8*[1]'
local key_decode_buffer = u8a(MDBX_MAX_KEY_SIZE)

local key_reencode = mdbx_key_reencode

--TABLE SCANNER --------------------------------------------------------------

--[[
A table scanner seeks into a base table on a leading sequence of (pk cols)
and seeks into an index table on a leading sequence of (ix cols, pk cols).

The path is a sequence of terms:

	{{'COL','='|'is',P}, ...,
		{'COL','range'[,'>|>=',P][,'<|<=',P][,dir='asc|desc']}
		| {'COL','starts',P[,dir='asc|desc']}
		| {'COL','is_not_null'[,dir='asc|desc']}
		| {'COL','~=',P[,dir='asc|desc']}
		| {'COL','in',{P,...}[,dir='asc|desc']}
		| {'COL','in_list',P[,dir='asc|desc']},
		{'COL',dir='asc|desc'},...}
	P: {value=V} | {arg='KEY'} | {get=fn()} | {scan=S, col='COL'}

So 0..N '='|'is' terms + 0..1 bound term + 0..N dir terms.
A bound term is 'range', 'starts', 'is_not_null', '~=', 'in' or 'in_list'.

P is a param object telling how the value is supplied: by reading param.value
or param.get(), via reset{[param.arg]}, or from the current row of another scan.

'=', 'range', 'starts' and '~=' reject null, 'is' allows it. nulls in 'in'
lists are dropped. {scan=} needs '=' (it's used for nested joins).

'~=' and 'in' each seek several disjoint sub-ranges with one cursor, in
scan order: '~=' the rows below the value then the rows above it, 'in' one
per value. 'in' sorts and dedupes its own values, so the list order the
caller gives does not matter. 'in' takes one value per param, for a set of
values that comes from that many places. 'in_list' takes every value of one
param's own list value, for a set that can be a different size on every
reset.

Spec form:
	'COL [=|is P], COL >|>= P <|<= P | starts P | is_not_null P
		| ~= P | in P [asc|desc], ...'
	P: '?' positional arg | ':KEY' named arg
	'in P' is the 'in_list' term: P's value is the list of values.

Example:
	'tenant_id = ?, id >= ? <= ? desc'
converts to:
	{{'tenant_id', '=', {arg=1}}, {'id', 'range', '>=', {arg=2}, '<=', {arg=3}, dir=desc}}

Why so complicated:
 - index tables and base tables need different treatment.
 - eq cols can span an index key rec and/or val rec arbitrarily.
 - the optional range col can land on the index key rec or val rec.
 - rediscovers that fk keys can be used raw by analyzing params and even that
   has 2 modes: direct raw and key re-encode (needed by fks on nullable cols).
 - writing params individually into the key rec also has 4 modes:
   encode Lua value, copy raw key col, copy raw val col, re-encode key/val col.
 - descending means reversing the ranges and all mdbx ops which has edge cases.
 - edge case: bounds are converted to half-open byte intervals, but incrementing
   a byte prefix can have no successor which needs an extra bool state.
 - edge case: partial bounds over DUPFIXED PKs require padding.
 - edge case: an upper-only range on a nullable column requires creating a
   synthetic lower bound because null values come before non-null values; the
	same lower bound is used for is_not_null.
 - edge case: collated index columns do not contain the original text.
 - a base-table value from an index scan needs a secondary base-table lookup
   if the column is not in the index (we call this "uncovered").
 - a scan param is valid only while its source scan has a current row.
]]

--string prefix -> exclusive upper bound; nil when no larger prefix exists.
local function increment_prefix(prefix, sz)
	local i = sz - 1
	while i >= 0 and prefix[i] == 255 do i = i - 1 end
	if i < 0 then return end
	prefix[i] = prefix[i] + 1
	return i + 1
end

--copy and pad input data if not already for comparing with DUPFIXED keys.
local function pad_data(data, sz, out, out_sz)
	if not sz or sz >= out_sz then return data, sz end
	C.schema_key_pad(data, sz, out, out_sz)
	return out, out_sz
end

--for a table param, resolve the field and the rec (param.key_rec or
--param.val_rec) that holds its bytes, plus the param's schemas. does not
--judge type compatibility with output_field; the two callers treat a
--mismatch differently.
local function scan_param_rec(db, param, output_field)
	local scan = param.scan
	local param_schema = db:table_schema(scan.table)
	assertf(param_schema, 'no schema: %s', scan.table)
	local base_schema = param_schema.val_schema or param_schema
	local field = param_schema.fields[param.col]
	local rec
	if field and field.key_index
		and field.key_collator == output_field.key_collator
	then --field is in the index's key_rec and it's usable raw.
		rec = scan.key_rec
	else
		field = base_schema.fields[param.col]
		assertf(field, 'no field: %s.%s', scan.table, param.col)
		if field.key_index then --field is pk
			rec = param_schema.is_index and scan.val_rec or scan.key_rec
		else --value column: only a base-table param carries it in val_rec;
			--an index param's val_rec holds the pk, needing a base lookup.
			if param_schema.is_index then
				scan:need_base()
				rec = scan.base_val_rec
			else
				rec = scan.val_rec
			end
		end
	end
	return field, rec, param_schema, base_schema
end

--if params[1..key_n] are all table-type eq params pointing at the same rec,
--in that rec's own field order, the key can be built without a field-by-field
--Lua loop: 'direct' when the layout is also byte-identical (key_sig match,
--all not_null) -> use the rec as-is; else 'reencode' -> key_reencode()
--bridges a layout difference (e.g. a nullable column) in one C call instead
--of key_n Lua closures.
local function direct_read_rec(db, schema, params)
	local first_rec, first_key_schema
	local all_not_null = true
	for i = 1, #schema.key_fields do
		local param = params[i]
		local output_field = schema.key_fields[i]
		if not param.scan then return end
		local field, rec, param_schema, base_schema =
			scan_param_rec(db, param, output_field)
		--the verbatim/reencode paths reuse raw bytes, so a value column or a
		--layout mismatch both rule them out.
		if field.key_index ~= i
			or field.mdbx_type ~= output_field.mdbx_type
			or field.maxlen ~= output_field.maxlen
			or field.fixed ~= output_field.fixed
			or field.nozero ~= output_field.nozero
			or field.key_collator ~= output_field.key_collator
		then
			return
		end
		if i == 1 then
			first_rec = rec
			first_key_schema = rec == param.scan.key_rec
				and param_schema or base_schema
		elseif rec ~= first_rec then
			return
		end
		all_not_null = all_not_null and field.not_null
	end
	if all_not_null and first_key_schema.key_sig == schema.key_sig then
		return 'direct', first_rec
	end
	return 'reencode', first_rec, first_key_schema
end

--key_add_param() -> f(out) that writes one field at pp[0] and advances
--pp; returns false when op rejects null or when a scan source is absent.
local function key_add_param(db, param, output_schema, slot, scan, op)
	local output_field = output_schema.key_fields[slot]
	local out_st = output_schema._st
	local cap = output_schema.key_fields.max_rec_size
	local i = slot - 1
	if not param.scan then
		local get, arg, value = param.get, param.arg, param.value
		return function(out)
			local v = value
			if get then
				v = get()
			elseif arg then
				local args = scan.args
				v = args and args[arg]
				if v == nil then
					assertf(op == 'is', 'missing arg: %s', arg)
				end
			end
			local len
			if v == nil or v == null then
				if op ~= 'is' or output_field.not_null then return false end
				len = -1
			else
				len = output_field.encode(db, 'scan', pp[0], v)
			end
			C.schema_key_add(out_st, i, out, cap, len, pp)
			return true
		end
	else
		local field, rec, param_schema, base_schema =
			scan_param_rec(db, param, output_field)
		local found = param.scan.found
		local is_key_read = field.key_index ~= nil
		local st = rec == param.scan.key_rec
			and param_schema._st or base_schema._st
		local field_i = field.key_index and field.key_index - 1 or field.val_index - 1
		local write

		--raw bytes only work when the source encoding matches output_field's.
		--otherwise decode the source value and encode it through output_field;
		--like the raw path, an absent (DB null) source aborts the key.
		if field.mdbx_type ~= output_field.mdbx_type
			or field.maxlen ~= output_field.maxlen
			or field.fixed ~= output_field.fixed
			or field.nozero ~= output_field.nozero
			or field.key_collator ~= output_field.key_collator
		then
			local decode = field.decode
			assertf(decode, 'incompatible: %s.%s -> %s.%s',
				param.scan.table, param.col,
				output_schema.name, output_field.col)
			write = function(out)
				if not found() then return false end
				local len = is_key_read
					and C.schema_get_key_rec(st, field_i, rec,
						key_decode_buffer, MDBX_MAX_KEY_SIZE, pout, nil)
					or C.schema_get_val_rec(st, field_i, rec, pout)
				if len < 0 then return false end
				local elen = output_field.encode(db, 'scan', pp[0],
					decode(pout[0], len))
				C.schema_key_add(out_st, i, out, cap, elen, pp)
				return true
			end
		elseif is_key_read then
			write = function(out)
				if not found() then return false end
				return C.schema_key_add_key_rec(out_st, i, out, cap, pp,
					st, field_i, rec) ~= 0
			end
		else
			write = function(out)
				if not found() then return false end
				return C.schema_key_add_val_rec(out_st, i, out, cap, pp,
					st, field_i, rec) ~= 0
			end
		end
		return write
	end
end

--key_write() -> f(out) -> data, sz; nil when a param cannot form
--the key.
local function key_write(db, output_schema, params, path, scan, i0, n)
	local key_add = {}
	for i = 1, n do
		local param_i = i0 + i - 1
		key_add[i] = key_add_param(db, params[param_i], output_schema, i,
			scan, path[param_i][2])
	end
	return function(out)
		pp[0] = out
		for k = 1, n do
			if not key_add[k](out) then return end
		end
		return out, C.schema_key_size(out, pp)
	end
end

--bound_write() -> f(out, prefix_sz) -> data, sz; nil when the param
--cannot form the bound. When partial is true, bound_write() trims a starts
--value's terminator.
local function bound_write(db, param, output_schema, slot, scan, op, partial)
	if not param then return end
	local key_add = key_add_param(db, param, output_schema, slot, scan, op)
	local trim = partial and output_schema.key_fields[slot].elem_size
	return function(out, prefix_sz)
		C.schema_key_add_start(out, prefix_sz, pp)
		if not key_add(out) then return end
		local sz = C.schema_key_size(out, pp)
		if trim then sz = sz - trim end
		return out, sz
	end
end

local function write_null_bound(output_schema, slot, out, prefix_sz)
	C.schema_key_add_start(out, prefix_sz, pp)
	C.schema_key_add(output_schema._st, slot - 1, out,
		output_schema.key_fields.max_rec_size, -1, pp)
	return out, C.schema_key_size(out, pp)
end

local Scan = {}

local MDBX_val_size = sizeof'MDBX_val'

--a col the leading depth fields fix holds one value for the whole scan,
--so a path that names it again (an index key col that is also a pk col)
--orders nothing the second time. a collated col keeps its key form in
--an index key and its original text in the base key, so a bound cannot be
--encoded against one past the index key: the order stops there.
local function scan_order(schema, depth, reverse)
	local order = {}
	local fields = schema.path_fields
	local seen = {}
	reverse = not not reverse --descending ~= reverse below needs two bools
	for i = 1, depth do seen[fields[i].col] = true end
	for i = depth + 1, #fields do
		local field = fields[i]
		if field.collator
			and not (schema.is_index and i <= #schema.key_fields)
		then break end
		if not seen[field.col] then
			seen[field.col] = true
			local descending = not not field.descending
			local dir = descending ~= reverse and 'desc' or 'asc'
			order[#order + 1] = field.col..' '..dir
		end
	end
	return order
end
mdbx_scan_order = scan_order

local SPEC_OPS = {['='] = true, ['>'] = true, ['>='] = true,
	['<'] = true, ['<='] = true, ['~='] = true, is = true, starts = true}

local function parse_scan_spec(spec)
	local path = {}
	if spec:match'^%s*$' then return path end
	local argn = 0
	for term_spec in spec:gmatch'[^,]+' do
		local next_tok = term_spec:gmatch'%S+'
		local col = assertf(next_tok(), 'scan: %s: no col', spec)
		local eq_op, eq_param, dir, lo_op, lo_param, hi_op, hi_param
		local function param_of(tok, v)
			if v == '?' then
				argn = argn + 1
				return {arg = argn}
			end
			local name = v and v:match'^:([%a_][%w_]*)$'
			assertf(name, 'scan: %s: expected ? or :KEY'
				..' after %s %s', spec, col, tok)
			return {arg = name}
		end
		for tok in next_tok do
			if tok == 'asc' or tok == 'desc' then
				dir = tok
			elseif tok == 'is_not_null' then
				eq_op = 'is_not_null'
			elseif tok == 'in' then --the arg holds the values
				eq_op, eq_param = 'in_list', param_of(tok, next_tok())
			elseif SPEC_OPS[tok] then
				local param = param_of(tok, next_tok())
				if tok == '>' or tok == '>=' then
					lo_op, lo_param = tok, param
				elseif tok == '<' or tok == '<=' then
					hi_op, hi_param = tok, param
				else
					eq_op, eq_param = tok, param
				end
			else
				assertf(false, 'scan: %s: unexpected: %s', spec, tok)
			end
		end
		assertf(not (eq_op and (lo_op or hi_op)),
			'scan: %s: %s has conflicting ops', spec, col)
		local term = {col, dir = dir}
		if eq_op == 'is_not_null' then
			term[2] = 'is_not_null'
		elseif eq_op then
			term[2], term[3] = eq_op, eq_param
		elseif lo_op and hi_op then
			term[2], term[3], term[4], term[5], term[6] =
				'range', lo_op, lo_param, hi_op, hi_param
		elseif lo_op then
			term[2], term[3] = lo_op, lo_param
		elseif hi_op then
			term[2], term[3] = hi_op, hi_param
		end
		add(path, term)
	end
	return path
end

function Db:scan(tbl, path, alias)
	local db = self
	local schema = assert(db:table_schema(tbl))
	if isstr(path) then path = parse_scan_spec(path) end
	local scan = object(Scan)
	local base_schema = schema.val_schema or schema
	scan.db = db
	scan.table = schema.name --the index's own name when scanning an index
	scan.base_table = base_schema.name
	scan.member_scans = {[alias or base_schema.name] = scan}

	--path parsing, validation, analysis --------------------------------------

	local eq_n = 0 --how many equality columns
	local eq_params = {}
	local reverse
	local range_field
	local is_not_null
	local prefix_param
	local not_equal_param
	local in_params --one param per value
	local in_list   --one param holding every value
	local lo_op, lo_param
	local hi_op, hi_param
	for i, term in ipairs(path) do
		local col, op = term[1], term[2]
		local f = schema.path_fields[i]
		assertf(f and f.col == col, 'invalid col: %s', col)
		if op then
			assertf(i == eq_n + 1 and not range_field,
				'invalid path term: %s', col)
			if op == '=' or op == 'is' then --{col, '='|'is', param}
				local param = term[3]
				assert(param)
				assert(op == '=' or not param.scan)
				eq_n = eq_n + 1
				eq_params[eq_n] = param
			elseif op == 'starts' then --{col, 'starts', param}
				range_field = f
				prefix_param = term[3]
				assert(prefix_param)
				assert(not prefix_param.scan)
			elseif op == 'is_not_null' then --{col, 'is_not_null'}
				range_field = f
				is_not_null = true
			elseif op == '~=' then --{col, '~=', param}
				range_field = f
				not_equal_param = term[3]
				assert(not_equal_param)
				assert(not not_equal_param.scan)
			elseif op == 'in' then --{col, 'in', {param1,...}}
				range_field = f
				in_params = term[3]
				for _, p in ipairs(in_params) do assert(not p.scan) end
			elseif op == 'in_list' then --{col, 'in_list', param}
				range_field = f
				in_list = term[3]
				assert(not in_list.scan)
			else --range or inequality
				range_field = f
				if op == 'range' then --{col, 'range', lo_op, param, hi_op, param}
					lo_op, lo_param = term[3], term[4]
					hi_op, hi_param = term[5], term[6]
					assert(not lo_op or lo_op == '>' or lo_op == '>=')
					assert(not hi_op or hi_op == '<' or hi_op == '<=')
				elseif op == '>' or op == '>=' then --{col, '>'|'>=', param}
					lo_op, lo_param = op, term[3]
				elseif op == '<' or op == '<=' then --{col, '<'|'<=', param}
					hi_op, hi_param = op, term[3]
				else
					assertf(false, 'invalid op: %s', op)
				end
				assert(not lo_op == not lo_param)
				assert(not hi_op == not hi_param)
				assert(not lo_param or not lo_param.scan)
				assert(not hi_param or not hi_param.scan)
			end
		end
		local dir = term.dir
		if dir then
			assertf(dir == 'asc' or dir == 'desc', 'invalid path dir: %s', dir)
			--equality field direction does not affect returned order.
			if op ~= '=' and op ~= 'is' then
				local backwards = not f.descending ~= (dir == 'asc')
				if reverse == nil then
					reverse = backwards
				else
					assertf(reverse == backwards, 'mixed direction: %s', col)
				end
			end
		end
	end

	local is_index = schema.is_index
	local key_n = #schema.key_fields
	local exact_key = eq_n >= key_n
	scan.is_index = is_index
	scan.can_next_group = not exact_key --no groups when entire key is pinned
	reverse = reverse or false
	scan.reverse = reverse

	--seeked (key, val), published for use as raw input in other scans.
	local key_rec = MDBX_val()
	local val_rec = MDBX_val()
	scan.key_rec = key_rec
	scan.val_rec = val_rec

	--base-table seeked (key, val) for uncovered columns, seeked by next(),
	--but you must call scan:need_base() to enable it.
	local base_key_rec, base_val_rec

	local range_in_val = exact_key and is_index
	local range_rec = range_in_val and val_rec or key_rec

	--eq columns start in key_rec but can extend into val_rec on an index.
	--range_eq_n is how many eq columns are in range_rec.
	local range_eq_n =
		exact_key and not is_index and 0
		or (exact_key and is_index) and eq_n - key_n
		or eq_n
	--is there anything to seek to past the exact key?
	local has_bound = range_eq_n > 0 or prefix_param or not_equal_param
		or in_params or in_list or lo_param or hi_param
		or (is_not_null and not range_field.not_null)

	--param reading / encoder compilation --------------------------------------

	local exact_write
	if exact_key then
		local direct_mode, direct_rec, direct_key_schema =
			direct_read_rec(db, schema, eq_params)
		if direct_mode == 'direct' then
			local found = eq_params[1].scan.found
			exact_write = function()
				if not found() then return false end
				copy(key_rec, direct_rec, MDBX_val_size)
				return true
			end
		elseif direct_mode == 'reencode' then
			local found = eq_params[1].scan.found
			local out = u8a(schema.key_fields.max_rec_size)
			exact_write = function()
				if not found() then return false end
				return C.schema_key_reencode_rec(direct_key_schema._st,
					schema._st, direct_rec, key_rec, out,
					schema.key_fields.max_rec_size) == 1
			end
		else
			local out = u8a(schema.key_fields.max_rec_size)
			local write = key_write(db, schema, eq_params, path, scan, 1, key_n)
			exact_write = function()
				local data, sz = write(out)
				if not data then return false end
				key_rec.data, key_rec.size = data, sz
				return true
			end
		end
	end

	--reset & next_bounds -----------------------------------------------------

	--state between reset() and next().
	local limit_rec = MDBX_val()
	local has_limit, empty_scan, started, found
	local next_bounds -- next_bounds() -> true, [seek, sz], [limit, sz] | nil

	if has_bound then

		--one entry per disjoint sub-range to walk, in scan order. when the
		--range col is desc its bytes are inverted, so byte order is the
		--reverse of value order, and a backward scan reverses that again.
		local values_ascending = range_field
			and (not not range_field.descending) == reverse
		local ranges
		local in_values --resolved values, indexed by range_order
		local in_value  --the value the sub-range being seeked now looks for
		if not_equal_param then
			--everything below the value, and everything above it.
			local below = {hi_op = '<', hi_param = not_equal_param}
			local above = {lo_op = '>', lo_param = not_equal_param}
			if values_ascending then
				ranges = {below, above}
			else
				ranges = {above, below}
			end
		elseif in_params or in_list then
			--one point sub-range per value, all seeked through the same spec:
			--range_at() puts the value for the current sub-range in in_value,
			--so the number of values can differ on every reset.
			local read_in_value = function() return in_value end
			ranges = {{lo_op = '>=', lo_param = {get = read_in_value},
				hi_op = '<=', hi_param = {get = read_in_value}}}
		else
			ranges = {{lo_op = lo_op, lo_param = lo_param,
				hi_op = hi_op, hi_param = hi_param}}
		end
		for _, r in ipairs(ranges) do
			--when the path rejects null without a non-null lower bound, start
			--after DB null.
			if range_field and not range_field.not_null
				and (is_not_null or r.hi_param and not r.lo_param)
			then
				r.lo_op = '>'
				r.lo_null = true
			end
		end
		local range_i
		local range_n = #ranges

		--order_ranges(args) rebuilds range_order and range_n; nil when the
		--order cannot change between resets.
		local order_ranges
		--range_at(i) -> the sub-range spec to seek for step i.
		local range_at

		if in_params or in_list then
			--range_order[1..range_n] indexes in_values in the order they are
			--walked; order_ranges() fills it.
			local range_order = {}
			local coll = range_field.collator
			local keys = {}
			local by_key = values_ascending
				and function(a, b) return keys[a] < keys[b] end
				or  function(a, b) return keys[a] > keys[b] end
			in_values = {}
			local function param_value(param, args)
				if param.get then return param.get() end
				if param.arg then return args and args[param.arg] end
				return param.value
			end
			--DB null, and a value the args do not supply, are in no list.
			order_ranges = function(args)
				local n
				if in_list then
					local list = param_value(in_list, args)
					n = #list
					for i = 1, n do in_values[i] = list[i] end
				else
					n = #in_params
					for i = 1, n do
						in_values[i] = param_value(in_params[i], args)
					end
				end
				local m = 0
				for i = 1, n do
					local v = in_values[i]
					if v ~= nil and v ~= null then
						m = m + 1
						in_values[m] = v
						keys[m] = coll and coll.key(v) or v
						range_order[m] = m
					end
				end
				for i = m + 1, #range_order do range_order[i] = nil end
				sort(range_order, by_key)
				--drop repeats: compute_bounds() would seek the same rows twice.
				local k, prev = 0
				for i = 1, m do
					local key = keys[range_order[i]]
					if k == 0 or key ~= prev then
						k = k + 1
						range_order[k] = range_order[i]
						prev = key
					end
				end
				range_n = k
			end
			local fixed = true
			if in_list then
				fixed = not (in_list.get or in_list.arg)
			else
				for _, param in ipairs(in_params) do
					if param.get or param.arg then fixed = false; break end
				end
			end
			if fixed then --values are in already; sort them once.
				order_ranges()
				order_ranges = nil
			end
			range_at = function(i)
				in_value = in_values[range_order[i]]
				return ranges[1]
			end
		else
			range_at = function(i) return ranges[i] end
		end

		if prefix_param then --prefix scans require a varsize string field.
			assertf(range_field.maxlen and not range_field.fixed,
				'starts on field: %s', range_field.col)
			--a collated prefix scan needs key prefixes.
			local coll = range_field.key_collator
			assertf(not coll or coll.prefix,
				'starts on a %s field: %s', coll and coll.kind, range_field.col)
		end

		if range_field and range_field.descending then
			--reverse range bounds for desc range col because bounds are in byte-order.
			for _, r in ipairs(ranges) do
				if r.hi_op or r.lo_op then
					r.lo_op, r.hi_op =
						r.hi_op and (r.hi_op == '<' and '>' or '>='),
						r.lo_op and (r.lo_op == '>' and '<' or '<=')
					r.lo_param, r.hi_param = r.hi_param, r.lo_param
					r.lo_null, r.hi_null = r.hi_null, r.lo_null
				end
			end
		end

		local range_schema = range_in_val and schema.val_schema or schema
		--range_eq_i is where range eq columns start among the path's eq columns.
		local range_eq_i = range_in_val and key_n + 1 or 1
		local dup_sz = range_in_val and schema.dup_fixedsize

		--range key's eq prefix (shared by starts/lo/hi), when non-empty.
		local eq_write = range_eq_n > 0
			and key_write(db, range_schema, eq_params, path, scan,
				range_eq_i, range_eq_n)

		--range bound fields, each appended after the eq prefix at the same slot.
		local starts_write =
			bound_write(db, prefix_param, range_schema, range_eq_n+1, scan,
				'starts', true)
		local shared = eq_write or starts_write
		local need_seek, need_limit = shared, shared
		for _, r in ipairs(ranges) do
			r.lo_write = bound_write(db, r.lo_param, range_schema, range_eq_n+1,
				scan, r.lo_op)
			r.hi_write = bound_write(db, r.hi_param, range_schema, range_eq_n+1,
				scan, r.hi_op)
			need_seek  = need_seek  or r.lo_write or r.lo_null
			need_limit = need_limit or r.hi_write or r.hi_null
		end

		local range_cap = range_schema.key_fields.max_rec_size
		local seek_key  = need_seek  and u8a(range_cap)
		local limit_key = need_limit and u8a(range_cap)

		--eq prefix (+ range bound) -> seek key, then the limit to stop at;
		--swapped for a reverse scan so next() has one fixed role per side.
		--nothing means this sub-range holds no rows.
		--compute_bounds(range) -> true, seek, seek_sz, limit, limit_sz
		local function compute_bounds(r)
			local psz = 0
			if eq_write then
				local data, sz = eq_write(seek_key)
				if not data then return end
				psz = sz
			end

			local lo_data, lo_sz, hi_data, hi_sz
			if starts_write then
				local data, sz = starts_write(seek_key, psz)
				if not data then return end
				lo_data, lo_sz = data, sz
				copy(limit_key, data, sz)
				hi_data, hi_sz = limit_key, increment_prefix(limit_key, sz)
			else
				if psz > 0 then copy(limit_key, seek_key, psz) end
				if r.lo_write or r.lo_null then
					local data, sz
					if r.lo_write then
						data, sz = r.lo_write(seek_key, psz)
					else
						data, sz = write_null_bound(range_schema,
							range_eq_n + 1, seek_key, psz)
					end
					if not data then return end
					lo_data, lo_sz = data, sz
					if r.lo_op == '>' then
						lo_sz = increment_prefix(data, sz)
						if not lo_sz then return end
					end
				elseif psz > 0 then
					lo_data, lo_sz = seek_key, psz
				end
				if r.hi_write or r.hi_null then
					local data, sz
					if r.hi_write then
						data, sz = r.hi_write(limit_key, psz)
					else
						data, sz = write_null_bound(range_schema,
							range_eq_n + 1, limit_key, psz)
					end
					if not data then return end
					hi_data, hi_sz = data, sz
					if r.hi_op == '<=' then
						hi_sz = increment_prefix(data, sz)
					end
				elseif psz > 0 then
					hi_data, hi_sz = limit_key, increment_prefix(limit_key, psz)
				end
			end

			if dup_sz then
				lo_data, lo_sz = pad_data(lo_data, lo_sz, seek_key, dup_sz)
				hi_data, hi_sz = pad_data(hi_data, hi_sz, limit_key, dup_sz)
			end
			if reverse then
				return true, hi_data, hi_sz, lo_data, lo_sz
			else
				return true, lo_data, lo_sz, hi_data, hi_sz
			end
		end

		--skips the sub-ranges whose bounds cannot be formed.
		next_bounds = function()
			while range_i < range_n do
				range_i = range_i + 1
				local ok, seek_data, seek_sz, limit_data, limit_sz =
					compute_bounds(range_at(range_i))
				if ok then
					return true, seek_data, seek_sz, limit_data, limit_sz
				end
			end
		end

		function scan.reset(args)
			scan.args = args
			empty_scan = false
			if exact_write and not exact_write() then
				empty_scan = true
			elseif order_ranges then
				order_ranges(args)
			end
			range_i = 0
			started = false
			found = nil
		end

	else
		--no range_eq/lo/hi/prefix past the exact key (or no key at all):
		--the whole key, with no key to seek to and no limit to stop
		--before. yielded tells seek_next() there is no second one, both
		--when its own seek finds nothing and when next() runs out of rows.
		local yielded
		next_bounds = function()
			if yielded then return end
			yielded = true
			return true
		end

		function scan.reset(args)
			scan.args = args
			empty_scan = false
			if exact_write and not exact_write() then
				empty_scan = true
			end
			yielded = false
			started = false
			found = nil
		end
	end

	--next --------------------------------------------------------------------

	--direction-aware steps.
	local step_op  = reverse and C.MDBX_PREV       or C.MDBX_NEXT
	local dup_op   = reverse and C.MDBX_PREV_DUP   or C.MDBX_NEXT_DUP
	local nodup_op = reverse and C.MDBX_PREV_NODUP or C.MDBX_NEXT_NODUP

	--figure out the right seek ops and stepping ops.
	local seek_op, first_op, last_dup_op
	local next_op, next_in_group_op, next_group_op
	if exact_key and is_index then --index key is pinned; scan walks dup vals.
		seek_op = reverse and C.MDBX_TO_EXACT_KEY_VALUE_LESSER_THAN
			or C.MDBX_GET_BOTH_RANGE
		first_op = C.MDBX_SET_KEY
		--a reverse dup scan lands on the key, then walks to its last dup.
		last_dup_op = reverse and C.MDBX_LAST_DUP or nil
		next_op = dup_op
		next_in_group_op = dup_op
		--index key is pinned, range is in the dup vals, so no next key to step to.
		next_group_op = false
	elseif exact_key then --single base-table row, no stepping.
		seek_op = reverse and C.MDBX_TO_KEY_LESSER_THAN or C.MDBX_SET_RANGE
		first_op = C.MDBX_SET_KEY
		next_op = false
		next_in_group_op = false
		next_group_op = false
	else --range/prefix/full scan: walk the whole key, dup groups included.
		seek_op = reverse and C.MDBX_TO_KEY_LESSER_THAN or C.MDBX_SET_RANGE
		first_op = reverse and C.MDBX_LAST or C.MDBX_FIRST
		next_op = step_op
		next_in_group_op = is_index and dup_op
		next_group_op = is_index and nodup_op or next_op
	end

	local cur
	local base_cur --base-table lookup state

	--move on the first row between the seek key and the limit key given by
	--next_bounds(); when move finds no row there, or lands past the limit key,
	--ask next_bounds() again.
	local function seek_next() -- -> true | nil
		while true do
			local ok, seek_data, seek_sz, limit_data, limit_sz = next_bounds()
			if not ok then return end
			local must_seek = seek_sz ~= nil
			has_limit = limit_sz ~= nil
			if must_seek then
				range_rec.data, range_rec.size = seek_data, seek_sz
			end
			if has_limit then
				limit_rec.data, limit_rec.size = limit_data, limit_sz
			end
			if not cur then cur = db:cursor(schema.name) end
			local start_op = must_seek and seek_op or first_op
			local landed = cur:move_raw_into(start_op, key_rec, val_rec)
			if landed and last_dup_op and not must_seek then
				landed = cur:move_raw_into(last_dup_op, key_rec, val_rec)
			end
			if landed and not (has_limit and
				(C.schema_key_cmp_rec(range_rec, limit_rec) < 0) == reverse)
			then return true end
		end
	end

	local function next_row(op)
		assert(started ~= nil, 'next: reset not called')
		found = nil
		if not started then
			started = true
			if empty_scan then return end
			if not seek_next() then return end
		elseif op then
			if not cur:move_raw_into(op, key_rec, val_rec)
				or (has_limit and
					(C.schema_key_cmp_rec(range_rec, limit_rec) < 0) == reverse)
			then
				if not seek_next() then return end
			end
		else --op is nil, no advance or limit check.
			return
		end
		if base_key_rec then
			if not base_cur then base_cur = db:cursor(base_schema.name) end
			copy(base_key_rec, val_rec, MDBX_val_size)
			assert(base_cur:move_raw_into(C.MDBX_SET_KEY,
				base_key_rec, base_val_rec), 'broken index')
		end
		found = true
		return true
	end
	function scan.next(by_group)
		local op; if by_group then op = next_group_op else op = next_op end
		return next_row(op)
	end
	function scan.next_in_group()
		return next_row(next_in_group_op)
	end
	function scan.next_group()
		return next_row(next_group_op)
	end
	function scan.found()
		return found
	end

	--use the stored row count for full scans and scans with an exact index key.
	--if next() is replaced downstream, the slow Scan:count() is called instead.
	local count_fast
	if not has_bound and not exact_key then
		count_fast = function() return db:table_entries(schema.name) end
	elseif not has_bound and is_index then --exact index key: count its dups
		count_fast = function(args)
			scan.reset(args)
			if not scan.next() then return 0 end
			return cur:dup_count()
		end
	end
	if count_fast then
		local plain_next = scan.next
		function scan:count(args)
			if scan.next ~= plain_next then return Scan.count(self, args) end
			local n = count_fast(args)
			scan.close()
			return n
		end
	end

	function scan:need_base()
		if base_key_rec then return end
		assert(not started)
		base_key_rec = MDBX_val()
		base_val_rec = MDBX_val()
		scan.base_val_rec = base_val_rec
	end

	function scan.close()
		started = nil
		if cur then cur:close(); cur = nil end
		if base_cur then base_cur:close(); base_cur = nil end
	end

	--col decoder -------------------------------------------------------------

	--folded requests the column's collation key instead of its display form.
	function scan:col_decoder(member, col, folded)
		assertf(member == (alias or base_schema.name),
			'col_decoder: unknown member: %s', tostring(member))
		local field = schema.fields[col]
		--an index key holds the collation key, not the original value.
		local indexed_coll = field and field.key_collator
		local get
		if field and field.key_index and (not indexed_coll or folded) then
			local st, ki, decode = schema._st, field.key_index-1, field.decode
			get = function()
				local len = C.schema_get_key_rec(st, ki, key_rec,
					key_decode_buffer, MDBX_MAX_KEY_SIZE, pout, nil)
				if len == -1 then return nil end
				return decode(pout[0], len)
			end
		else
			--col_decoder() reads the original value from the base table.
			field = base_schema.fields[col]
			assertf(field, 'no field: %s.%s', schema.name, col)
			local st = base_schema._st
			local decode = field.decode
			if field.key_index then
				local rec = is_index and val_rec or key_rec
				local ki = field.key_index-1
				get = function()
					local len = C.schema_get_key_rec(st, ki, rec,
						key_decode_buffer, MDBX_MAX_KEY_SIZE, pout, nil)
					if len == -1 then return nil end
					return decode(pout[0], len)
				end
			else --col not in index: base-table lookup
				local vi = field.val_index-1
				local rec = val_rec
				if is_index then
					scan:need_base()
					rec = base_val_rec
				end
				get = function()
					local len = C.schema_get_val_rec(st, vi, rec, pout)
					if len == -1 then return nil end
					return decode(pout[0], len)
				end
			end
		end
		local coll = field.collator
		if folded and not indexed_coll and coll then
			local raw = get
			get = function() return coll.key(raw()) end
		end
		return get, coll
	end

	--explain -----------------------------------------------------------------

	function scan.explain() -- -> {table, key, order, reverse}
		local scan_reverse = not not reverse
		return {
			table = schema.val_schema and schema.val_schema.name or schema.name,
			key = schema.name,
			order = scan_order(schema, eq_n, scan_reverse),
			reverse = scan_reverse,
		}
	end

	return scan
end

function Scan:each(args)
	self.reset(args)
	return self.next --since it returns true|nil
end

function Scan:try_first(args)
	self.reset(args)
	if self.next() then return self end
end

function Scan:exists(args)
	self.reset(args)
	return self.next() or false
end

function Scan:count(args)
	self.reset(args)
	local n = 0
	while self.next() do n = n + 1 end
	self.close()
	return n
end

--yields one row per reset() even when nothing is found (null-extended),
--then continues while found() holds.
function Scan:left_rows(args)
	self.reset(args)
	local first = true
	local get = self.get
	return function()
		if first then
			first = false
			self.next()
		elseif not self.found() or not self.next() then
			return
		end
		if get and self.found() then return get() end
		return self
	end
end

local function comma_list(s)
	if istab(s) then
		local i = 0
		return function() i = i + 1; return s[i] end
	end
	return s:gmatch'[^,]+'
end

--'[MEMBER.]COL [NAME], ...' | {{member=,col=,name=},...} -> members,
--cols, names
local function col_specs(scan, spec, what)
	local members, cols, names = {}, {}, {}
	for item in comma_list(spec) do
		local member, col, name
		if isstr(item) then
			local col_spec
			col_spec, name = item:match'^%s*(%S+)%s*(%S*)%s*$'
			assertf(col_spec, '%s: bad col: %s', what, item)
			member, col = col_spec:match'^(.-)%.(.*)$'
			col = col or col_spec
			name = name ~= '' and name or col
		else
			member, col, name = item.member, item.col, item.name
		end
		if not member then
			member = next(scan.member_scans)
			assertf(not next(scan.member_scans, member),
				'%s: ambiguous col: %s', what, col)
		end
		members[#members + 1] = member
		cols[#cols + 1] = col
		names[#names + 1] = name
	end
	assertf(#cols > 0, '%s: no cols', what)
	return members, cols, names
end

function Scan:filter(cols, accept)
	if accept == nil then
		cols, accept = nil, cols
	else
		local members, col_list, names = col_specs(self, cols, 'filter')
		local getters, row = {}, {}
		for i, member in ipairs(members) do
			getters[i] = self:col_decoder(member, col_list[i], true)
		end
		local test, n = accept, #getters
		accept = function()
			for i = 1, n do row[names[i]] = getters[i]() end
			return test(row)
		end
	end
	local next_row = self.next
	--advance until accept() approves the current row.
	self.next = function(by_group)
		while next_row(by_group) do
			if accept() then return true end
		end
	end
	self.can_next_group = nil --a retry would jump past a same-key candidate
	return self
end

--keep the rows whose col is in values, or the rows whose col is not,
--comparing by the col's collated form. for a col that a path term can
--seek, use the 'in' path term instead: this reads every row.
local function membership_filter(scan, col, values, what, want)
	local members, cols = col_specs(scan, col, what)
	assertf(#cols == 1, '%s: one col expected, got %d', what, #cols)
	local get, coll = scan:col_decoder(members[1], cols[1], true)
	local set = {}
	for _, value in ipairs(values) do
		set[coll and coll.key(value) or value] = true
	end
	scan:filter(function()
		--map DB null to the public null sentinel.
		local value = get()
		value = value == nil and null or value
		return (set[value] ~= nil) == want
	end)
	return scan
end

function Scan:in_(col, values)
	return membership_filter(self, col, values, 'in_', true)
end

function Scan:not_in(col, values)
	return membership_filter(self, col, values, 'not_in', false)
end

--UNION ----------------------------------------------------------------------

--a spec survives the union only where both sides read the same col.
local function same_out_specs(scan1, scan2)
	local specs1, specs2 = scan1.out_specs, scan2.out_specs
	if not (specs1 and specs2) then return end
	local specs = {}
	for i, name in ipairs(scan1.out_cols) do
		local s1, s2 = specs1[name], specs2[name]
		if s1 and s2 and s1.table == s2.table and s1.col == s2.col
			and s1.op == s2.op
		then
			specs[name] = s1
		end
	end
	return specs
end

function Scan:union(scan2)
	local scan1 = self
	local scan = object(Scan)
	scan.db = scan1.db
	local current_scan = scan1
	local output1 = scan1.get ~= nil
	local output2 = scan2.get ~= nil
	local found
	function scan.reset(args)
		scan.args = args
		scan1.reset(args)
		scan2.reset(args)
		current_scan = scan1
		found = nil
	end
	function scan.next(by_group)
		found = current_scan.next(by_group)
		if not found and current_scan == scan1 then
			current_scan = scan2
			found = current_scan.next(by_group)
		end
		return found
	end
	function scan.found()
		return found
	end
	if output1 and output2 then
		local names1, names2 = scan1.out_cols, scan2.out_cols
		assert(#names1 == #names2)
		for i, name in ipairs(names1) do assert(name == names2[i]) end
		local colls = {}
		for _, name in ipairs(names1) do
			local _, coll1 = scan1:col_decoder(name)
			local _, coll2 = scan2:col_decoder(name)
			assertf(coll1 == coll2,
				'union: collation differs on output col: %s', name)
			colls[name] = coll1
		end
		local get1, get2 = scan1.get, scan2.get
		scan.out_cols = names1
		scan.out_specs = same_out_specs(scan1, scan2)
		scan.rows = scan1.rows
		scan.rows_array = scan1.rows_array
		scan.first = scan1.first
		scan.one = scan1.one
		scan.must_one = scan1.must_one
		--scan.get delegates to the inputs, so the sentinel goes to both.
		function scan:null_value(v)
			scan1:null_value(v)
			scan2:null_value(v)
			return self
		end
		local function return_scan(_, ...)
			return scan, ...
		end
		function scan.get(out_row)
			local get = current_scan == scan1 and get1 or get2
			if out_row then
				get(out_row)
				return scan, out_row
			end
			return return_scan(get())
		end
		function scan:col_decoder(name, comparison)
			local get1 = scan1:col_decoder(name, comparison)
			local get2 = scan2:col_decoder(name, comparison)
			return function()
				if current_scan == scan1 then
					return get1()
				else
					return get2()
				end
			end, colls[name]
		end
	elseif not output1 and not output2 then
		scan.member_scans = scan1.member_scans
		scan.can_next_group = scan1.can_next_group and scan2.can_next_group
		function scan.next_in_group()
			found = current_scan.next_in_group()
			return found
		end
		function scan.next_group()
			return scan.next(true)
		end
		function scan:col_decoder(member, col, folded)
			local get1, coll = scan1:col_decoder(member, col, folded)
			local get2 = scan2:col_decoder(member, col, folded)
			return function()
				if current_scan == scan1 then
					return get1()
				else
					return get2()
				end
			end, coll
		end
	end
	function scan.explain()
		return {kind = 'union', scan1.explain(), scan2.explain()}
	end
	function scan.close()
		scan2.close()
		scan1.close()
	end
	return scan
end

--MERGE UNION ----------------------------------------------------------------

--unlike Scan:union(), advances both inputs together and yields once when
--they're at the same MDBX entry, so overlapping inputs -- e.g. the same row
--reachable through two different seeks -- come out once, not twice. both
--inputs must scan the same table in the same direction.
--compose for more than two: scan1:merge_union(scan2):merge_union(scan3)...
function Scan:merge_union(scan2)
	local scan1 = self
	assert(scan1.table and scan1.table == scan2.table)
	assert(scan1.reverse == scan2.reverse)
	assert(scan1.is_index == scan2.is_index)
	local reverse = scan1.reverse
	local scan = object(Scan)
	scan.db = scan1.db
	scan.member_scans = scan1.member_scans
	scan.can_next_group = scan1.can_next_group and scan2.can_next_group
	local has1, has2, adv1, adv2, current_scan, found

	--publish the winning MDBX position for a further chained merge_union().
	scan.table = scan1.table
	scan.base_table = scan1.base_table
	scan.reverse = reverse
	scan.is_index = scan1.is_index

	function scan.reset(args)
		scan.args = args
		scan1.reset(args)
		scan2.reset(args)
		has1, has2, found = false, false, false
		adv1, adv2 = true, true
	end
	function scan.next(by_group)
		if adv1 then has1 = scan1.next(by_group) end
		if adv2 then has2 = scan2.next(by_group) end
		if not has1 and not has2 then found = false; return end
		local cmp
		if has1 and has2 then
			cmp = C.schema_key_cmp_rec(scan1.key_rec, scan2.key_rec)
			if cmp == 0 and scan.is_index then
				cmp = C.schema_key_cmp_rec(scan1.val_rec, scan2.val_rec)
			end
			if reverse then cmp = -cmp end
		end
		if has1 and (not has2 or cmp <= 0) then
			current_scan = scan1
			adv1, adv2 = true, has2 and cmp == 0
		else
			current_scan = scan2
			adv1, adv2 = false, true
		end
		scan.key_rec = current_scan.key_rec
		scan.val_rec = current_scan.val_rec
		found = true
		return true
	end
	function scan.next_in_group()
		return current_scan.next_in_group()
	end
	function scan.next_group()
		return scan.next(true)
	end
	function scan.found()
		return found
	end
	function scan:col_decoder(member, col, folded)
		local get1, coll = scan1:col_decoder(member, col, folded)
		local get2 = scan2:col_decoder(member, col, folded)
		return function()
			if current_scan == scan1 then return get1() else return get2() end
		end, coll
	end
	function scan.explain()
		return {kind = 'merge_union', scan1.explain(), scan2.explain()}
	end
	function scan.close()
		scan2.close()
		scan1.close()
	end
	return scan
end

--SET OPERATIONS -------------------------------------------------------------

--DB null becomes the null sentinel because a key is a table key here.
local function hash_key(getters, n, scratch, space)
	for i = 1, n do
		local v = getters[i](); scratch[i] = v == nil and null or v
	end
	if n == 1 then return scratch[1] end
	return space(unpack(scratch, 1, n))
end

local function set_filter(scan1, scan2, keep_matched, what)
	local names = scan1.out_cols
	assertf(names and scan2.out_cols,
		'%s: select()/aggregate() required first', what)
	local n = #names
	assertf(n == #scan2.out_cols, '%s: inputs must return the same cols', what)
	local get1, get2 = {}, {}
	for i, name in ipairs(names) do
		assertf(name == scan2.out_cols[i],
			'%s: inputs must return the same cols', what)
		local g1, coll1 = scan1:col_decoder(name, true)
		local g2, coll2 = scan2:col_decoder(name, true)
		assertf(coll1 == coll2,
			'%s: collation differs on out col: %s', what, name)
		get1[i], get2[i] = g1, g2
	end

	local scan = scan1
	local next_row = scan.next
	local tuple_space, other, seen
	--key is scratch, read into a set key immediately and never retained.
	local key = {}
	scan.next = function()
		if not other then
			tuple_space = n > 1 and tuples() or nil
			other, seen = {}, {}
			scan2.reset(scan.args)
			while scan2.next() do
				other[hash_key(get2, n, key, tuple_space)] = true
			end
			scan2.close()
		end
		while next_row() do
			local k = hash_key(get1, n, key, tuple_space)
			if not seen[k] and (other[k] ~= nil) == keep_matched then
				seen[k] = true
				return true
			end
		end
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		tuple_space, other, seen = nil, nil, nil
	end
	local close = scan.close
	scan.close = function()
		scan2.close()
		close()
	end
	return scan
end

function Scan:intersect(scan2)
	return set_filter(self, scan2, true, 'intersect')
end
function Scan:except(scan2)
	return set_filter(self, scan2, false, 'except')
end

--NESTED JOIN ----------------------------------------------------------------

local function inner_scan(outer, spec)
	local db = outer.db
	local table_spec, cols_spec, member, member_cols_spec = spec:match
		'^%s*(.-)%s*%.%s*(.-)%s*=%s*(.-)%s*%.%s*(.-)%s*$'
	assertf(table_spec and cols_spec ~= '' and member ~= ''
		and member_cols_spec ~= '', 'join: %s: invalid spec', spec)
	local tbl, alias = table_spec:match'^(.-)%s*@%s*(.*)$'
	if not tbl then tbl = table_spec end
	local schema = assertf(db:table_schema(tbl), 'join: %s: no table: %s',
		spec, tbl)
	local member_scan = assertf((outer.member_scans or empty)[member],
		'join: %s: no member: %s', spec, member)
	local cols, member_cols = {}, {}
	for col in cols_spec:gmatch'[^,]+' do add(cols, col:trim()) end
	for col in member_cols_spec:gmatch'[^,]+' do
		add(member_cols, col:trim())
	end
	assertf(#cols == #member_cols, 'join: %s: invalid', spec)
	--check the col names here so the error can quote the spec.
	--scan() also rejects an unknown col, but much later, from inside
	--a param read, and its message does not include the spec.
	local base = schema.val_schema or schema
	for _, col in ipairs(cols) do
		assertf(base.fields[col], 'join: %s: no col: %s.%s', spec, tbl, col)
	end
	local member_schema = db:table_schema(member_scan.table)
	local member_base = member_schema.val_schema or member_schema
	for _, col in ipairs(member_cols) do
		assertf(member_schema.fields[col] or member_base.fields[col],
			'join: %s: no col: %s.%s', spec, member, col)
	end
	local function starts_with_cols(key)
		if #key.key_fields < #cols then return false end
		for j, col in ipairs(cols) do
			if key.key_fields[j].col ~= col then return false end
		end
		return true
	end
	local key_schema
	if schema.is_index then
		assertf(starts_with_cols(schema), 'join: %s: %s does not start with %s',
			spec, schema.name, cat(cols, ','))
		key_schema = schema
	else
		--fewest key cols wins: that is the tightest seek, and an exact key
		--beats a longer one that merely starts with cols.
		for i = 0, #(schema.indexes or empty) do
			local cand = i == 0 and schema or schema.indexes[i]
			if starts_with_cols(cand)
				and (not key_schema
					or #cand.key_fields < #key_schema.key_fields)
			then
				key_schema = cand
			end
		end
		assertf(key_schema, 'join: %s: no key on %s(%s)', spec, tbl,
			cat(cols, ','))
	end
	local path = {}
	for i, col in ipairs(cols) do
		path[i] = {col, '=', {scan = member_scan, col = member_cols[i]}}
	end
	return db:scan(key_schema.name, path, alias)
end

--join.next() advances inner under the current outer row, then moves to
--the next outer row once inner is exhausted.
local function join_scan(outer, inner, left, accept)
	if isstr(inner) then inner = inner_scan(outer, inner) end
	local join = object(Scan)
	join.db = outer.db
	--col_decoder() resolves a member against outer first, so a duplicate
	--would read the outer one and never say so.
	join.member_scans = {}
	for _, side in ipairs{outer, inner} do
		for member, scan in pairs(side.member_scans or empty) do
			assertf(not join.member_scans[member],
				'join: duplicate member: %s', member)
			join.member_scans[member] = scan
		end
	end
	local outer_found, inner_found = outer.found, inner.found
	local next_inner = inner.next
	if accept then
		local next_row = next_inner
		--next_inner() skips rows that do not match the join condition.
		next_inner = function()
			while next_row() do
				if accept(join) then return true end
			end
		end
	end
	local in_inner, args
	function join.next()
		if in_inner then
			if next_inner() then return true end
			in_inner = nil
		end
		while outer.next() do
			inner.reset(args)
			if next_inner() then
				in_inner = true
				return true
			end
			if left then return true end
		end
	end
	function join.reset(reset_args)
		args = reset_args
		join.args = reset_args
		outer.reset(reset_args)
		in_inner = nil
	end
	join.found = left and outer_found or function()
		return outer_found() and inner_found()
	end
	function join:col_decoder(member, col, folded)
		if outer.member_scans[member] then
			return outer:col_decoder(member, col, folded)
		end
		local get, coll = inner:col_decoder(member, col, folded)
		return function()
			if not inner_found() then return nil end
			return get()
		end, coll
	end
	function join.explain()
		return {kind = left and 'left_join' or 'join',
			outer.explain(), inner.explain()}
	end
	function join.close()
		inner.close()
		outer.close()
	end
	return join
end

function Scan:join(inner, accept)
	return join_scan(self, inner, nil, accept)
end
function Scan:left_join(inner, accept)
	return join_scan(self, inner, true, accept)
end

--when parent has no row, reset(), next(), col_decoder() must be no-ops
--to avoid reading the current row from the parent through the scan params.
--keep the rows that have at least one matching child row, or the rows
--that have none. no member and no col is added: the child is read only to
--answer whether it has a row, and the scan closes it.
local function has_filter(parent, child, want)
	child = parent:child_scan(child)
	parent:filter(function()
		return child:exists(parent.args) == want
	end)
	local close = parent.close
	function parent.close()
		child.close()
		close()
	end
	return parent
end

function Scan:where_has(child)
	return has_filter(self, child, true)
end

function Scan:where_hasnt(child)
	return has_filter(self, child, false)
end

function Scan:child_scan(child)
	local parent = self
	if isstr(child) then child = inner_scan(parent, child) end
	local reset, next_row, found = child.reset, child.next, child.found
	function child.reset(args)
		if parent.found() then reset(args) end
	end
	function child.next(by_group)
		return parent.found() and next_row(by_group)
	end
	function child.found()
		return parent.found() and found()
	end
	local decode = child.col_decoder
	function child:col_decoder(member, col, folded)
		local get, coll = decode(child, member, col, folded)
		return function()
			if not child.found() then return nil end
			return get()
		end, coll
	end
	return child
end

--SELECT ---------------------------------------------------------------------

local function materialized_get(scan, row, out_row)
	local out_cols = scan.out_cols
	if out_row then
		for _, name in ipairs(out_cols) do
			out_row[name] = row[name]
		end
		return scan, out_row
	end
	local n = #out_cols
	local values = {}
	for i = 1, n do values[i] = row[out_cols[i]] end
	return scan, unpack(values, 1, n)
end

local function serve_row(scan)
	local row
	local col_decoder = scan.col_decoder
	function scan.get(out_row)
		return materialized_get(scan, row, out_row)
	end
	function scan:col_decoder(name, comparison)
		local _, coll = col_decoder(scan, name)
		if comparison and coll then
			return function() return coll.key(row[name]) end, coll
		end
		return function() return row[name] end, coll
	end
	return function(r) row = r end
end

local function output_row(scan, row, shape)
	if shape == nil then return unpack(row, 1, #scan.out_cols) end
	return row
end

local function parse_row_args(shape, args)
	if type(shape) == 'table' then
		assert(args == nil, 'row shape must be the first argument')
		return nil, shape
	end
	assert(shape == nil or shape == '[]' or shape == '{}',
		"row shape must be '[]' or '{}'")
	return shape, args
end

--yields one row (a table) per call, closing the scan on exhaustion.
local function raw_rows(scan, shape, args)
	local out_cols = scan.out_cols
	local n = #out_cols
	local scratch = shape ~= '{}' and {}
	scan.reset(args)
	local done = false
	return function()
		if done then return end
		if not scan.next() then done = true; scan.close(); return end
		if shape == '{}' then
			local _, row = scan.get{}
			return row
		end
		scan.get(scratch)
		local row = {}
		for i = 1, n do row[i] = scratch[out_cols[i]] end
		return row
	end
end

--stores up to cap rows and closes the scan.
local function collect_output_rows(scan, shape, args, cap)
	local next_row = raw_rows(scan, shape, args)
	local rows = {}
	while not cap or #rows < cap do
		local row = next_row()
		if not row then break end
		rows[#rows + 1] = row
	end
	scan.close()
	return rows
end

local function output_rows(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local next_row = raw_rows(scan, shape, args)
	return function()
		local row = next_row()
		if row then return scan, output_row(scan, row, shape) end
	end, scan
end

local function output_rows_array(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	return collect_output_rows(scan, shape, args)
end

local function output_first(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local rows = collect_output_rows(scan, shape, args, 1)
	if rows[1] then return output_row(scan, rows[1], shape) end
end

local function output_one(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local rows = collect_output_rows(scan, shape, args, 2)
	assert(#rows <= 1, 'one() matched more than one row')
	if rows[1] then return output_row(scan, rows[1], shape) end
end

local function output_must_one(scan, shape, args)
	shape, args = parse_row_args(shape, args)
	local rows = collect_output_rows(scan, shape, args, 2)
	assert(#rows > 0, 'must_one(): no rows, expected exactly one')
	assert(#rows == 1, 'must_one(): multiple rows, expected exactly one')
	return output_row(scan, rows[1], shape)
end

--a wrapped scan has no table, so its cols read through to the child's.
local function member_col_src(member_scan, col) -- -> {table=, col=}
	if member_scan.base_table then
		return {table = member_scan.base_table, col = col}
	end
	local child = member_scan.child
	local spec = child and (child.out_specs or empty)[col]
	if spec and spec.table then
		return {table = spec.table, col = spec.col}
	end
end

local function install_get(scan, names, read_value, out_specs)
	local n = #names
	local values = {}
	local null_v --value for a null col; nil leaves the col out of the row
	local function get(out_row)
		if out_row then
			for i = 1, n do
				local v = read_value(i)
				if v == nil then v = null_v end
				out_row[names[i]] = v
			end
			return scan, out_row
		else
			for i = 1, n do
				local v = read_value(i)
				if v == nil then v = null_v end
				values[i] = v
			end
			return scan, unpack(values, 1, n)
		end
	end
	function scan:null_value(v)
		null_v = v
		return self
	end
	scan.out_cols = names
	scan.out_specs = out_specs
	scan.get = get
	scan.rows = output_rows
	scan.rows_array = output_rows_array
	scan.first = output_first
	scan.one = output_one
	scan.must_one = output_must_one
end

--outputs: {{name = NAME, member = MEMBER, col = COL},...}
function Scan:select(outputs)
	local scan = self
	assert(not scan.get)

	local members, cols, names = col_specs(self, outputs, 'select')
	local decoders, colls, out_specs = {}, {}, {}
	for i, member in ipairs(members) do
		decoders[i], colls[i] = self:col_decoder(member, cols[i])
		local src = member_col_src(scan.member_scans[member], cols[i])
		out_specs[names[i]] = {i = i, member = member,
			col = src and src.col, table = src and src.table}
	end

	local col_decoder = scan.col_decoder
	function scan:col_decoder(member, col, folded)
		if isstr(col) then return col_decoder(scan, member, col, folded) end
		local name, comparison = member, col
		local spec = assertf(out_specs[name],
			'col_decoder: unknown output col: %s', tostring(name))
		if comparison then
			return col_decoder(scan, spec.member, spec.col, true)
		end
		return decoders[spec.i], colls[spec.i]
	end

	install_get(scan, names, function(i) return decoders[i]() end, out_specs)
	return scan
end

--unlike filter(), which skips a rejected row and keeps looking, next()
--must stop outright once limit rows are yielded -- looking further would run
--the underlying scan to exhaustion for a match that will never come.
function Scan:limit(limit, offset)
	local scan = self
	local next_row, reset = scan.next, scan.reset
	local limit_arg = type(limit) == 'table' and limit.arg
	local offset_arg = type(offset) == 'table' and offset.arg
	local skipped, count
	scan.reset = function(args)
		if limit_arg then
			assertf(args and args[limit_arg] ~= nil, 'missing arg: %s', limit_arg)
			limit = args[limit_arg]
		end
		if offset_arg then
			assertf(args and args[offset_arg] ~= nil, 'missing arg: %s', offset_arg)
			offset = args[offset_arg]
		else
			offset = offset or 0
		end
		skipped, count = 0, 0
		reset(args)
	end
	self.next = function(by_group)
		if count >= limit then return end
		while skipped < offset do
			if not next_row(by_group) then return end
			skipped = skipped + 1
		end
		if not next_row(by_group) then return end
		count = count + 1
		return true
	end
	return scan
end

--SORT -----------------------------------------------------------------------

--[[
sorts a value-record scan (the output of select()/aggregate()) by spec
-- a list of {member=,col=} or {field=} entries (each optionally desc=),
or a plain comparator fn(row_a, row_b). Materializes every row on first
next() (there's no way to know the right order without seeing them
all), sorts once, then serves rows one at a time. null sorts before
non-null ascending, after descending. sort() does not keep input order
among rows whose keys all compare equal: their order is unspecified.

Only the value-record path from the old node system's value_sort is
ported here: query2's compile_terminal always runs select()/aggregate()
before value_sort, so its raw-pk-stream branch (buffer pk bytes, re-seek
a fresh cursor per row to replay) is dead code from that call site and
isn't needed.

scan.get() publishes the row table itself. scan.get(out_row) assigns every
name in scan.out_cols, including nil.

NOTE: Sort result is unstable!
]]
function Scan:sort(spec)
	local scan = self
	local get = scan.get
	assert(get, 'sort: select()/aggregate() required first')

	--[[
	every term reads the comparison form, so sorting matches the
	collation. a {member=,col=} term names a source col, which works even
	when col differs from that field's select()-assigned output name (an
	alias, or a column order_by() reads without select()ing it). a
	{field=}/{col=} term names an output col, which is the only form
	available after aggregate().
	]]
	local getters, ncols
	if type(spec) ~= 'function' then
		ncols = #spec
		getters = {}
		for i, p in ipairs(spec) do
			if p.member then
				getters[i] = self:col_decoder(p.member, p.col, true)
			else
				getters[i] = self:col_decoder(p.col or p.field, true)
			end
		end
	end

	--sorts a permutation of row positions instead of the rows
	--themselves: rows is the actual output (needed regardless of
	--sorting), order is the only thing sort() rearranges, so there's no
	--per-row wrapper table pairing a row with anything. key values for
	--every row live in one flat array (stride ncols) instead of one
	--small table per row.
	local set_row = serve_row(scan)
	local rows, keys, order, idx, found
	local next_row = scan.next
	scan.next = function()
		if not order then
			rows, keys = {}, {}
			while next_row() do
				local _, row = get{}
				local i = #rows + 1
				rows[i] = row
				if getters then
					local base = (i - 1) * ncols
					for k = 1, ncols do
						keys[base + k] = getters[k]()
					end
				end
			end
			order = {}
			for i = 1, #rows do order[i] = i end
			if not getters then
				sort(order, function(i, j) return spec(rows[i], rows[j]) end)
			else
				sort(order, function(i, j)
					local ai, bi = (i - 1) * ncols, (j - 1) * ncols
					for k = 1, ncols do
						local av, bv = keys[ai + k], keys[bi + k]
						if av ~= bv then
							local p = spec[k]
							local a_null = av == nil
							local b_null = bv == nil
							if a_null ~= b_null then
								return p.desc and b_null or not p.desc and a_null
							end
							return p.desc and av > bv or not p.desc and av < bv
						end
					end
					return false
				end)
			end
			idx = 0
		end
		idx = idx + 1
		if order[idx] == nil then found = nil; return end
		set_row(rows[order[idx]])
		found = true
		return true
	end
	function scan.found()
		return found
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		rows, keys, order, idx, found = nil, nil, nil, nil, nil
	end
	scan.materialized = true
	return scan
end

--GROUP BY -------------------------------------------------------------------

--cols: {{member = MEMBER, col = COL},...}
--requires the scan already be sorted by cols!
--next() iterates groups; next_in_group() iterates pks in current group.
function Scan:group_by(cols)
	local next_row = self.next
	local by_group = self.can_next_group
	local ncols = #cols
	local getters = {}
	for i, c in ipairs(cols) do
		getters[i] = self:col_decoder(c.member, c.col, true)
	end
	local prev, done, has_current, has_prev, peeked
	local function same_key()
		for i = 1, ncols do
			if prev[i] ~= getters[i]() then return false end
		end
		return true
	end
	local function set_key()
		for i = 1, ncols do
			prev[i] = getters[i]()
		end
	end
	local function adv(bg)
		if done then return false end
		if not next_row(bg) then done = true; return false end
		return true
	end
	self.next = function()
		has_current = false
		if done then return end
		if not peeked then
			if not adv() then return end
			if has_prev then
				while same_key() do
					if not adv(by_group) then return end
				end
			end
		end
		peeked = false
		set_key(); has_prev = true
		has_current = true
		return true
	end
	function self.next_in_group()
		if not has_current then return end
		if not adv() then has_current = false; return end
		if same_key() then return true end
		peeked = true; has_current = false; return nil
	end
	function self.found()
		return has_current or nil
	end
	local reset = self.reset
	self.reset = function(args)
		reset(args)
		prev = {}
		done = false; has_current = false; has_prev = false; peeked = false
	end
	return self
end

local function agg_step(acc, a, key, v, coll)
	local name = a.name
	if a.op == 'key' then
		acc[name] = key and key[a.part]
	elseif v ~= nil then
		if a.op == 'count' then
			acc[name] = acc[name] + 1
		elseif a.op == 'sum' then
			acc[name] = (acc[name] or 0) + v
		elseif a.op == 'avg' then
			acc[name].sum = acc[name].sum + v
			acc[name].n   = acc[name].n   + 1
		elseif a.op == 'concat' then
			add(acc[name], v)
		elseif a.op == 'min' then
			if coll then
				local k = coll.key(v)
				local won = acc[name]
				if won == nil then
					acc[name] = {value = v, key = k}
				elseif k < won.key then
					won.value, won.key = v, k
				end
			elseif acc[name] == nil or v < acc[name] then
				acc[name] = v
			end
		elseif a.op == 'max' then
			if coll then
				local k = coll.key(v)
				local won = acc[name]
				if won == nil then
					acc[name] = {value = v, key = k}
				elseif k > won.key then
					won.value, won.key = v, k
				end
			elseif acc[name] == nil or v > acc[name] then
				acc[name] = v
			end
		end
	end
end
local function agg_init(agg)
	local acc = {}
	for _, a in ipairs(agg) do
		if a.op == 'count' then acc[a.name] = 0
		elseif a.op == 'avg' then acc[a.name] = {sum = 0, n = 0}
		elseif a.op == 'concat' then acc[a.name] = {}
		else acc[a.name] = nil
		end
	end
	return acc
end
local function agg_finalize(agg, acc, colls)
	local rec = {}
	for _, a in ipairs(agg) do
		if a.op == 'avg' then
			local s = acc[a.name]
			rec[a.name] = s.n > 0 and s.sum / s.n or nil
		elseif a.op == 'concat' then
			local values = acc[a.name]
			rec[a.name] = #values > 0 and cat(values, a.separator) or nil
		elseif colls[a.name] and (a.op == 'min' or a.op == 'max') then
			local won = acc[a.name]
			if won == nil then rec[a.name] = nil else rec[a.name] = won.value end
		else
			rec[a.name] = acc[a.name]
		end
	end
	return rec
end

--[[
scan:aggregate(agg) -> scan
scan:aggregate(agg, cols[, hash]) -> scan

	agg = {{name=NAME, op=OP[, member=MEMBER, col=COL][, part=N]
		[, separator=STRING]}, ...}
	OP = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'concat' | 'key'
	cols = {{member=MEMBER, col=COL}, ...}

aggregate(agg) emits one grand-total record. aggregate(agg, cols) expects
group_by(cols) on the same scan and emits consecutive groups.
aggregate(agg, cols, true) accepts any input order and emits groups in
first-occurrence order. with no {op='concat'}, aggregate(agg, cols) uses O(1)
memory and aggregate(agg, cols, true) uses O(n groups) memory.
with {op='concat'}, retains every non-nil member.col until it emits.
aggregate(agg) and aggregate(agg, cols, true) retain all such values;
aggregate(agg, cols) retains only values for the current group.

aggregate() emits one record per next(). scan.row contains that record so
the caller can read every field without copying it through get().
]]
function Scan:aggregate(agg, cols, hash)
	local scan = self

	local function col_reader(c, comparison)
		if c.member then
			return self:col_decoder(c.member, c.col, comparison)
		end
		return self:col_decoder(c.col, comparison)
	end

	local getters, names, colls = {}, {}, {}
	for i, a in ipairs(agg) do
		names[i] = a.name
		if a.op ~= 'key' and (a.member or a.col) then
			local get, col_coll = col_reader(a)
			getters[a.name] = get
			if a.op == 'min' or a.op == 'max' then
				colls[a.name] = col_coll
			end
		end
	end
	--bucket_getters (comparison form) only exists for the hashed path,
	--which needs to bucket by a collated key while still emitting the
	--display (unfolded) value through key/op='key' -- streamed grouping
	--already gets its own comparison from group_by()'s same_key().
	local key_getters, bucket_getters, nkeys
	if cols then
		key_getters = {}
		if hash then bucket_getters = {} end
		local key_colls = {}
		for i, c in ipairs(cols) do
			key_getters[i], key_colls[i] = col_reader(c)
			if hash then bucket_getters[i] = col_reader(c, true) end
		end
		for _, a in ipairs(agg) do
			if a.op == 'key' then colls[a.name] = key_colls[a.part] end
		end
		nkeys = #key_getters
	end
	local function accumulate(acc, key)
		for _, a in ipairs(agg) do
			local v
			if a.op == 'count' then
				if a.member or a.col then
					v = getters[a.name]()
				else
					v = true
				end
			elseif a.op ~= 'key' then
				v = getters[a.name]()
			end
			agg_step(acc, a, key, v, colls[a.name])
		end
	end
	--key is scratch, reused across calls: agg_step()/the bucket-key
	--lookup both read it immediately and never retain it past that.
	local key = {}
	local function read_key()
		for i = 1, nkeys do
			key[i] = key_getters[i]()
		end
		return key
	end
	local bucket = bucket_getters and {}

	local done, output, group_i, found
	local next_row = scan.next
	if not cols then
		scan.next = function()
			if done then found = nil; return end
			done = true
			local acc = agg_init(agg)
			while next_row() do accumulate(acc, nil) end
			scan.row = agg_finalize(agg, acc, colls)
			found = true
			return true
		end
	elseif hash then
		scan.next = function()
			if not output then
				local tuple_space = nkeys > 1 and tuples() or nil
				local buckets, order = {}, {}
				while next_row() do
					local key = read_key()
					local t = hash_key(bucket_getters, nkeys, bucket,
						tuple_space)
					local acc = buckets[t]
					if not acc then
						acc = agg_init(agg)
						buckets[t] = acc
						order[#order + 1] = acc
					end
					accumulate(acc, key)
				end
				output = {}
				for i, acc in ipairs(order) do
					output[i] = agg_finalize(agg, acc, colls)
				end
				group_i = 0
			end
			group_i = group_i + 1
			scan.row = output[group_i]
			if scan.row == nil then found = nil; return end
			found = true
			return true
		end
	else
		scan.next = function()
			if not next_row() then found = nil; return end
			local key = read_key()
			local acc = agg_init(agg)
			accumulate(acc, key)
			while scan.next_in_group() do accumulate(acc, key) end
			scan.row = agg_finalize(agg, acc, colls)
			found = true
			return true
		end
	end
	function scan.found()
		return found
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		done, output, group_i, found = false, nil, nil, nil
	end
	--the grand-total and hashed paths drain the input before emitting;
	--the streamed one emits a group as it reaches it.
	scan.materialized = not cols or hash

	--after aggregate(), col_decoder() only reaches agg's named outputs.
	local out_name = {}
	for _, name in ipairs(names) do out_name[name] = true end
	function scan:col_decoder(name, comparison)
		assertf(out_name[name], 'col_decoder: unknown output col: %s',
			tostring(name))
		local coll = colls[name]
		if comparison and coll then
			return function()
				return coll.key(scan.row[name])
			end, coll
		end
		return function() return scan.row[name] end, coll
	end

	local up_specs = scan.out_specs or empty --upstream: install_get replaces it
	local out_specs = {}
	for i, a in ipairs(agg) do
		--a key output reads the group_by col that its part indexes.
		local c = a.op == 'key' and cols and cols[a.part] or a
		local src
		if c and c.col then
			src = c.member
				and member_col_src(scan.member_scans[c.member], c.col)
				or not c.member and up_specs[c.col] --names an upstream output
		end
		out_specs[a.name] = {op = a.op,
			table = src and src.table, col = src and src.col}
	end

	install_get(scan, names, function(i) return scan.row[names[i]] end, out_specs)
	return scan
end

--DISTINCT -------------------------------------------------------------------

--[[
distinct(cols) calls group_by(cols) and keeps the first row of every
consecutive key. distinct(cols, true) accepts any input order, keeps the first
row of every key, and emits those rows in input order. distinct() keeps every
selected or aggregated field.
]]
function Scan:distinct(cols, hash)
	if not hash then
		return self:group_by(cols)
	end
	local scan = self
	assert(scan.get, 'distinct: select()/aggregate() required first')

	--key is comparison-only here (the kept row comes from get() below,
	--not from key), so the collated form covers it with no extra getter.
	local key_getters = {}
	for i, c in ipairs(cols) do
		key_getters[i] = self:col_decoder(c.name, true)
	end
	local nkeys = #key_getters
	--key is scratch, reused across calls: agg_step()/the bucket-key
	--lookup both read it immediately and never retain it past that.
	local key = {}

	local row, output, row_i, found
	local next_row, get = scan.next, scan.get
	local set_row = serve_row(scan)
	scan.next = function()
		if not output then
			local tuple_space = nkeys > 1 and tuples() or nil
			local seen = {}
			output = {}
			while next_row() do
				local t = hash_key(key_getters, nkeys, key, tuple_space)
				if not seen[t] then
					seen[t] = true
					local _, kept_row = get{}
					output[#output + 1] = kept_row
				end
			end
			row_i = 0
		end
		row_i = row_i + 1
		row = output[row_i]
		if row == nil then found = nil; return end
		set_row(row)
		found = true
		return true
	end
	function scan.found()
		return found
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		output, row_i, found = nil, nil, nil
	end
	scan.materialized = true
	return scan
end

--FOR UPDATE ----------------------------------------------------------------

--[[
for_update() drains the scan and closes it before serving a single row,
so the caller can write while iterating: a scan that still has rows to
produce can skip or revisit them once its table is written to, and that
shows up as a wrong answer, not an error. a no-op on a scan that already
keeps its rows. call it last -- anything added after it reads a scan that
has already been closed.
]]
function Scan:for_update()
	local scan = self
	assert(scan.get, 'for_update: select()/aggregate() required first')
	if scan.materialized then return scan end
	local next_row, get, close = scan.next, scan.get, scan.close
	local set_row = serve_row(scan)
	local rows, row, row_i, found
	scan.next = function()
		if not rows then
			rows = {}
			while next_row() do
				local _, r = get{}
				rows[#rows + 1] = r
			end
			close()
			row_i = 0
		end
		row_i = row_i + 1
		row = rows[row_i]
		if row == nil then found = nil; return end
		set_row(row)
		found = true
		return true
	end
	function scan.found()
		return found
	end
	local reset = scan.reset
	scan.reset = function(args)
		reset(args)
		rows, row, row_i, found = nil, nil, nil, nil
	end
	scan.materialized = true
	return scan
end

--MEMBER SCAN ----------------------------------------------------------------

local function member_scan(child, alias, what)
	assertf(child.get, '%s: select()/aggregate() required first', what)
	local scan = object(Scan)
	scan.db = child.db
	scan.member_scans = {[alias] = scan}
	scan.child = child
	function scan.explain()
		return {kind = 'rel', member = alias, child.explain()}
	end
	return scan
end

function Scan:materialized_scan(alias)
	local child = self
	local scan = member_scan(child, alias, 'materialized_scan')
	local next_row, get = child.next, child.get
	local rows, row, row_i, found
	function scan.reset(args)
		scan.args = args
		if not rows then
			child.reset(args)
			rows = {}
			while next_row() do
				local _, r = get{}
				rows[#rows + 1] = r
			end
		end
		row, row_i, found = nil, 0, nil
	end
	function scan.next()
		row_i = row_i + 1
		row = rows[row_i]
		if row == nil then found = nil; return end
		found = true
		return true
	end
	function scan.found()
		return found
	end
	function scan.close()
		rows = nil
		child.close()
	end
	scan.materialized = true
	function scan:col_decoder(member, col, folded)
		assertf(member == alias, 'col_decoder: unknown member: %s',
			tostring(member))
		local _, coll = child:col_decoder(col)
		if folded and coll then
			return function() return coll.key(row[col]) end, coll
		end
		return function() return row[col] end, coll
	end
	return scan
end

function Scan:streamed_scan(alias)
	local child = self
	local scan = member_scan(child, alias, 'streamed_scan')
	function scan.reset(args)
		scan.args = args
		child.reset(args)
	end
	scan.next = child.next
	scan.found = child.found
	scan.close = child.close
	function scan:col_decoder(member, col, folded)
		assertf(member == alias, 'col_decoder: unknown member: %s',
			tostring(member))
		return child:col_decoder(col, folded)
	end
	return scan
end

--COLLATION ------------------------------------------------------------------

function Db:collate(tbl, col, v)
	local schema = assert(self:table_schema(tbl))
	local base_schema = schema.val_schema or schema
	local field = assertf(base_schema.fields[col] or schema.fields[col],
		'collate: no col: %s.%s', tbl, col)
	local coll = field.collator
	return coll and coll.key(v) or v
end

--VALUES SCAN ----------------------------------------------------------------

function Db:values_scan(values)
	local scan = object(Scan)
	scan.db = self
	scan.member_scans = {}
	local arg = values.arg
	local list, value_i

	function scan.reset(args)
		scan.args = args
		list = values
		if arg then
			list = args and args[arg]
			assertf(list, 'values_scan: missing arg: %s', arg)
		end
		value_i = 0
	end
	function scan.next()
		value_i = value_i + 1
		return value_i <= #list or nil
	end
	function scan.found()
		return list and value_i >= 1 and value_i <= #list or nil
	end
	function scan.get()
		return list[value_i]
	end
	function scan.explain()
		return {kind = 'values'}
	end

	local function next_row()
		if scan.next() then return scan end
	end
	function scan.rows(self, args)
		self.reset(args)
		return next_row
	end
	function scan.close() end

	return scan
end
