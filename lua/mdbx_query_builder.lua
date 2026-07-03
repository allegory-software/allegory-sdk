--[[

	mdbx query builder: convert a query spec to a runnable node-based query plan.
	Written by Cosmin Apreutesei. Public Domain.

JOIN
	db:from('TABLE [ALIAS]') -> q  make a query
	:join('TABLE [ALIAS]', [opt])  join on FK from an existing member
		from  = member              which member to join from; inferred when unambiguous
		on    = fk_name             'COL1,COL2...'; for when > 1 FK to same table
		left  = true                left join (default is inner)
		as    = alias               another way to give alias
	:inner_join(...)               same as :join
	:left_join(...)                left join (child->parent only)
	:nested_join(fn)               nested-loop join; fn(outer) -> query
	outer                       outer('MEMBER.COL', ...) -> {val1,...}
ORDER / LIMIT / DISTINCT
	:order_by(col, ...)            query col or 'col desc'; free if index order, else sort
	:limit(n) / :offset(n)         early stop when index order already satisfied
	:distinct(cols)                streaming dedup if input ordered, else hash pass
FILTERS
	:between(col, lo, hi)          range
	:where(col [,op], val)         op: ==, ~=, <, <=, >, >=
	:is_null(col)                  uses index
	:is_not_null(col)              uses index
	:starts(col, prefix)           prefix match; uses index
	:in_(col, values|query)        set or subquery filter (in is a Lua keyword)
	:not_in(col, values|query)     negated :in_
	:where_exists(query|fn)        keep row if subquery returns any result
	:where_not_exists(query|fn)    keep row if subquery returns no result
	:where_has(table [,fn])        keep row if FK to table exists
	:where_hasnt(table [,fn])      keep row if FK to table is absent
	:or_where(col [,op], val)      OR (AND binds tighter)
	:filter(fn)                    Lua fn; never uses index
	mdbx_outer(ref)                ref = 'alias.col'; pins a col from the outer query
GROUP / AGGREGATE
	:group_by(cols)                group rows; use with :agg{...} for aggregates
	:agg{name=,op=[,member=]...}   aggregate spec; without :group_by -> grand total
	:having(out_col [,op], val)    post-group filter; out_col is output name, not member.col
PROJECTION
	:select(outputs)               'member.col', 'member.col alias', or {name=, fn=}
	:agg{...} -> value stream
UNION
	db:union([mode,] q, ...)       mode: 'distinct' (default) or 'all'
	db:union_all(q, ...)           same as db:union('all', q, ...)
CONTROL
	:use_index(member, ix)         force index
	:no_index(member [,ix])        forbid index (all if ix omitted)
	:use_counts()                  use MDBX row counts to break ties (off by default)
	:lower() -> node               convert to query-node tree (once and cache)
TERMINALS
	:rows([params])                iterate result rows (closes on finish)
	:first([params])               first result row or nil
	:count([params])               row count
	:exists([params])              true if any row matches

OVERVIEW

	same query + same schema -> same node tree (unless :use_counts())
	:lower():explain() prints the execution plan without running the query

	member = the alias in 'TABLE ALIAS', or TABLE itself when no alias given.
	col refs are bare (driving table) or member.col (any joined table).


JOINS

	child->parent FK (many-to-one): single row lookup by PK of the parent.
	parent->child FK (one-to-many): seeks on the indexed FK column in the child.
	from=: specifies which member's FK column to traverse; auto-inferred when
	   only one FK path exists between the two tables; error if ambiguous.
	on=: disambiguates when multiple FKs exist between the same two tables;
	   matches the FK constraint name.

FILTERS

	filters ANDed; one indexed col drives the scan (equality preferred);
	filters on the driving col are used by the index; the rest are applied
	row by row over each candidate.
	:where on PK col: O(1) point lookup; on secondary indexed col: O(log n).
	range filters on indexed col: index range scan; else full scan + filter.
	:starts on indexed col: range scan over all keys with the given prefix.
	:in_/:not_in with query: runs the subquery and collects its PKs; col
	   must use the same key type as the subquery's PK; for FK membership
	   use :where_exists instead.
	:where_has/:where_hasnt without fn: O(n+m) where n = driving table rows
	   and m = child table rows; one sequential pass over each.
	:or_where: col must be on the driving table; requires >= 1 AND filter
	   first; each OR branch gets its own index plan; branches are merged,
	   then joins and cross-member filters run over the merged stream.

	local outer = mdbx_outer
	db:from'users u':where_exists(
		db:from'sessions':where('user_id', outer'u.id'))

	db:from'users u':where_exists(function(o)
		return db:from'sessions':where('user_id', o'u.id')
	end)

ORDER, LIMIT, DISTINCT

	:order_by: names query columns, not select output names.
	   Free when col is the index key; else O(n log n) full sort.
	:limit + :order_by: when the index already provides the required order,
	   limit is applied at scan level for an early stop; otherwise all rows
	   are buffered before limiting.
	:distinct: O(1) streaming when input is already ordered by the cols;
	   else O(n) hash pass over all rows.

GROUP, AGGREGATE, PROJECTION

	:agg items: {name=string, op=string [,member=string] ...}
	   (full op/type spec in mdbx_query_nodes; member= is the member alias,
	   not the raw table name)
	:group_by when cols exactly match an index key with no filters, joins, or
	   aggregate expressions: O(n groups) with one cursor seek per group.
	:select outputs: comma string | list of 'member.col'|'member.col alias'
	   |{name=, fn=}

UNION

	mode aliases: 'union' = 'distinct'; 'union_all' = 'all'
	all queries must select same output fields in same order
	no full outer join API

TERMINALS

	:rows: returns one Lua table per row with all selected columns; iterator
	   auto-closes the query when the last row is consumed.
	:count: counts all matching rows.
	:exists: true if at least one row matches.

]]

if not ... then require'mdbx_query_builder_test'; return end

require'mdbx_query_nodes'

local Db = mdbx_db

-- outer(ref): correlated-subquery value sentinel; ref = 'alias.col' or 'col'.
local outer_mt = {}
local function outer(ref) return setmetatable({_ref = ref}, outer_mt) end
mdbx_outer = outer
local function is_outer(v) return getmetatable(v) == outer_mt end

local Q = {}; Q.__index = Q
local U = {}; U.__index = U

local function qnew(db, from_spec)
	local tbl, alias = from_spec:match'^(%S+)%s+(%S+)$'
	if not tbl then tbl = from_spec; alias = tbl end
	return setmetatable({
		_db    = db,
		_from  = {tbl = tbl, alias = alias},
		_al    = {[alias] = tbl},   -- alias -> table_name
		_joins = {},
		_filt  = {},
		_order = nil,
		_lim   = nil,
		_off   = nil,
		_sel   = nil,
		_grp   = nil,
		_agg   = nil,
		_hav   = nil,
		_dist  = nil,
		_hints = {},
	}, Q)
end

function Db:from(spec) return qnew(self, spec) end

local union_mode = {
	distinct  = 'distinct',
	union     = 'distinct',
	all       = 'all',
	union_all = 'all',
}

function Db:union(mode, ...)
	local inputs
	if isstr(mode) then
		inputs = {...}
	else
		inputs, mode = {mode, ...}, 'distinct'
	end
	local m = union_mode[mode]
	assertf(m, 'union: invalid mode %q', tostring(mode))
	assertf(#inputs >= 2, 'union: need at least 2 queries, got %d', #inputs)
	for i, q in ipairs(inputs) do
		assertf(type(q) == 'table' and q.lower,
			'union: query %d: builder query expected', i)
	end
	return setmetatable({
		_db = self,
		_mode = m,
		_inputs = inputs,
	}, U)
end

function Db:union_all(...)
	return self:union('all', ...)
end

--filter methods

local function addf(q, f) q._filt[#q._filt+1] = f; return q end

function Q:is_null(col) return addf(self, {k = 'null',   col = col}) end
function Q:is_not_null(col) return addf(self, {k = 'ntnull', col = col}) end
function Q:starts(col, prefix)
	return addf(self, {k = 'starts', col = col, prefix = prefix})
end
function Q:filter(fn) return addf(self, {k = 'fn', fn = fn}) end
function Q:in_(col, set)
	return addf(self, {k = 'in', col = col, set = set})
end
function Q:not_in(col, set)
	return addf(self, {k = 'nin', col = col, set = set})
end
function Q:where_exists(q2) return addf(self, {k = 'ex',  q2 = q2}) end
function Q:where_not_exists(q2) return addf(self, {k = 'nex', q2 = q2}) end
function Q:where_has(tbl, fn)
	return addf(self, {k = 'has', tbl = tbl, fn = fn})
end
function Q:where_hasnt(tbl, fn)
	return addf(self, {k = 'hasnt', tbl = tbl, fn = fn})
end

function Q:between(col, lo, hi)
	return addf(self, {
		k = 'range', col = col,
		lo_op = '>=', lo = lo,
		hi_op = '<=', hi = hi,
	})
end

local cmp = {
	['=='] = function(a, b) return a == b end,
	['~='] = function(a, b) return a ~= b end,
	['<' ] = function(a, b) return a <  b end,
	['<='] = function(a, b) return a <= b end,
	['>' ] = function(a, b) return a >  b end,
	['>='] = function(a, b) return a >= b end,
}

function Q:where(col, op_or_v, v)
	if v == nil then return addf(self, {k = '==', col = col, v = op_or_v}) end
	assertf(cmp[op_or_v], 'where: bad op %q', op_or_v)
	return addf(self, {k = op_or_v, col = col, v = v})
end

function Q:or_where(col, op_or_v, v)
	local sub
	if v == nil then
		sub = {k = '==', col = col, v = op_or_v}
	else
		assertf(cmp[op_or_v], 'or_where: bad op %q', op_or_v)
		sub = {k = op_or_v, col = col, v = v}
	end
	return addf(self, {k = 'or', sub = sub})
end

--join methods

local function addjoin(q, spec, opts, left0)
	local tbl, alias = spec:match'^(%S+)%s+(%S+)$'
	if not tbl then tbl = spec; alias = tbl end
	local alias2 = (opts and opts.as) or alias
	q._al[alias2] = tbl
	q._joins[#q._joins+1] = {
		tbl        = tbl,
		alias      = alias2,
		left       = (opts and opts.left) or left0 or false,
		from_alias = opts and opts.from,
		fk_hint    = opts and opts.on,
	}
	return q
end

function Q:join(spec, opts)       return addjoin(self, spec, opts, false) end
function Q:inner_join(spec, opts) return addjoin(self, spec, opts, false) end
function Q:left_join(spec, opts)  return addjoin(self, spec, opts, true) end

function Q:nested_join(fn)
	self._joins[#self._joins+1] = {nested = true, fn = fn}
	return self
end

--order / paging / projection

function Q:order_by(...)
	self._order = self._order or {}
	local args = {...}
	if type(args[1]) == 'table' and not args[2] then args = args[1] end
	for _, s in ipairs(args) do
		local col, d = s:match'^(.-)%s+(%S+)$'
		if d ~= 'asc' and d ~= 'desc' then col = nil end
		if not col then col = s; d = 'asc' end
		self._order[#self._order+1] = {col = col, desc = d == 'desc'}
	end
	return self
end

function Q:limit(n)    self._lim = n; return self end
function Q:offset(n)   self._off = n; return self end

function Q:distinct(cols)
	self._dist = type(cols) == 'table' and cols or {cols}
	return self
end

function Q:group_by(...)
	local args = {...}
	if type(args[1]) == 'table' and not args[2] then args = args[1] end
	self._grp = args
	return self
end

function Q:agg(spec)    self._agg = spec; return self end
function Q:select(spec) self._sel = spec; return self end

function Q:having(col, op_or_v, v)
	self._hav = self._hav or {}
	if v == nil then
		self._hav[#self._hav+1] = {col = col, op = '==', v = op_or_v}
	else
		assertf(cmp[op_or_v], 'having: bad op %q', op_or_v)
		self._hav[#self._hav+1] = {col = col, op = op_or_v, v = v}
	end
	return self
end

function Q:use_index(member, ix)
	local sname = self._al[member] or member
	self._hints[sname] = self._hints[sname] or {}
	self._hints[sname].use = ix
	return self
end

function Q:no_index(member, ix)
	local sname = self._al[member] or member
	local h = self._hints[sname] or {}
	if ix then h.no = h.no or {}; h.no[ix] = true
	else h.no_all = true end
	self._hints[sname] = h
	return self
end

function Q:use_counts() self._use_counts = true; return self end

--lowering helpers

-- resolve 'alias.col' or bare 'col' to (schema_name, bare_col)
local function qrcol(q, col)
	local alias, c = col:match'^([^.]+)%.(.+)$'
	if alias then return q._al[alias] or alias, c end
	return q._from.tbl, col
end

-- translate one output spec item: 'alias.col [name]' -> 'sname.col [name]'
local function qtrans1(q, s)
	s = s:match'^%s*(.-)%s*$'
	local mcol, name = s:match'^(%S+)%s+(%S+)$'
	if not mcol then mcol = s end
	local alias, c = mcol:match'^([^.]+)%.(.+)$'
	if not alias then return s end
	local sname = q._al[alias] or alias
	local t = sname..'.'..c
	return name and t..' '..name or t
end

-- translate a select spec (string or list) using the alias map
local function qtrans_sel(q, sel)
	if isstr(sel) then
		local parts = {}
		for s in sel:gmatch('[^,]+') do parts[#parts+1] = qtrans1(q, s) end
		return cat(parts, ',')
	end
	local out = {}
	for _, s in ipairs(sel) do
		out[#out+1] = isstr(s) and qtrans1(q, s) or s
	end
	return out
end

local function resolve_order(q, db)
	if not q._order then return end
	local order = {}
	for _, o in ipairs(q._order) do
		local sn, col = qrcol(q, o.col)
		local schema = assertf(db:table_schema(sn),
			'order_by: unknown member or table %s', sn)
		assertf(not schema.is_index, 'order_by: index not allowed: %s', sn)
		assertf(schema.fields[col], 'order_by: unknown column %s.%s', sn, col)
		order[#order+1] = {
			sn  = sn,
			col = col,
			dir = o.desc and 'desc' or 'asc',
		}
	end
	return order
end

local function order_spec(order)
	local parts = {}
	for _, o in ipairs(order) do
		parts[#parts+1] = o.sn..'.'..o.col..(o.dir == 'desc' and ' desc' or '')
	end
	return cat(parts, ',')
end

local function physical_order(order, schema)
	if not order then return end
	local want = {}
	for _, o in ipairs(order) do
		if o.sn ~= schema.name then return end
		want[#want+1] = {
			col = schema.name..'.'..o.col,
			dir = o.dir,
		}
	end
	return want
end

-- true when node.order is a prefix match (or exact) of want_order
-- in the same direction.
local function order_matches(node, want_order)
	local have = node.order
	if not have or not want_order then return false end
	if #want_order > #have then return false end
	for i, wo in ipairs(want_order) do
		local h = have[i]
		if h.col ~= wo.col or h.dir ~= wo.dir then return false end
	end
	return true
end

--[[
true when the value stream is already in group order for the distinct
columns, meaning stream_distinct can be used instead of hash_distinct
(O(1) vs O(n) memory). Compares output column names against physical
column names in vnode.order; only correct when columns are not aliased
in select, but safely falls back otherwise.
]]
local function dist_grouped(vnode, q)
	local have = vnode.order
	if not have then return false end
	local dc = q._dist
	if #dc > #have then return false end
	for i, c in ipairs(dc) do
		if have[i].col ~= c then return false end
	end
	return true
end

local function group_ordered(node, grp_cols)
	local have = node.order
	if not have or #grp_cols > #have then return false end
	for i, gc in ipairs(grp_cols) do
		if have[i].col ~= gc.sn..'.'..gc.col then return false end
	end
	return true
end

--[[
Returns 'asc' or 'desc' when the ix_schema key fields are a leading
prefix of want_order and the index can be scanned in one consistent
direction to deliver that logical order; nil otherwise.
A field stored with f.descending inverts its effective direction: a
forward scan ('asc') yields logically descending values and vice versa.
Used by build_access to find an order-matching index for order_by/limit
and group_by cases that can avoid value_sort.
]]
local function ix_order_dir(ix_schema, schema_name, want_order)
	local kf = ix_schema.key_fields
	if #want_order > #kf then return nil end
	local wo1 = want_order[1]
	local wc1 = wo1.col:match('^[^.]+%.(.+)$') or wo1.col
	if kf[1].col ~= wc1 then return nil end
	-- forward scan of a normal field delivers 'asc'; a descending-stored
	-- field delivers 'desc'. Derive the scan direction from the first col.
	local fwd1 = kf[1].descending and 'desc' or 'asc'
	local scan_dir = wo1.dir == fwd1 and 'asc' or 'desc'
	for i = 2, #want_order do
		local wo = want_order[i]; local kfi = kf[i]
		local wc = wo.col:match('^[^.]+%.(.+)$') or wo.col
		if kfi.col ~= wc then return nil end
		local fwdi = kfi.descending and 'desc' or 'asc'
		local need = scan_dir == 'asc' and fwdi
			or (fwdi == 'asc' and 'desc' or 'asc')
		if wo.dir ~= need then return nil end
	end
	return scan_dir
end

--[[
try to find an index plan for ix_schema given member filters mf.
mf: list of filter specs with _col (bare col name) pre-set.
is_pk: true when ix_schema is the base table (pk_get instead of pk_seek).
returns plan table or nil; plan.consumed = {filter_index -> true}
]]
local function try_ix_plan(ix_schema, mf, is_pk)
	local kc = ix_schema.key_cols
	local n  = #kc
	local eq    = {}   -- col -> {v, fi}
	local lo_by = {}   -- col -> {op, v, fi}
	local hi_by = {}   -- col -> {op, v, fi}
	-- ntnull on a not_null field: null is never stored, so the filter is
	-- vacuously true. Track separately instead of adding a '__null' lo
	-- bound, which fails to encode for not_null fields (check_col error).
	local noop = {}   -- col -> filter index (ntnull on not_null field)
	local kf_map = {}
	for _, kf in ipairs(ix_schema.key_fields) do kf_map[kf.col] = kf end
	for i, f in ipairs(mf) do
		local col = f._col
		if not col then goto continue end
		local k = f.k
		if k == '==' and not is_outer(f.v) then
			if not eq[col] then eq[col] = {v = f.v, fi = i} end
		elseif k == 'null' then
			if not eq[col] then eq[col] = {v = '__null', fi = i} end
		elseif (k == '>' or k == '>=') and not is_outer(f.v) then
			if not lo_by[col] then lo_by[col] = {op = k, v = f.v, fi = i} end
		elseif (k == '<' or k == '<=') and not is_outer(f.v) then
			if not hi_by[col] then hi_by[col] = {op = k, v = f.v, fi = i} end
		elseif k == 'range' and not is_outer(f.lo) and not is_outer(f.hi) then
			if not lo_by[col] then
				lo_by[col] = {op = f.lo_op, v = f.lo, fi = i}
			end
			if not hi_by[col] then
				hi_by[col] = {op = f.hi_op, v = f.hi, fi = i}
			end
		elseif k == 'ntnull' then
			local kf = kf_map[col]
			if kf and kf.not_null then
				noop[col] = noop[col] or i
			elseif not lo_by[col] then
				lo_by[col] = {op = '>', v = '__null', fi = i}
			end
		elseif k == 'starts' then
			if not lo_by[col] then
				lo_by[col] = {op = '>=', v = f.prefix, fi = i}
			end
			if not hi_by[col] then
				hi_by[col] = {op = '<', v = f.prefix, fi = i,
					hi_next_prefix = true}
			end
		end
		::continue::
	end
	local depth = 0; local eq_vals = {}; local consumed = {}
	for _, col in ipairs(kc) do
		if eq[col] then
			depth = depth + 1
			eq_vals[#eq_vals+1] = eq[col].v
			consumed[eq[col].fi] = true
		else break end
	end
	if depth == n then
		return {
			kind     = is_pk and 'pk_get' or 'pk_seek',
			ix       = ix_schema.name,
			vals     = eq_vals,
			consumed = consumed,
			score    = n*20 + 10,
		}
	end
	local nc = kc[depth+1]
	local lo = lo_by[nc]; local hi = hi_by[nc]
	if lo or hi then
		if lo then consumed[lo.fi] = true end
		if hi then consumed[hi.fi] = true end
		if noop[nc] then consumed[noop[nc]] = true end
		return {
			kind     = 'pk_range',
			ix       = ix_schema.name,
			eq_vals  = eq_vals,
			lo_op    = lo and lo.op,
			lo       = lo and lo.v,
			hi_op    = hi and hi.op,
			hi       = hi and hi.v,
			hi_next_prefix = hi and hi.hi_next_prefix,
			consumed = consumed,
			score    = depth*20 + 5,
		}
	end
	if depth > 0 then
		if nc and noop[nc] then consumed[noop[nc]] = true end
		return {
			kind     = 'pk_prefix',
			ix       = ix_schema.name,
			vals     = eq_vals,
			consumed = consumed,
			score    = depth*20,
		}
	end
	return nil
end

local function build_access(db, schema, mf, hints, use_counts, want_order,
	prefer_order)
	local h = hints[schema.name]
	local best
	if h and h.use then
		local ix_s = assertf(db:table_schema(h.use), 'use_index: unknown %q', h.use)
		best = assertf(try_ix_plan(ix_s, mf, false),
			'use_index: %q matches no filter for %s', h.use, schema.name)
	else
		local no_all = h and h.no_all
		local function try_order_plan()
			if not want_order then return end
			for _, ix_s in ipairs(schema.indexes or empty) do
				local skip = no_all or (h and h.no and h.no[ix_s.name])
				if not skip then
					local od = ix_order_dir(ix_s, schema.name, want_order)
					if od then
						return {
							kind     = 'pk_range',
							ix       = ix_s.name,
							eq_vals  = {},
							consumed = {},
							desc     = od == 'desc',
						}
					end
				end
			end
		end
		if prefer_order then best = try_order_plan() end
		if not best then
			if not no_all then
				local p = try_ix_plan(schema, mf, true)
				if p then best = p end
			end
			for _, ix_s in ipairs(schema.indexes or empty) do
				local skip = no_all or (h and h.no and h.no[ix_s.name])
				if not skip then
					local p = try_ix_plan(ix_s, mf, false)
					if p then
						local better = not best or p.score > best.score
							or (use_counts and p.score == best.score
								and db:table_entries(p.ix) < db:table_entries(best.ix))
						if better then best = p end
					end
				end
			end
		end
		--[[
		If no filter plan was found, an ordered index is still useful:
		it avoids value_sort for order_by queries and feeds group_by in
		group order for streaming aggregation.
		]]
		if not best then best = try_order_plan() end
	end
	if best then
		local kind = best.kind
		if kind == 'pk_get' then
			return db:pk_get(schema.name, unpack(best.vals)), best.consumed
		elseif kind == 'pk_seek' then
			return db:pk_seek(best.ix, unpack(best.vals)), best.consumed
		elseif kind == 'pk_prefix' then
			return db:pk_prefix(best.ix, unpack(best.vals)), best.consumed
		else  -- pk_range
			local args = {}
			local opts = {}
			if best.desc then opts.desc = true end
			if #best.eq_vals > 0 then opts.n_fixed_params = #best.eq_vals end
			if best.lo_op then
				args[#args+1] = best.lo_op
				for _, pn in ipairs(best.eq_vals) do args[#args+1] = pn end
				args[#args+1] = best.lo
			end
			if best.hi_op then
				args[#args+1] = best.hi_op
				for _, pn in ipairs(best.eq_vals) do args[#args+1] = pn end
				args[#args+1] = best.hi
			end
			if best.hi_next_prefix then opts.hi_next_prefix = true end
			return db:pk_range(best.ix, opts, unpack(args)), best.consumed
		end
	end
	return db:pk_range(schema.name, empty), {}   -- full scan
end

-- build a pk_filter predicate from a residual filter spec.
-- pk_filter calls fn(node, params); filter values are param names.
local function mk_pkfn(db, f)
	local sn, col, k = f._sname, f._col, f.k
	if k == 'fn' then return f.fn end
	if k == '==' or k == '~=' then
		local fn, pname = cmp[k], f.v
		return function(node, params) return fn(node:col(sn, col), params[pname]) end
	end
	local fn = cmp[k]
	if fn then
		local pname = f.v
		return function(node, params)
			local g = node:col(sn, col)
			return g ~= nil and g ~= null and fn(g, params[pname])
		end
	end
	if k == 'null' then
		return function(node)
			local v = node:col(sn, col)
			return v == nil or v == null
		end
	elseif k == 'ntnull' then
		return function(node)
			local g = node:col(sn, col)
			return g ~= nil and g ~= null
		end
	elseif k == 'range' then
		local lo_pn, hi_pn = f.lo, f.hi
		local lo_fn, hi_fn = cmp[f.lo_op], cmp[f.hi_op]
		return function(node, params)
			local g = node:col(sn, col)
			if g == nil or g == null then return false end
			return lo_fn(g, params[lo_pn]) and hi_fn(g, params[hi_pn])
		end
	elseif k == 'in' or k == 'nin' then
		local mt = db:table_schema(sn).fields[col].mdbx_type
		assertf(mt ~= 'i64' and mt ~= 'u64',
			'list-based in_/not_in on boxed %s column %s.%s', mt, sn, col)
		local lut = index(f.set)
		if k == 'in' then
			return function(node) return lut[node:col(sn, col)] ~= nil end
		else
			return function(node) return lut[node:col(sn, col)] == nil end
		end
	elseif k == 'starts' then
		local pname = f.prefix
		return function(node, params)
			local prefix = params[pname]
			local v = node:col(sn, col)
			return type(v) == 'string' and v:sub(1, #prefix) == prefix
		end
	end
	assertf(false, 'mk_pkfn: unhandled filter kind %q', k)
end

-- categorize filters by member; resolve alias.col; set _sname/_col.
-- returns: by_member, cross (fn/ex/nex/has/hasnt), or_conds.
local function prep_filters(q, filt)
	local by_member = {}
	local cross = {}
	local or_conds = {}
	for _, f in ipairs(filt) do
		local k = f.k
		if k == 'or' then
			local sn, col = qrcol(q, f.sub.col)
			f.sub._sname = sn; f.sub._col = col
			or_conds[#or_conds+1] = f.sub
		elseif k == 'fn' or k == 'ex' or k == 'nex'
			or k == 'has' or k == 'hasnt' then
			cross[#cross+1] = f
		else
			local sn, col = qrcol(q, f.col)
			f._sname = sn; f._col = col
			by_member[sn] = by_member[sn] or {}
			by_member[sn][#by_member[sn]+1] = f
		end
	end
	return by_member, cross, or_conds
end

-- find FK between from_sname and to_sname.
-- hint: optional FK name to pin the choice.
-- returns: 'child_to_parent' | 'parent_to_child', fk_ix_name
local function qfind_fk(db, from_sname, to_sname, hint)
	local from_s = db:table_schema(from_sname)
	if from_s and from_s.fks then
		for fname, fk in pairs(from_s.fks) do
			if fk.ref_table == to_sname then
				if not hint or hint == fname then
					return 'child_to_parent', fk.index.name
				end
			end
		end
	end
	local to_s = db:table_schema(to_sname)
	if to_s and to_s.fks then
		for fname, fk in pairs(to_s.fks) do
			if fk.ref_table == from_sname then
				if not hint or hint == fname then
					return 'parent_to_child', fk.index.name
				end
			end
		end
	end
	assertf(false, 'join: no FK between %s and %s', from_sname, to_sname)
end

-- lower an exists/not_exists filter
local function lower_ex_filter(db, node, f, outer_q)
	local want = f.k == 'ex'
	local q2   = f.q2
	local function apply(factory)
		if want then return db:semi_join(node, factory)
		else return db:anti_join(node, factory) end
	end

	if type(q2) == 'function' then
		-- user fn: factory wraps alias-aware proxy around outer_fn
		local fn = q2
		local factory = function(outer_fn, params)
			local proxy = function(ref)
				local sn, c = qrcol(outer_q, ref)
				return outer_fn(sn..'.'..c)
			end
			local built = fn(proxy)
			if type(built) == 'table' and built.lower then
				return built:lower(), params
			end
			return built, params
		end
		return apply(factory)
	end

	local has_sent = false
	for _, f2 in ipairs(q2._filt) do
		if is_outer(f2.v) or is_outer(f2.lo) or is_outer(f2.hi) then
			has_sent = true; break
		end
	end

	if has_sent then
		--[[ correlated: assign ephemeral param names to outer refs at build
		time; factory injects actual values per outer row into a merged params
		table so the inner node can resolve them via normal param lookup. ]]
		local from_spec = q2._from.tbl
		if q2._from.alias ~= q2._from.tbl then
			from_spec = from_spec..' '..q2._from.alias
		end
		local rq = qnew(q2._db, from_spec)
		rq._al    = q2._al;    rq._joins = q2._joins
		rq._order = q2._order; rq._lim   = q2._lim
		rq._off   = q2._off;   rq._sel   = q2._sel
		rq._hints = q2._hints; rq._use_counts = q2._use_counts
		local ovrefs = {}
		local function remap(v)
			if not is_outer(v) then return v end
			local k = '__ov'..(#ovrefs+1)
			local sn, c = qrcol(outer_q, v._ref)
			ovrefs[#ovrefs+1] = {key = k, sn = sn, col = c}
			return k
		end
		for _, f2 in ipairs(q2._filt) do
			local cf = update({}, f2)
			cf.v  = remap(cf.v)
			cf.lo = remap(cf.lo)
			cf.hi = remap(cf.hi)
			rq._filt[#rq._filt+1] = cf
		end
		local inner = rq:lower()
		local factory = function(outer_fn, params)
			local ov_params = update({}, params)
			for _, ov in ipairs(ovrefs) do
				ov_params[ov.key] = outer_fn(ov.sn..'.'..ov.col)[1]
			end
			return inner, ov_params
		end
		return apply(factory)
	else
		-- uncorrelated: lower once; factory ignores outer_fn
		local inner_node = q2:lower()
		local factory = function(_, params) return inner_node, params end
		return apply(factory)
	end
end

-- pk-level key function for pk_group / stream_aggregate
local function make_key_fn(grp_cols)
	return function(node)
		local parts = {}
		for _, gc in ipairs(grp_cols) do
			local v = node:col(gc.sn, gc.col)
			parts[#parts+1] = v ~= nil and v or null
		end
		return parts
	end
end

--[[
Lowering pass: translate the builder's logical description into a physical
node tree. The output is either a PK stream (no select/agg; used by
count/exists) or a value stream.

All steps before select/agg operate on raw PK bytes. Column values are
decoded lazily via compile_col only when needed, so rows that are filtered
away at PK level never incur a base-table read.

Steps in order:

  1. ACCESS (from-table)
     One index drives the scan. For simple order_by+limit queries, an index
     that already returns rows in the requested table-column order can win so
     the query can stop at limit without value_sort. Otherwise build_access
     scores indexes against the current AND filters and picks the best.
     Equality folds to pk_seek or pk_get; range to pk_range with lo/hi bounds;
     leading-key prefix to pk_prefix; no match -> full pk_range scan.
	  Filters that the index absorbes are marked consumed; the rest becomes
	  step-2 predicates. order_by names are real query columns, not output
	  field names.

  2. RESIDUAL AND FILTERS
     Conditions not consumed by the access node (non-indexed col, second
     index col when first was used for range, outer-ref value) are applied
     here as pk_filter predicates wrapping the access node.

  3. OR CONDITIONS
     OR requires independent branches because each branch may use a different
     index. The main AND branch (steps 1-2) is one branch; each or_where
     condition is another. merge_union deduplicates in PK order. Any branch
     in ix-order is normalised first with pk_sort, because merge_union
     requires all inputs to share the same merge_sig. Joins and cross filters
     (steps 4-5) are applied to the merged, deduplicated stream.

  4. JOINS
     Each join adds a member. FK direction determines the node:
       child->parent: pk_parent_lookup (one base-table seek per row)
       parent->child: pk_join_seek (one FK-index seek per row)
     First join: applied directly to the flat PK stream.
     Later joins: the driver is a multi-member tuple (item='pk_tuple'), so
     pk_project extracts the FK-bearing member into a flat PK stream before
     joining, then pk_project strips it back to just the child table.
     acc tracks all accumulated members so FK discovery can find the right
     side of the relation when from= is not specified.
     Filters on a joined table are applied immediately after its join, while
     the cursor for that member is still positioned.

  5. CROSS-MEMBER FILTERS
     Applied after all joins so every member is in scope.
     fn: pk_filter with the user predicate.
     ex/nex: semi/anti join. Correlated per row when the inner query
     references an outer column; otherwise the inner query runs once.
     has/hasnt without fn: materialise the set of parent-PKs-with-children
     via fk_parent_scan, then filter the driver by membership (pk_hash_filter,
     O(n+m)). With fn: semi/anti join; the user fn shapes the inner query.

  6. PK-LEVEL LIMIT
     Without order_by, limit stops the scan early at PK level.
     Also applied when order_ok: the PK stream already delivers rows in query
     order, either from an index scan or from a PK-level value_sort.
     Otherwise deferred to step 9.

  7. AGGREGATE / SELECT  (PK stream -> value stream)
     Without select or agg, return the PK node; count/exists needs no decode.
     agg + group_by: pk_group collapses consecutive same-key rows (requires
     group order), then stream_aggregate reads each group via next_pk.
     agg only: grand-total stream_aggregate over the whole stream.
     select: db:select decodes the requested columns into value records.

  8. HAVING
     Post-aggregate value_filter; must see value records, not PKs.

  9. DISTINCT, ORDER, VALUE-LEVEL LIMIT
     hash_distinct before sort (fewer records), value_sort materialises
     the full stream, limit takes the top n. Skipped when order_ok.
     At this point order_by still uses real query columns through compile_col;
     it does not read output field names.
]]
function Q:lower()
	if self._node then return self._node end
	local db   = self._db
	local q    = self
	local from_s = assertf(db:table_schema(q._from.tbl),
		'from: unknown table %s', q._from.tbl)
	assertf(not from_s.is_index, 'from: index not allowed: %s', q._from.tbl)

	local by_member, cross, or_conds = prep_filters(q, q._filt)
	local order_cols = resolve_order(q, db)

	local group_order
	if q._agg and q._grp and #q._joins == 0 and #or_conds == 0
		and #cross == 0
	then
		group_order = {}
		for _, c in ipairs(q._grp) do
			local sn, col = qrcol(q, c)
			if sn ~= q._from.tbl then group_order = nil; break end
			group_order[#group_order+1] = {
				col = from_s.name..'.'..col,
				dir = 'asc',
			}
		end
	end
	local order_want
	if q._order and q._lim and not q._agg and not q._dist and not q._hav
		and #q._joins == 0 and #or_conds == 0
	then
		order_want = physical_order(order_cols, from_s)
	end

	-- 1. ACCESS: choose the first read. order_by+limit can prefer an index
	--    that already returns rows in order; otherwise filters choose it.
	--    consumed marks which filter entries the chosen read absorbed.
	local mf = by_member[q._from.tbl] or {}
	local node, consumed = build_access(
		db, from_s, mf, q._hints, q._use_counts, order_want or group_order,
		order_want ~= nil)

	--[[
	order_ok: the PK stream already delivers rows in q._order; value_sort is
	skipped and limit is applied at PK level (step 6) for early termination.
	Requires: no or_conds, no joins, no agg/distinct/having.
	]]
	local order_ok = q._order and q._lim
		and not q._agg and not q._dist and not q._hav
		and #q._joins == 0 and #or_conds == 0
		and order_matches(node, order_want)

	-- 2. RESIDUAL AND FILTERS: conditions the access node could not encode.
	-- pk_and_probe: when order_ok, equality filters fully covered by a secondary
	-- index become probes instead of pk_filter predicates; the driver's natural
	-- order is preserved and limit (step 6) can then terminate the scan early.
	local probe_consumed = {}
	if order_ok then
		local rmf, rfi = {}, {}
		for i, f in ipairs(mf) do
			if not consumed[i] then rmf[#rmf+1] = f; rfi[#rfi+1] = i end
		end
		local used = {}
		local probes = {}
		for _, ix_s in ipairs(from_s.indexes or empty) do
			local p = try_ix_plan(ix_s, rmf, false)
			if p and p.kind == 'pk_seek' then
				local conflict = false
				for ri in pairs(p.consumed) do
					if used[ri] then conflict = true; break end
				end
				if not conflict then
					probes[#probes+1] = {ix = ix_s.name, keys = p.vals}
					for ri in pairs(p.consumed) do used[ri] = true end
				end
			end
		end
		if #probes > 0 then
			for ri in pairs(used) do probe_consumed[rfi[ri]] = true end
			node = db:pk_and_probe(node, unpack(probes))
		end
	end
	for i, f in ipairs(mf) do
		if not consumed[i] and not probe_consumed[i] then
			-- query-based in_/not_in: materialise subquery PKs into a hash and filter
			-- driver by membership; the col is the PK col and the subquery must be in
			-- the same PK key space. For FK use cases use where_exists instead.
			if (f.k == 'in' or f.k == 'nin') and f.set.lower then
				node = db:pk_hash_filter(
					node, f.set:lower(), f.k == 'in' and 'in' or 'not_in')
			else
				node = db:pk_filter(node, mk_pkfn(db, f))
			end
		end
	end

	-- 3. OR CONDITIONS: each branch gets its own access node (and its own
	--    index). All branches must be in PK order (same merge_sig) before
	--    merge_union; pk_sort normalises any ix-order branch.
	if #or_conds > 0 then
		local has_and = false
		for _, f in ipairs(q._filt) do
			if f.k ~= 'or' then has_and = true; break end
		end
		assertf(has_and,
			'or_where: at least one :where filter required before :or_where')
		for _, oc in ipairs(or_conds) do
			assertf(oc._sname == q._from.tbl,
				'or_where: column must be on the from-table %s', q._from.tbl)
		end
		if node.merge_sig ~= from_s.key_sig then node = db:pk_sort(node) end
		local nodes = {node}
		for _, oc in ipairs(or_conds) do
			local or_node, or_consumed = build_access(
				db, from_s, {oc}, {}, q._use_counts)
			if not or_consumed[1] then
				or_node = db:pk_filter(or_node, mk_pkfn(db, oc))
			end
			if or_node.merge_sig ~= from_s.key_sig then
				or_node = db:pk_sort(or_node)
			end
			nodes[#nodes+1] = or_node
		end
		node = db:merge_union(unpack(nodes))
	end

	--[[
	4. JOINS: acc tracks accumulated members for FK auto-discovery.
	Strategy: child->parent -> pk_parent_lookup;
	parent->child -> pk_join_seek. Both nodes accept multi-member
	drivers, so join chains of any length lower the same way: each
	step appends one new member to the running node.
	]]
	local acc = {q._from.tbl}
	for _, j in ipairs(q._joins) do
		if j.nested then
			local jfn = j.fn
			local factory = function(outer_fn, params)
				local r = jfn(outer_fn)
				if type(r) == 'table' and r.lower then
					return r:lower(), params
				end
				return r, params
			end
			node = db:nested_join(node, factory)
		else
			local join_tbl = j.tbl
			assertf(db:table_schema(join_tbl), 'join: unknown table %s', join_tbl)
			local from_sname
			if j.from_alias then
				from_sname = q._al[j.from_alias] or j.from_alias
			else
				for _, sn in ipairs(acc) do
					if pcall(qfind_fk, db, sn, join_tbl, j.fk_hint) then
						from_sname = sn; break
					end
				end
			end
			assertf(from_sname, 'join: no FK from accumulated members to %s', join_tbl)
			local dir, fk_ix = qfind_fk(
				db, from_sname, join_tbl, j.fk_hint)
			-- join chains of any length lower the same way as 2-table joins
			-- because both nodes accept multi-member drivers.
			if dir == 'child_to_parent' then
				node = db:pk_parent_lookup(node, fk_ix,
					j.left and {left = true} or nil)
			else
				assertf(not j.left, 'left join parent->child not yet supported')
				node = db:pk_join_seek(node, fk_ix)
			end
			-- apply join-table filters while the cursor is still positioned.
			for _, f in ipairs(by_member[join_tbl] or empty) do
				node = db:pk_filter(node, mk_pkfn(db, f))
			end
			acc[#acc+1] = join_tbl
		end
	end

	-- 5. CROSS-MEMBER FILTERS: after all joins so every member is in scope.
	for _, f in ipairs(cross) do
		local k = f.k
		if k == 'fn' then
			node = db:pk_filter(node, f.fn)
		elseif k == 'ex' or k == 'nex' then
			node = lower_ex_filter(db, node, f, q)
		elseif k == 'has' or k == 'hasnt' then
			local fk_tbl = f.tbl
			local dir2, fk_ix2 = qfind_fk(db, q._from.tbl, fk_tbl, nil)
			assertf(dir2 == 'parent_to_child',
				'where_has: %s must have FK to %s', fk_tbl, q._from.tbl)
			if f.fn then
				-- user fn shapes the inner query; factory per outer row.
				local want = k == 'has'
				local ufn = f.fn
				local factory = function(outer_fn, params)
					local r = ufn(outer_fn)
					if type(r) == 'table' and r.lower then
						return r:lower(), params
					end
					return r, params
				end
				if want then node = db:semi_join(node, factory)
				else node = db:anti_join(node, factory) end
			else
				-- materialise the set of parents-with-children once via fk_parent_scan,
				-- then filter the driver by membership; O(n+m), no per-row index seek.
				node = db:pk_hash_filter(node, db:fk_parent_scan(fk_ix2),
					k == 'has' and 'in' or 'not_in')
			end
		end
	end

	if order_cols and not order_ok and not q._agg and not q._dist and not q._hav
		and node.item ~= 'value' and #node.members == 1
	then
		node = db:value_sort(node, order_spec(order_cols))
		order_ok = true
	end

	-- 6. PK-LEVEL LIMIT: without order_by the stream order is stable; limit
	--    stops the scan early. Also applied when order_ok (rows in order).
	--    Otherwise deferred to step 9.
	if q._lim and not q._agg and (not q._order or order_ok) then
		node = db:limit(node, q._lim, q._off)
	end

	-- 7. AGGREGATE / SELECT: transition from PK stream to value stream.
	--    Without either, return the PK node; count/exists needs no value decode.
	local vnode
	if q._agg then
		local tagg = {}
		for _, a in ipairs(q._agg) do
			local ta = update({}, a)
			if ta.member then ta.member = q._al[ta.member] or ta.member end
			tagg[#tagg+1] = ta
		end
		if q._grp then
			-- group_by requires group order: pk_group collapses consecutive same-key
			-- rows, stream_aggregate reads all rows per group via next_pk.
			local grp_cols = {}
			for _, c in ipairs(q._grp) do
				local sn, col = qrcol(q, c)
				grp_cols[#grp_cols+1] = {sn = sn, col = col}
			end
			local key_fn = make_key_fn(grp_cols)
			local full_agg = {}
			for i, gc in ipairs(grp_cols) do
				full_agg[#full_agg+1] = {
					name   = gc.col,
					op     = 'key',
					part   = i,
					member = gc.sn,
					col    = gc.col,
				}
			end
			extend(full_agg, tagg)

			-- pk_group_first: no filters/joins and no agg -> index cursor
			-- groups natively via NEXT_NODUP (O(n groups) base reads).
			local grp_ix
			if #tagg == 0 and #mf == 0 and #or_conds == 0
				and #cross == 0 and #q._joins == 0 then
				local n = #grp_cols
				for _, ix_s in ipairs(from_s.indexes or empty) do
					if #ix_s.key_fields == n then
						local match = true
						for i, kf in ipairs(ix_s.key_fields) do
							if kf.col ~= grp_cols[i].col then match = false; break end
						end
						if match then grp_ix = ix_s.name; break end
					end
				end
			end
			if grp_ix then
				vnode = db:stream_aggregate(
					db:pk_group_first(grp_ix), key_fn, full_agg)
			else
				if not group_ordered(node, grp_cols) then
					node = db:value_sort(node, cat(imap(grp_cols,
						function(gc) return gc.sn..'.'..gc.col end), ','))
				end
				vnode = db:stream_aggregate(db:pk_group(node, key_fn), key_fn, full_agg)
			end
		else
			vnode = db:stream_aggregate(node, nil, tagg)
		end
	elseif q._sel then
		vnode = db:select(node, qtrans_sel(q, q._sel))
	else
		-- order_by/limit without select: value_sort handles pk input directly.
		-- distinct and having require a value stream; must be paired with select.
		assertf(not q._dist, 'distinct requires select')
		assertf(not q._hav, 'having requires select')
		if q._order and not order_ok then
			node = db:value_sort(node, order_spec(order_cols))
			if q._lim then node = db:limit(node, q._lim, q._off) end
		end
		-- not cached: caller may still add :select() before running the query.
		return node
	end

	-- 8. HAVING: post-aggregate predicate; must see value records, not PKs.
	if q._hav then
		for _, h in ipairs(q._hav) do
			local hpname, hfn, hcol = h.v, cmp[h.op], h.col
			vnode = db:value_filter(vnode,
				function(r, params) return hfn(r[hcol], params[hpname]) end)
		end
	end

	--[[
	9. DISTINCT, ORDER, VALUE-LEVEL LIMIT.
	Distinct before sort so value_sort operates on fewer records.
	stream_distinct when the value stream is already grouped by the
	distinct cols; hash_distinct otherwise (O(n) memory).
	]]
	if q._dist then
		local dc = q._dist
		local dist_fn = function(r)
			local parts = {}
			for _, c in ipairs(dc) do
				parts[#parts+1] = r[c] ~= nil and r[c] or null
			end
			return parts
		end
		if dist_grouped(vnode, q) then
			vnode = db:stream_distinct(vnode, dist_fn)
		else
			vnode = db:hash_distinct(vnode, dist_fn)
		end
	end

	-- value_sort materialises the full stream; limit takes the top n.
	-- Skipped when order_ok: limit was already applied at PK level in step 6.
	if q._order and not order_ok then
		vnode = db:value_sort(vnode, order_spec(order_cols))
		if q._lim then vnode = db:limit(vnode, q._lim, q._off) end
	end

	self._node = vnode
	return self._node
end

function U:lower()
	if self._node then return self._node end
	local db = self._db
	local nodes = {}
	for i, q in ipairs(self._inputs) do
		local node = q:lower()
		assertf(node.item == 'value',
			'union: query %d: value query expected', i)
		nodes[i] = node
	end
	local node
	if self._mode == 'all' then
		node = db:value_concat(unpack(nodes))
	else
		node = db:union_distinct(unpack(nodes))
	end
	self._node = node
	return self._node
end

--terminals

local function q_open(q, params)
	local node = q:lower()
	params = params or {}
	params.__null = null --NOTE: dirtying the caller's table.
	node:open(params)
	return node
end

function Q:rows(params)
	local node = q_open(self, params)
	local closed = false
	local function close() if not closed then node:close(); closed = true end end
	if node.item == 'value' then
		return function()
			if not node:next_group() then close(); return end
			return node:row()
		end
	else
		return function()
			local ok = node:next_pk() or node:next_group()
			if not ok then close() end
			return ok and node or nil
		end
	end
end

function Q:first(params)
	local node = q_open(self, params)
	local r
	if node.item == 'value' then r = node:next_group() and node:row() or nil
	else r = node:next_group() and node or nil end
	node:close()
	return r
end

function Q:count(params)
	local node = q_open(self, params)
	local n = 0
	if node.item == 'value' then
		while node:next_group() do n = n + 1 end
	else
		while node:next_group() do
			n = n + 1
			while node:next_pk() do n = n + 1 end
		end
	end
	node:close()
	return n
end

function Q:exists(params)
	local node = q_open(self, params)
	local found = node:next_group() ~= nil
	node:close()
	return found
end

U.rows   = Q.rows
U.first  = Q.first
U.count  = Q.count
U.exists = Q.exists
