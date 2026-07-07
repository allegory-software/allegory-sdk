--[[

	convert a query spec to a runnable node-based query plan.
	Written by AI driven by Cosmin Apreutesei. Public Domain.

JOIN
	db:from('TABLE [ALIAS]') -> q  make a query
	:join('TABLE [ALIAS]', [opt])  join on FK from an existing member
		from  = member              which member to join from; inferred when unambiguous
		on    = fk_name             'COL1,COL2...'; for when > 1 FK to same table
		left  = true                left join (default is inner)
		as    = alias               another way to give alias
	:inner_join(...)               same as :join
	:left_join(...)                left join (child->parent only)
	:nested_join(fn [, opt])       nested-loop join; fn(outer) -> query
		left = true                 keep outer row when fn yields no rows
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
	NYI: full outer join API

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

function Q:nested_join(fn, opts)
	self._joins[#self._joins+1] = {nested = true, fn = fn, left = opts and opts.left}
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

--[[
resolve 'alias.col' or bare 'col' to (member, bare_col). member is the
node-level tuple member name: for the from-table's own alias (or a bare
column) it's the from-table's schema name, same as always, since the
from access node never carries an alias of its own. For a join alias it's
the alias itself, unresolved -- that's what lets two joins to the same
table (a self-join) keep distinct members instead of both collapsing to
the same schema name.
]]
local function qrcol(q, col)
	local alias, c = col:match'^([^.]+)%.(.+)$'
	if not alias then return q._from.tbl, col end
	if alias == q._from.alias then return q._from.tbl, c end
	return alias, c
end

-- resolve a member (alias or bare table name) to its underlying schema name.
local function qrschema(q, member)
	return q._al[member] or member
end

-- translate one output spec item: 'alias.col [name]' -> {name=,member=,col=}
-- (member: from-table's own schema name, or the join alias -- see qrcol).
-- unresolvable specs (no dot) are returned unchanged as a string, so
-- parse_col_spec still produces its "member.col [alias]" error for them.
-- default name (no alias given) is the full 'member.col' string, matching
-- parse_col_spec's own default (dist_grouped relies on this convention).
local function qtrans1(q, s)
	s = s:match'^%s*(.-)%s*$'
	local mcol, name = s:match'^(%S+)%s+(%S+)$'
	if not mcol then mcol = s end
	local alias, c = mcol:match'^([^.]+)%.(.+)$'
	if not alias then return s end
	local member = alias == q._from.alias and q._from.tbl or alias
	return {name = name or (member..'.'..c), member = member, col = c}
end

-- translate a select spec (string or list) using the alias map; always
-- returns a list of {name=,member=,col=} / {name=,fn=} entries -- no
-- intermediate string join/re-split through parse_outputs.
local function qtrans_sel(q, sel)
	local out = {}
	if isstr(sel) then
		for s in sel:gmatch('[^,]+') do out[#out+1] = qtrans1(q, s) end
		return out
	end
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
		sn = qrschema(q, sn)
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

-- resolve_order's {sn=,col=,dir=} -> value_sort's structured spec shape.
local function sort_spec(order)
	local spec = {}
	for i, o in ipairs(order) do
		spec[i] = {member = o.sn, col = o.col, desc = o.dir == 'desc'}
	end
	return spec
end

local function physical_order(order, schema)
	if not order then return end
	local want = {}
	for _, o in ipairs(order) do
		if o.sn ~= schema.name then return end
		want[#want+1] = {
			member = schema.name,
			col    = o.col,
			dir    = o.dir,
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
		if h.member ~= wo.member or h.col ~= wo.col or h.dir ~= wo.dir then return false end
	end
	return true
end

--[[
true when the value stream is already in group order for the distinct
columns, meaning stream_distinct can be used instead of hash_distinct
(O(1) vs O(n) memory). Compares output column names against physical
column names in vnode.order; only correct when columns are not aliased
in select, but safely falls back otherwise. node.order is member/col
here but q._dist holds output field names -- for an unaliased select
spec those happen to be the same 'member.col' string (parse_col_spec's
default output name), so the comparison rebuilds that string.
]]
local function dist_grouped(vnode, q)
	local have = vnode.order
	if not have then return false end
	local dc = q._dist
	if #dc > #have then return false end
	for i, c in ipairs(dc) do
		if have[i].member..'.'..have[i].col ~= c then return false end
	end
	return true
end

local function group_ordered(node, grp_cols)
	local have = node.order
	if not have or #grp_cols > #have then return false end
	for i, gc in ipairs(grp_cols) do
		if have[i].member ~= gc.sn or have[i].col ~= gc.col then return false end
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
	if kf[1].col ~= wo1.col then return nil end
	-- forward scan of a normal field delivers 'asc'; a descending-stored
	-- field delivers 'desc'. Derive the scan direction from the first col.
	local fwd1 = kf[1].descending and 'desc' or 'asc'
	local scan_dir = wo1.dir == fwd1 and 'asc' or 'desc'
	for i = 2, #want_order do
		local wo = want_order[i]; local kfi = kf[i]
		if kfi.col ~= wo.col then return nil end
		local fwdi = kfi.descending and 'desc' or 'asc'
		local need = scan_dir == 'asc' and fwdi
			or (fwdi == 'asc' and 'desc' or 'asc')
		if wo.dir ~= need then return nil end
	end
	return scan_dir
end

--[[
categorize member filters by column and kind, once per member instead of
once per candidate index. ntnull resolves against the member's own
not_null constraint here (a column-level constant, identical for every
index that covers the column), instead of a per-index key_fields lookup.
mf: list of filter specs with _col (bare col name) pre-set.
base_schema: the member's own schema (for ntnull's not_null lookup).
]]
local function categorize_filters(mf, base_schema)
	local b = {
		eq = {}, lo_by = {}, hi_by = {}, prefix_by = {}, in_by = {},
		-- ntnull on a not_null field: null is never stored, so the filter is
		-- vacuously true. Tracked separately from a '__null' lo bound, which
		-- fails to encode for not_null fields (check_col error).
		noop = {},
	}
	for i, f in ipairs(mf) do
		local col = f._col
		if col then
			local k = f.k
			if k == '==' and not is_outer(f.v) then
				if not b.eq[col] then b.eq[col] = {v = f.v, fi = i} end
			elseif k == 'null' then
				if not b.eq[col] then b.eq[col] = {v = '__null', fi = i} end
			elseif (k == '>' or k == '>=') and not is_outer(f.v) then
				if not b.lo_by[col] then b.lo_by[col] = {op = k, v = f.v, fi = i} end
			elseif (k == '<' or k == '<=') and not is_outer(f.v) then
				if not b.hi_by[col] then b.hi_by[col] = {op = k, v = f.v, fi = i} end
			elseif k == 'range' and not is_outer(f.lo) and not is_outer(f.hi) then
				if not b.lo_by[col] then
					b.lo_by[col] = {op = f.lo_op, v = f.lo, fi = i}
				end
				if not b.hi_by[col] then
					b.hi_by[col] = {op = f.hi_op, v = f.hi, fi = i}
				end
			elseif k == 'ntnull' then
				local field = base_schema.fields[col]
				if field and field.not_null then
					b.noop[col] = b.noop[col] or i
				elseif not b.lo_by[col] then
					b.lo_by[col] = {op = '>', v = '__null', fi = i}
				end
			elseif k == 'starts' then
				if not b.prefix_by[col] then
					b.prefix_by[col] = {v = f.prefix, fi = i}
				end
			elseif k == 'in' and not f.set.lower and #f.set >= 1 then
				if not b.in_by[col] then b.in_by[col] = {vals = f.set, fi = i} end
			end
		end
	end
	return b
end

--[[
try to find an index plan for ix_schema given filter buckets (see
categorize_filters). is_pk: true when ix_schema is the base table
(pk_get instead of pk_seek). returns plan table or nil;
plan.consumed = {filter_index -> true}
]]
--max :in_ list size eligible for the in_union plan (one pk_get/pk_seek
--per value, merge_union'd): merge_union is a linear scan over its N
--inputs per output item (O(n*m) total), so this gets worse, not
--better, as the list grows. Past this size, fall through to the
--residual hash-set pk_filter instead. 16 is a conservative cutoff --
--benched catastrophic loss (~16.6x) at 5000; the actual crossover
--point wasn't bracketed.
local IN_UNION_MAX = 16
local function try_ix_plan(ix_schema, buckets, is_pk)
	local eq, lo_by, hi_by, prefix_by, in_by, noop =
		buckets.eq, buckets.lo_by, buckets.hi_by,
		buckets.prefix_by, buckets.in_by, buckets.noop
	local kc = ix_schema.key_cols
	local n  = #kc
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
	--[[
	single-column IN match: same idea as or_where's multiple access
	branches merge_union'd together, but for one column's value list
	instead of separate user-written OR conditions. Limited to a schema
	with exactly one key column: a composite key can't be filled from one
	IN list without pairing it with fixed values for the other columns,
	which isn't attempted here.
	]]
	if n == 1 and depth == 0 and in_by[nc]
		and #in_by[nc].vals <= IN_UNION_MAX then
		local ib = in_by[nc]
		return {
			kind     = 'in_union',
			ix       = ix_schema.name,
			is_pk    = is_pk,
			vals     = ib.vals,
			consumed = {[ib.fi] = true},
			score    = n*20 + 10,
		}
	end
	local prefix = prefix_by[nc]
	if prefix then
		consumed[prefix.fi] = true
		local args = {}
		for _, pn in ipairs(eq_vals) do args[#args+1] = pn end
		args[#args+1] = prefix.v
		return {
			kind      = 'pk_range',
			ix        = ix_schema.name,
			call_args = args,
			call_opts = {prefix = 'partial', n_fixed_params = #eq_vals},
			consumed  = consumed,
			score     = depth*20 + 5,
		}
	end
	local lo = lo_by[nc]; local hi = hi_by[nc]
	if lo or hi then
		if lo then consumed[lo.fi] = true end
		if hi then consumed[hi.fi] = true end
		if noop[nc] then consumed[noop[nc]] = true end
		local args = {}
		if lo then
			args[#args+1] = lo.op
			for _, pn in ipairs(eq_vals) do args[#args+1] = pn end
			args[#args+1] = lo.v
		end
		if hi then
			args[#args+1] = hi.op
			for _, pn in ipairs(eq_vals) do args[#args+1] = pn end
			args[#args+1] = hi.v
		end
		return {
			kind      = 'pk_range',
			ix        = ix_schema.name,
			call_args = args,
			call_opts = {n_fixed_params = #eq_vals},
			consumed  = consumed,
			score     = depth*20 + 5,
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
	local buckets = categorize_filters(mf, schema)
	local best
	if h and h.use then
		local ix_s = assertf(db:table_schema(h.use), 'use_index: unknown %q', h.use)
		best = assertf(try_ix_plan(ix_s, buckets, false),
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
							kind      = 'pk_range',
							ix        = ix_s.name,
							call_args = {},
							call_opts = {desc = od == 'desc'},
							consumed  = {},
						}
					end
				end
			end
		end
		if not no_all then
			local p = try_ix_plan(schema, buckets, true)
			if p then best = p end
		end
		for _, ix_s in ipairs(schema.indexes or empty) do
			local skip = no_all or (h and h.no and h.no[ix_s.name])
			if not skip then
				local p = try_ix_plan(ix_s, buckets, false)
				if p then
					local better = not best or p.score > best.score
						or (use_counts and p.score == best.score
							and db:table_entries(p.ix) < db:table_entries(best.ix))
					if better then best = p end
				end
			end
		end
		--[[
		prefer_order: with :limit(), reading in the requested order lets
		the scan stop early, which usually beats a filter match that
		still needs a full sort afterward. But an exact filter match
		(pk_get/pk_seek, all key cols covered) is high-confidence
		selective -- letting it lose to order_want here caused an 86x
		regression at high selectivity (benched; see "CONFIRMED GAPS BY
		BENCH" in this function's doc comment -- the real fix needs a
		per-key match-count estimate, which needs a new primitive; this
		is the conservative version). Weaker range/prefix matches, where
		selectivity is uncertain anyway, still lose to order_want.
		]]
		if prefer_order
			and not (best and (best.kind == 'pk_get' or best.kind == 'pk_seek'))
		then
			local op = try_order_plan()
			if op then best = op end
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
		elseif kind == 'in_union' then
			--[[
			:in_ values are literals known at lower() time, not params bound
			at :rows() time like other filters (there's no per-value param
			name to give pk_get/pk_seek). Build one access node per value and
			merge_union them, then wrap the result's open() to inject the
			literal bindings into whatever params table reaches it -- this
			works regardless of nesting (top-level query, or used as a
			subquery via where_exists/nested_join/where_has), since the
			injection happens at the node itself rather than relying on
			whichever call site happens to assemble params for it.
			]]
			local nodes = {}
			local binds = {}
			for i, v in ipairs(best.vals) do
				local pname = '__inv'..i
				binds[pname] = v
				nodes[i] = best.is_pk and db:pk_get(best.ix, pname)
					or db:pk_seek(best.ix, pname)
			end
			local unode = #nodes == 1 and nodes[1] or db:merge_union(unpack(nodes))
			local uopen = unode.open
			function unode:open(params)
				for pname, v in pairs(binds) do params[pname] = v end
				return uopen(self, params)
			end
			return unode, best.consumed
		else  -- pk_range: call_args/call_opts built where the plan was decided
			return db:pk_range(best.ix, best.call_opts, unpack(best.call_args)),
				best.consumed
		end
	end
	return db:pk_range(schema.name, empty), {}   -- full scan
end

-- build a pk_filter predicate from a residual filter spec.
-- pk_filter calls fn(node, params); filter values are param names.
-- node:col uses _member (tuple member identity), not _sname.
local function mk_pkfn(db, f)
	local sn, col, k = f._member, f._col, f.k
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
		-- int64key: a decoded int64/uint64 value doesn't hash correctly as
		-- a raw table key (see glue.lua int64key).
		local lut = {}
		for _, v in ipairs(f.set) do lut[int64key(v)] = true end
		if k == 'in' then
			return function(node) return lut[int64key(node:col(sn, col))] ~= nil end
		else
			return function(node) return lut[int64key(node:col(sn, col))] == nil end
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

-- AND-compose predicate fns; single fn returned unwrapped (no call overhead).
local function and_fns(fns)
	if #fns == 1 then return fns[1] end
	return function(node, params)
		for i = 1, #fns do
			if not fns[i](node, params) then return false end
		end
		return true
	end
end

-- apply a list of member filters to a pk stream. query-based in_/not_in
-- materialises the subquery's PKs and filters by membership (pk_hash_filter);
-- everything else (including list-based in_/not_in) is AND-composed into one
-- pk_filter predicate -- one node instead of one per filter. subquery filters
-- split the run so relative order is preserved. shared by the from-table
-- residual step and the joined-member filter step.
local function apply_member_filters(db, node, filters)
	local pending = {}
	for _, f in ipairs(filters) do
		if (f.k == 'in' or f.k == 'nin') and f.set.lower then
			if #pending > 0 then
				node = db:pk_filter(node, and_fns(pending)); pending = {}
			end
			node = db:pk_hash_filter(
				node, f.set:lower(), f.k == 'in' and 'in' or 'not_in')
		else
			pending[#pending+1] = mk_pkfn(db, f)
		end
	end
	if #pending > 0 then node = db:pk_filter(node, and_fns(pending)) end
	return node
end

--[[
categorize filters by member; resolve alias.col. Sets both _member (the
tuple member identity used to address the node, e.g. a self-join alias)
and _sname (the underlying schema; or_where checks it's the from-table).
returns: by_member, cross (fn/ex/nex/has/hasnt), or_conds.
]]
local function prep_filters(q, filt)
	local by_member = {}
	local cross = {}
	local or_conds = {}
	for _, f in ipairs(filt) do
		local k = f.k
		if k == 'or' then
			local sn, col = qrcol(q, f.sub.col)
			f.sub._member = sn; f.sub._sname = qrschema(q, sn); f.sub._col = col
			or_conds[#or_conds+1] = f.sub
		elseif k == 'fn' or k == 'ex' or k == 'nex'
			or k == 'has' or k == 'hasnt' then
			cross[#cross+1] = f
		else
			local sn, col = qrcol(q, f.col)
			f._member = sn; f._sname = qrschema(q, sn); f._col = col
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

--[[
wrap a user-supplied fn(o) callback for a correlated subquery
(where_exists/where_has/nested_join fn form). ufn is called once here,
not once per outer row: o('member.col') only ever hands the query a
fresh param name (the same convention as every other filter value,
resolved later via params[pname]), so ufn builds the identical query
structure on every row regardless -- only the bound values vary. Lowers
once here and reuses that node across rows; the returned per-row factory
only rebinds the param values.
]]
local function wrap_user_fn(q, ufn)
	local n = 0
	local binds = {}
	local proxy = function(ref)
		local sn, c = qrcol(q, ref)
		n = n + 1
		local pname = '__of'..n
		binds[n] = {name = pname, sn = sn, col = c}
		return pname
	end
	local r = ufn(proxy)
	local inner = (type(r) == 'table' and r.lower) and r:lower() or r
	local ov_params, src_params
	return function(outer_fn, params)
		if params ~= src_params then
			ov_params = update({}, params)
			src_params = params
		end
		for _, b in ipairs(binds) do
			ov_params[b.name] = outer_fn(b.sn..'.'..b.col)[1]
		end
		return inner, ov_params
	end
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
		return apply(wrap_user_fn(outer_q, q2))
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
			local sn, c = qrcol(outer_q, v._ref)
			-- qrcol doesn't validate the alias belongs to outer_q; an
			-- unvalidated ref that meant to skip past outer_q (referencing
			-- a grandparent, not the immediate parent) would otherwise
			-- silently read the wrong node at runtime instead of failing here.
			assertf(sn == outer_q._from.tbl or outer_q._al[sn],
				'mdbx_outer: %q does not resolve in the immediate enclosing '
				..'query; referencing an ancestor beyond the immediate '
				..'parent is not supported here -- use the function form',
				v._ref)
			local k = '__ov'..(#ovrefs+1)
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
		--params is the same table ref for every outer row in one run
		--(make_existence_join); copy once per run, refresh only __ovN
		--per row. Misses in-place mutation of params mid-run (not done).
		local ov_params, src_params
		local factory = function(outer_fn, params)
			if params ~= src_params then
				ov_params = update({}, params)
				src_params = params
			end
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

--[[
Lowering pass: translate the builder's logical description into a physical
node tree. The output is either a PK stream (no select/agg; used by
count/exists) or a value stream.

All steps before select/agg operate on raw PK bytes. Column values are
decoded lazily via compile_col only when needed, so rows that are filtered
away at PK level never incur a base-table read.

Steps in order:

  1. ACCESS (from-table)
     One index drives the scan. For simple order_by queries (no joins/agg/
     distinct/having/or_where), an index that already returns rows in the
     requested table-column order can avoid value_sort entirely; with
     :limit() it also wins over a filter match so the scan can stop early.
     Without :limit(), it's only used as a fallback when no AND filter
     matched any index (would otherwise be a full unordered scan followed
     by a sort -- the order-matching index costs no more and needs no sort).
     Otherwise build_access scores indexes against the current AND filters
     and picks the best. Equality folds to pk_seek or pk_get; range to
     pk_range with lo/hi bounds; starts to pk_range partial prefix;
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
     First join: applied directly to the flat PK stream. Later joins: the
     driver is a multi-member tuple (item='pk_tuple'); pk_parent_lookup and
     pk_join_seek both accept a multi-member driver directly (from_member
     picks which existing member carries the FK side), so no projection step
     is needed between chained joins.
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

REJECTED BY BENCH -- don't retry these without new evidence:

  - left_join via merge_join + db.left on the fk side, instead of
    pk_join_seek(left=true) (step 4). Looked like a 2x-4x win with the
    jit on; with the jit off, pk_join_seek(left=true) wins instead.
    jit warmup artifact, not a real effect (see tests/mdbx_query_bench.lua,
    bench_left_join_strategy).
  - n-ary merge_join for two or more parent->child joins from the same
    from-table in the same key space (step 4), instead of chaining
    pk_join_seek per join. Looked like a ~35% win with the jit on; with
    the jit off it's a consistent slight loss instead (same jit-warmup
    artifact as above). Separately: chaining two binary merge_join calls
    (as opposed to one n-ary call) is outright wrong, not just slower --
    it silently drops rows when both sides have real duplicate fan-out
    for the same key (see tests/mdbx_query_bench.lua,
    bench_nary_merge_strategy).
  - pk-level union pushdown: merge_union the branches' pk streams and
    select once, instead of selecting each branch then value_concat +
    hash_distinct (Db:union / U:lower). Confirmed a real, reproducible
    ~2x win (survives jit off), but requires exposing each branch's
    pre-select pk node from Q:lower() as a new field -- judged not worth
    the added surface for 2x (see tests/mdbx_query_bench.lua,
    bench_union_pushdown in scratch history).
  - merge_union('full') for full outer join: removed. Only correct for a
    1:1 relationship between inputs (advances via next_group only, never
    next_pk), so it silently drops duplicate children for the common
    parent->child one-to-many case -- the case a full outer join API
    would actually need to cover.

FIXED BY BENCH -- an existing default was measured worse than the
alternative and has been corrected; don't reintroduce without new
evidence:

  - parent->child merge_ok (step 4, "first join only, no left join, no
    alias" -- the ORIGINAL fast path, predated the jit-off convention):
    used to prefer merge_join over pk_join_seek. Re-measured jit off at
    both N_POSTS=3000 and the file's default N_POSTS=20000:
    pk_join_seek won instead, consistently, at every driver-size
    fraction (~10%-20% faster). The comment's own "per bench"
    justification looks like the same kind of jit-warmup artifact found
    and reverted above -- it just predated this session instead of
    being introduced during it. merge_ok deleted; always pk_join_seek
    for this direction now.
  - pk_and_probe (step 2, order_ok residual equality filter -> probe a
    secondary index instead of pk_filter decode+compare): lost to plain
    pk_filter in both shapes tested (count-only and full select), jit
    off, reproducibly. Expected pk_and_probe to win the count-only case
    (avoids a base-table read) but it didn't even there. Conversion
    removed; residual filters always go through pk_filter now (the
    pk_and_probe node itself stays, just unused by the builder).
  - in_union (step 1, single-column :in_ -> one pk_get/pk_seek per
    value + merge_union): for a wide list (5000 values, 2.5% table
    selectivity) this was ~16.6x slower, jit off, than a full scan +
    hash-set pk_filter (the same strategy already used for an :in_
    filter that isn't index-eligible) -- merge_union is O(n*m) in the
    number of merged inputs (see its own "Linear scan" comment in
    mdbx_query_nodes.lua), so this gets worse, not better, as the list
    grows. Capped at IN_UNION_MAX (16, a conservative guess -- the
    actual crossover point wasn't bracketed); above that, falls through
    to the residual hash-set pk_filter instead.
  - prefer_order (step 1, build_access: with :limit(), an order-matching
    index scan used to always win over a more selective filter-index
    scan, unconditionally): at high filter selectivity (match count ==
    limit, spread evenly through the ordered range) the order-scan had
    to walk almost the entire table to collect enough matches -- 86x
    slower, jit off, than filter-index-scan + value_sort + limit (worst
    case; crossover point not bracketed). Conservative fix applied: an
    exact filter match (pk_get/pk_seek, all key cols covered) now wins
    over order_want regardless of :limit(); weaker range/prefix matches,
    where selectivity is uncertain anyway, still lose to order_want as
    before. The proper fix (a per-key match-count estimate, deciding
    both directions of the tradeoff rather than special-casing the one
    that regressed) needs a new primitive -- MDBX has a cheap per-key
    dup count (mdbx_cursor_count, declared in mdbx_h.lua) but it's not
    wrapped in mdbx.lua yet -- left as a follow-up, not done here.

CONFIRMED BY BENCH -- existing choice measured and left as-is, no code
change:

  - use_counts tie-break (db:table_entries): a same-shape (unique key,
    single-row result) pk_seek on a 50-entry index vs a 2,000,000-entry
    index, jit off, came out within ~6% (79.4k q/s vs 74.7k q/s) --
    exact-match seek cost is dominated by btree depth (O(log n)), and the
    entries gap needed to move depth by even one level is far larger than
    any realistic index-size difference. Confirms "off by default" is the
    right default, not just an untested guess.
  - hash_aggregate vs value_sort+pk_group+stream_aggregate for group_by
    with no natural order (step 7): hash_aggregate won by ~3x (3.3 q/s vs
    1.1 q/s, 400-row groups over a full unsorted scan), jit off --
    confirms the O(n) vs O(n log n) reasoning holds in practice, not just
    asymptotically. (The doc's prior wording called the alternative
    "pk_sort+pk_group" -- wrong: pk_sort only normalises PK order, doesn't
    touch group-column order. The real alternative is value_sort, which
    is what was benched.)
  - pk_seek's DUPFIXED bulk-read path (MDBX_SEEK_AND_GET_MULTIPLE/
    NEXT_MULTIPLE, whole pages of same-key dups per call): the dispatch is
    schema-determined (set whenever the base table's pk is fixed-size), so
    no query picks the alternative on the same data. Two benches, jit off,
    2000 dups/key:
    (a) raw cursor ops by hand, bypassing pk_seek, both sides walking one
        row at a time (matching next_group()'s one-row-per-call contract,
        not just summing a page's byte count): bulk won ~48x (49.3k q/s
        vs 1.0k q/s).
    (b) through the real db:pk_seek node -- MDBX_NODUPFIXED (global bench
        override in mdbx_query_nodes.lua's pk_seek) forces the non-DUPFIXED
        branch on the exact same physical dfx table, no second table
        needed: bulk won ~2.9x (2.9k q/s vs 1.0k q/s).
    The (a)-vs-(b) gap is real, not a bug: next_group() writes two cdata
    struct fields (pk_rec.data/size) every row in both branches, and that
    write costs ~32x more per call under jit off than plain Lua arithmetic
    (checked separately) -- a fixed per-row cost common to both branches
    that dilutes the visible ratio. (a) has no such cost, so it shows the
    algorithm's raw gap undiluted. Still worth it either way, comfortably
    over the 2x bar; (b) is the number for "is this worth the code" since
    it's measured the way this project always benches (jit off).
  - pk_join_seek's wide vs narrow fk path: MDBX_WIDEFK (global bench
    override in mdbx_query_nodes.lua's pk_join_seek) forces the wide
    (pk_prefix range-scan) branch on p/c1, a normal single-col-fk table
    that would dispatch to narrow (MDBX_NEXT_DUP). Narrow won by only
    ~1.3x -- under the 2x bar, but kept as-is since it's the natural
    dispatch already in place, not new code being justified.

CONFIRMED GAPS BY BENCH -- current behavior measured worse than an
alternative, jit off; decision made, not acted on:

  - child->parent (pk_parent_lookup, step 4): has no merge-based fast
    path at all today (pk_parent_lookup used unconditionally).
    tests/mdbx_query_bench.lua's own bench_parent_lookup_sweep
    ("merge_join rev") shows merge_join beating pk_parent_lookup by
    ~1.7x-2.5x (rising with driver size), consistently, jit off, at
    every fraction -- a real, unexploited win. Not a simple flip like
    the parent->child case above: merge_join needs the driver already
    streaming in FK-value order (e.g. scanning post/author_id), not the
    child table's own PK order, so build_access would need a new hint
    (like order_want/group_order) to prefer the FK index as a fallback
    driving scan -- new plumbing, not just a condition change. Declined:
    not worth that plumbing for ~2x. Don't revisit without a bigger win
    or a reason the plumbing is needed for something else too.

NOT BENCHED -- judged not worth constructing an isolated test for, or
not a tunable choice at all:

  - try_ix_plan's scoring weights (n*20+10 full match, depth*20+5
    range, depth*20 prefix): a relative ranking across many candidate
    index shapes at once, not a single two-way comparison; no isolated
    test constructed.
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

	-- shared guards: plain = no agg/distinct/having; order_stable = the
	-- initial access node's order isn't disturbed by a join or an OR-merge.
	local plain = not q._agg and not q._dist and not q._hav
	local order_stable = #q._joins == 0 and #or_conds == 0

	local group_order
	if q._agg and q._grp and order_stable and #cross == 0 then
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
	if q._order and plain and order_stable then
		order_want = physical_order(order_cols, from_s)
	end

	--[[
	1. ACCESS: choose the first read. order_want lets build_access recognise
	an index that already returns rows in the requested order; otherwise
	filters choose it. prefer_order (only with :limit()) makes build_access
	pick that index even over a more selective filter match, since reading
	in order lets limit stop the scan early; without a limit, all matching
	rows are needed anyway, so a selective filter index (fewer rows to
	sort) still wins there -- order_want only serves as a zero-cost
	fallback (build_access tries it last) when no filter matched an index
	at all, replacing what would otherwise be a full unordered scan.
	consumed marks which filter entries the chosen read absorbed.
	]]
	local mf = by_member[q._from.tbl] or {}

	--[[
	group index: when grouping needs no other aggregates (agg{} empty --
	a "distinct group keys" query) and no joins/cross filters, and the
	group cols exactly match an index key, the index cursor groups
	natively via NEXT_NODUP (O(n groups) base reads) -- decided here so
	the normal access node (step 1) is skipped entirely instead of being
	built and discarded. A leading run of the group cols pinned by an
	equality filter narrows the scan to a prefix of the index
	(pk_group_first's own prefix-arg support, benched ~200x over
	hash_aggregate on a filtered high-cardinality group). Any mf entry
	left unconsumed by that prefix blocks the fast path: pk_group_first
	exposes only one representative row per group, so a filter on a
	non-key column can't be safely checked against it.
	]]
	local grp_cols, grp_ix, grp_ix_prefix, grp_ix_consumed
	if q._agg and q._grp then
		grp_cols = {}
		for _, c in ipairs(q._grp) do
			local sn, col = qrcol(q, c)
			grp_cols[#grp_cols+1] = {sn = sn, col = col}
		end
		if #q._agg == 0 and order_stable and #cross == 0 then
			local n = #grp_cols
			for _, ix_s in ipairs(from_s.indexes or empty) do
				if #ix_s.key_fields == n then
					local match = true
					for i, kf in ipairs(ix_s.key_fields) do
						if kf.col ~= grp_cols[i].col then match = false; break end
					end
					if match then
						local prefix, used, depth = {}, {}, 0
						for _, gc in ipairs(grp_cols) do
							local fi, pname
							for j, f in ipairs(mf) do
								if not used[j] and f.k == '==' and f.col == gc.col
									and not is_outer(f.v) then
									fi, pname = j, f.v; break
								end
							end
							if not fi then break end
							used[fi] = true
							prefix[#prefix+1] = pname
							depth = depth + 1
						end
						if depth == #mf and depth < n then
							grp_ix = ix_s.name
							grp_ix_prefix = prefix
							grp_ix_consumed = used
						end
						break
					end
				end
			end
		end
	end

	local node, consumed
	if grp_ix then
		consumed = grp_ix_consumed
	else
		node, consumed = build_access(
			db, from_s, mf, q._hints, q._use_counts, order_want or group_order,
			order_want ~= nil and q._lim ~= nil)
	end

	--[[
	order_ok: the PK stream already delivers rows in q._order; value_sort is
	skipped, and limit (when present) is applied at PK level (step 6) for
	early termination. Requires: no or_conds, no joins, no agg/distinct/having.
	]]
	local order_ok = q._order and plain and order_stable
		and order_matches(node, order_want)

	-- 2. RESIDUAL AND FILTERS: conditions the access node could not encode.
	-- query-based in_/not_in: materialise subquery PKs into a hash and filter
	-- driver by membership; the col is the PK col and the subquery must be in
	-- the same PK key space. For FK use cases use where_exists instead.
	local residual = {}
	for i, f in ipairs(mf) do
		if not consumed[i] then residual[#residual+1] = f end
	end
	node = apply_member_filters(db, node, residual)

	-- 3. OR CONDITIONS: each branch gets its own access node (and its own
	--    index). All branches must be in PK order (same merge_sig) before
	--    merge_union; pk_sort normalises any ix-order branch.
	if #or_conds > 0 then
		assertf(next(by_member) ~= nil or #cross > 0,
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
	4. JOINS: acc tracks accumulated {sname=, member=} pairs for FK
	auto-discovery. member is the node-level tuple member (the join's
	alias, or the schema name when unaliased); sname is the real schema,
	needed to look up FKs. Two joins to the same table (a self-join) get
	distinct members via distinct aliases, so they don't collide.
	Strategy: child->parent -> pk_parent_lookup;
	parent->child -> pk_join_seek. Both nodes accept multi-member
	drivers, so join chains of any length lower the same way: each
	step appends one new member to the running node.
	]]
	local acc = {{sname = q._from.tbl, member = q._from.tbl}}
	for _, j in ipairs(q._joins) do
		if j.nested then
			node = db:nested_join(node, wrap_user_fn(q, j.fn), {left = j.left})
		else
			local join_tbl = j.tbl
			local join_member = j.alias
			assertf(db:table_schema(join_tbl), 'join: unknown table %s', join_tbl)
			local from_sname, from_member
			if j.from_alias then
				-- the from-table's own alias always maps to its schema name
				-- (see qrcol); any other alias is a prior join's own member.
				from_member = j.from_alias == q._from.alias
					and q._from.tbl or j.from_alias
				from_sname = q._al[j.from_alias] or j.from_alias
			else
				for _, e in ipairs(acc) do
					if pcall(qfind_fk, db, e.sname, join_tbl, j.fk_hint) then
						from_sname, from_member = e.sname, e.member; break
					end
				end
			end
			assertf(from_sname, 'join: no FK from accumulated members to %s', join_tbl)
			local dir, fk_ix = qfind_fk(
				db, from_sname, join_tbl, j.fk_hint)
			-- join chains of any length lower the same way as 2-table joins
			-- because both nodes accept multi-member drivers.
			local opts = {left = j.left or nil, member = join_member,
				from_member = from_member}
			if dir == 'child_to_parent' then
				node = db:pk_parent_lookup(node, fk_ix, opts)
			else
				node = db:pk_join_seek(node, fk_ix, opts)
			end
			-- apply join-table filters while the cursor is still positioned.
			node = apply_member_filters(db, node, by_member[join_member] or empty)
			acc[#acc+1] = {sname = join_tbl, member = join_member}
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
				local factory = wrap_user_fn(q, f.fn)
				if k == 'has' then node = db:semi_join(node, factory)
				else node = db:anti_join(node, factory) end
			else
				--fk_parent_scan is always in from-table pk order (it
				--re-encodes nullable FK parts itself), so merge_except/
				--merge_join just need node already sorted too (per bench,
				--they lose once a pk_sort would be needed). hasnt keeps all
				--of node's members via merge_except; has goes through
				--pk_project, which drops all but one member, so it's
				--restricted to #node.members==1 (no prior joins).
				local sorted = node.merge_sig == from_s.key_sig
				if k == 'hasnt' and sorted then
					node = db:merge_except(node, db:fk_parent_scan(fk_ix2))
				elseif k == 'has' and sorted and #node.members == 1 then
					node = db:pk_project(
						db:merge_join(node, db:fk_parent_scan(fk_ix2)), q._from.tbl)
				else
					-- materialise the set of parents-with-children once via
					-- fk_parent_scan, then filter the driver by membership;
					-- O(n+m), no per-row index seek.
					node = db:pk_hash_filter(node, db:fk_parent_scan(fk_ix2),
						k == 'has' and 'in' or 'not_in')
				end
			end
		end
	end

	--node.item == 'pk' is the flat single-member case value_sort's pk-input
	--path requires. nested_join's members list isn't extended until its
	--first runtime iteration, so it can show #members == 1 at build time
	--while its item stays 'pk_tuple'.
	if order_cols and not order_ok and plain and node.item == 'pk' then
		node = db:value_sort(node, sort_spec(order_cols))
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
			-- pk_group+stream_aggregate need group order (consecutive same-key
			-- rows); used when that's free (grp_ix, or node already delivers
			-- it). Otherwise hash_aggregate below groups without needing order.
			-- grp_cols/grp_ix: computed above, before step 1, so a matching
			-- grp_ix could skip the access node entirely.
			local cols = {}
			for i, gc in ipairs(grp_cols) do cols[i] = {member = gc.sn, col = gc.col} end
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

			if grp_ix then
				--~147x faster than the hash_aggregate fallback below.
				vnode = db:stream_aggregate(
					db:pk_group_first(grp_ix, unpack(grp_ix_prefix)), cols, full_agg)
			elseif group_ordered(node, grp_cols) then
				vnode = db:stream_aggregate(db:pk_group(node, cols), cols, full_agg)
			else
				--[[
				no natural group order: sorting the pk stream (value_sort) would
				also require it to be a flat single-member driver, which a joined
				node isn't. hash_aggregate groups an already-decoded value stream
				in one O(n) pass with no order requirement -- strictly cheaper
				than sort-then-stream here too, since there's no free order to
				lose by not sorting. select decodes exactly the columns the
				group key and aggregates need; out_name dedups repeated columns
				and gives each a private field name in that row.
				~3x faster than value_sort+pk_group+stream_aggregate.
				]]
				local outputs = {}
				local seen = {}
				local function out_name(member, col)
					local k = member..':'..col
					local name = seen[k]
					if name then return name end
					name = '_g'..(#outputs+1)
					outputs[#outputs+1] = {name = name,
						fn = function(pk) return pk:col(member, col) end}
					seen[k] = name
					return name
				end
				local grp_names = {}
				for i, gc in ipairs(grp_cols) do grp_names[i] = out_name(gc.sn, gc.col) end
				local full_hagg = {}
				for i, gc in ipairs(grp_cols) do
					full_hagg[#full_hagg+1] = {
						name = gc.col, op = 'key', part = i,
						member = gc.sn, col = gc.col,
					}
				end
				for _, a in ipairs(tagg) do
					local ha = update({}, a)
					if a.op ~= 'count' then ha.input = out_name(a.member, a.col) end
					full_hagg[#full_hagg+1] = ha
				end
				vnode = db:hash_aggregate(db:select(node, outputs), grp_names, full_hagg)
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
			-- always fires: step 6 already sorts and sets order_ok for the
			-- only case where node.item == 'pk' here. Named so a join
			-- hits this message instead of value_sort's generic assert.
			assertf(node.item == 'pk', 'order_by after join requires select')
		end
		-- not cached: caller may still add :select() before running the query.
		return node
	end

	-- 8. HAVING: post-aggregate predicate; must see value records, not PKs.
	-- AND-composed into one value_filter instead of one per condition.
	if q._hav then
		local fns = {}
		for _, h in ipairs(q._hav) do
			local hpname, hfn, hcol = h.v, cmp[h.op], h.col
			fns[#fns+1] = function(r, params) return hfn(r[hcol], params[hpname]) end
		end
		vnode = db:value_filter(vnode, and_fns(fns))
	end

	--[[
	9. DISTINCT, ORDER, VALUE-LEVEL LIMIT.
	Distinct before sort so value_sort operates on fewer records.
	stream_distinct when the value stream is already grouped by the
	distinct cols; hash_distinct otherwise (O(n) memory).
	]]
	if q._dist then
		local dc = q._dist
		if dist_grouped(vnode, q) then
			vnode = db:stream_distinct(vnode, dc)
		else
			vnode = db:hash_distinct(vnode, dc)
		end
	end

	-- value_sort materialises the full stream; limit takes the top n.
	-- Skipped when order_ok: limit was already applied at PK level in step 6.
	if q._order and not order_ok then
		vnode = db:value_sort(vnode, sort_spec(order_cols))
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
