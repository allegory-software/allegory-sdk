require'mdbx_query'

local q = mdbx_query
local c = q.col
local p = q.param

local test = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

local function test_file(name)
	return '/tmp/sdk_mdbx_query_test_'..name..'_'..uuid()..'.mdb'
end
local function cleanup(file)
	os.remove(file)
	os.remove(file..'-lck')
end

--build(db) sets up one fixture; fn(db) runs assertions against it.
local function with_db(build, name, fn)
	local file = test_file(name)
	cleanup(file)
	local db = mdbx_open(file)
	local ok, err = xpcall(function()
		build(db)
		fn(db)
	end, debug.traceback)
	if db.env then db:close() end
	cleanup(file)
	assert(ok, err)
end

--collect one field from every row, in scan order; numeric=true converts
--decoded numeric cdata to plain Lua numbers for comparison.
local function vals(rel, params, field, numeric)
	local t = {} --{val...}
	for row in rel:rows('{}', params) do
		local v = row[field]
		t[#t + 1] = numeric and tonumber(v) or v
	end
	return t
end
local function sorted_vals(rel, params, field, numeric)
	local t = vals(rel, params, field, numeric)
	table.sort(t)
	return t
end
local function S(t)
	return '{'..table.concat(t, ',')..'}'
end
local function check(name, got, expect)
	local g, e = S(got), S(expect)
	assert(g == e, name..': expected '..e..' got '..g)
end

------------------------------------------------------------------------------
--FIXTURE: core -- item, tag, note.
--tag/note carry no indexes: joins against them always need a residual check,
--which is what most of the join/exists/left-join tests want to exercise.
------------------------------------------------------------------------------

local function build_core(db)
	db:begin'w'
	db:create_table('item', {fields = {
		{col = 'id',    mdbx_type = 'u32',  not_null = true},
		{col = 'cat',   mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
		{col = 'score', mdbx_type = 'i32'},
		{col = 'label', mdbx_type = 'utf8', maxlen = 16, nozero = true},
	}, pk = {'id'}})
	db:add_index('item', {'cat'})
	db:add_index('item', {'cat', 'score'})
	db:add_index('item', {'cat', 'label'})

	db:create_table('tag', {fields = {
		{col = 'tag_id',  mdbx_type = 'u32', not_null = true},
		{col = 'item_id', mdbx_type = 'u32'},
		{col = 'name',    mdbx_type = 'utf8', maxlen = 8, nozero = true},
	}, pk = {'tag_id'}})

	db:create_table('note', {fields = {
		{col = 'note_id', mdbx_type = 'u32', not_null = true},
		{col = 'item_id', mdbx_type = 'u32'},
		{col = 'tag_id',  mdbx_type = 'u32'},
		{col = 'body',    mdbx_type = 'utf8', maxlen = 8, nozero = true},
	}, pk = {'note_id'}})

	local items = {
		{id = 1, cat = 'a', score = 10, label = 'alpha'},
		{id = 2, cat = 'a', score = 20, label = 'beta'},
		{id = 3, cat = 'b', score = 30},
		{id = 4, cat = 'b', score = 5,  label = 'alpha'},
		{id = 5, cat = 'a', label = 'gamma'},
	}
	for _, r in ipairs(items) do db:insert('item', '{}', r) end

	local tags = {
		{tag_id = 1, item_id = 1, name = 'x'},
		{tag_id = 2, item_id = 2, name = 'y'},
		{tag_id = 3, item_id = 1, name = 'z'},
		{tag_id = 4, item_id = 2, name = 'w'},
	}
	for _, r in ipairs(tags) do db:insert('tag', '{}', r) end

	local notes = {
		{note_id = 1, item_id = 1, tag_id = 1, body = 'n1'},
		{note_id = 2, item_id = 1, tag_id = 3, body = 'n2'},
		{note_id = 3, item_id = 2, tag_id = 2, body = 'n3'},
		{note_id = 4, item_id = 1, tag_id = 2, body = 'bad'}, --tag_id 2 belongs to item 2, not 1
	}
	for _, r in ipairs(notes) do db:insert('note', '{}', r) end
	db:commit()
end

------------------------------------------------------------------------------

function test.access_plan_composite_exec()
	with_db(build_core, 'access_plan_composite', function(db)
		db:atomic('r', function()
			--leading eq (cat) + range (score) on item/cat,score: 'range' plan.
			local plan1 = db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.gt(c'i.score', 10))
				:select{'i.id id'}:explain()
			assert(plan1.steps[1].kind == 'range', S{plan1.steps[1].kind})
			check('eq+range', sorted_vals(db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.gt(c'i.score', 10)):select{'i.id id'},
				nil, 'id', true), {2})

			--flipped operand (literal < col) must resolve to the same bound.
			check('flipped range', sorted_vals(db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.lt(10, c'i.score')):select{'i.id id'},
				nil, 'id', true), {2})

			--leading eq (cat) + prefix (starts on label) on item/cat,label: 'prefix' plan.
			local plan2 = db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.starts(c'i.label', 'al'))
				:select{'i.id id'}:explain()
			assert(plan2.steps[1].kind == 'prefix', S{plan2.steps[1].kind})
			check('eq+prefix', sorted_vals(db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.starts(c'i.label', 'al')):select{'i.id id'},
				nil, 'id', true), {1})

			--two eq() facts on the same column: first wins the seek, second
			--stays a residual double-check -- a contradictory pair must
			--still filter correctly instead of using only the seek.
			check('duplicate eq facts', vals(db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.eq(c'i.cat', 'b')):select{'i.id id'},
				nil, 'id', true), {})
		end)
	end)
end

function test.null_fact_plan_exec()
	with_db(build_core, 'null_fact_plan', function(db)
		db:atomic('r', function()
			--is_null() on a not_null column (cat) can never be proven by an
			--index seek; it must stay a residual check that excludes every row.
			check('is_null on not_null col', vals(db:from('item i')
				:where(q.is_null(c'i.cat')):select{'i.id id'}, nil, 'id', true), {})

			--is_not_null() on a not_null column is statically true and
			--gets dropped; every row still comes back.
			check('is_not_null on not_null col', sorted_vals(db:from('item i')
				:where(q.is_not_null(c'i.cat')):select{'i.id id'}, nil, 'id', true),
				{1, 2, 3, 4, 5})

			--is_not_null() on a nullable column (score) becomes a '>null'
			--lo-bound seek instead of a residual check.
			check('is_not_null on nullable col', sorted_vals(db:from('item i')
				:where(q.is_not_null(c'i.score')):select{'i.id id'}, nil, 'id', true),
				{1, 2, 3, 4})
		end)
	end)
end

function test.in_union_and_dedup_exec()
	with_db(build_core, 'in_union_and_dedup', function(db)
		db:atomic('r', function()
			--item's pk is single-column (id), so in_() on it drives repeated
			--exact seeks ('in' plan) instead of a residual scan.
			local ids16 = {} --16 ids, only 1..5 exist
			for i = 1, 16 do ids16[i] = i == 1 and 1 or 100 + i end
			ids16[2], ids16[3], ids16[4], ids16[5] = 2, 3, 4, 5
			local plan16 = db:from('item i'):where(q.in_(c'i.id', ids16))
				:select{'i.id id'}:explain()
			assert(plan16.steps[1].kind == 'in', S{plan16.steps[1].kind})
			check('in <= IN_UNION_MAX seeks', sorted_vals(db:from('item i')
				:where(q.in_(c'i.id', ids16)):select{'i.id id'}, nil, 'id', true),
				{1, 2, 3, 4, 5})

			local ids17 = {}
			for i = 1, 17 do ids17[i] = i <= 5 and i or 100 + i end
			local plan17 = db:from('item i'):where(q.in_(c'i.id', ids17))
				:select{'i.id id'}:explain()
			assert(plan17.steps[1].kind ~= 'in', S{plan17.steps[1].kind})
			check('in > IN_UNION_MAX falls back but stays correct', sorted_vals(db:from('item i')
				:where(q.in_(c'i.id', ids17)):select{'i.id id'}, nil, 'id', true),
				{1, 2, 3, 4, 5})

			--duplicate seek values must not double-emit the same row.
			check('in dedup', vals(db:from('item i')
				:where(q.in_(c'i.id', {1, 1, 3})):select{'i.id id'}, nil, 'id', true), {1, 3})

			--a literal null inside the seek list is skipped, not seeked.
			check('in literal null skipped (seek path)', sorted_vals(db:from('item i')
				:where(q.in_(c'i.id', {1, null, 3})):select{'i.id id'}, nil, 'id', true), {1, 3})

			--a candidate that reads the same member being planned can't be
			--known before the scan runs, so it must stay a residual check,
			--not get folded into the seek.
			local plan_self = db:from('item i'):where(q.in_(c'i.id', {c'i.score'}))
				:select{'i.id id'}:explain()
			assert(plan_self.steps[1].kind ~= 'in', S{plan_self.steps[1].kind})
			check('self-referential in_ stays residual', vals(db:from('item i')
				:where(q.in_(c'i.id', {c'i.score'})):select{'i.id id'}, nil, 'id', true), {})
		end)
	end)
end

------------------------------------------------------------------------------
--FIXTURE: range -- a composite index (cat, score, extra) where the range
--column (score) isn't last, and several rows share one score value.
------------------------------------------------------------------------------

local function build_range(db)
	db:begin'w'
	db:create_table('range_item', {fields = {
		{col = 'id',    mdbx_type = 'u64',  not_null = true},
		{col = 'cat',   mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
		{col = 'score', mdbx_type = 'i32',  not_null = true},
		{col = 'extra', mdbx_type = 'u64',  not_null = true},
		{col = 'tiny',  mdbx_type = 'u8',   not_null = true},
	}, pk = {'id'}})
	db:add_index('range_item', {'cat', 'score', 'extra'})
	db:add_index('range_item', {'cat', 'tiny'})
	local rows = {
		{id = 1, cat = 'a', score = 100, extra = 1, tiny = 1},
		{id = 2, cat = 'a', score = 100, extra = 2, tiny = 2},
		{id = 3, cat = 'a', score = 100, extra = 3, tiny = 3},
		{id = 4, cat = 'a', score = 90,  extra = 1, tiny = 4},
		{id = 5, cat = 'a', score = 110, extra = 1, tiny = 255},
		{id = 6, cat = 'a', score = 110, extra = 2, tiny = 5},
	}
	for _, r in ipairs(rows) do db:insert('range_item', '{}', r) end
	db:commit()
end

function test.range_bound_exec()
	with_db(build_range, 'range_bound', function(db)
		db:atomic('r', function()
			local function ids(cond)
				return sorted_vals(db:from('range_item i'):where(q.eq(c'i.cat', 'a')):where(cond)
					:select{'i.id id'}, nil, 'id', true)
			end

			--inclusive hi at a boundary three rows share.
			check('le boundary', ids(q.le(c'i.score', 100)), {1, 2, 3, 4})
			--exclusive lo at the same boundary: score=90 excluded entirely.
			check('gt boundary', ids(q.gt(c'i.score', 90)), {1, 2, 3, 5, 6})
			--inclusive lo at the same boundary: score=90 included.
			check('ge boundary', ids(q.ge(c'i.score', 90)), {1, 2, 3, 4, 5, 6})
			--strict hi at a boundary: score=100 excluded entirely.
			check('lt boundary', ids(q.lt(c'i.score', 100)), {4})
			--exclusive lo + inclusive hi together.
			check('gt+le range', sorted_vals(db:from('range_item i'):where(q.eq(c'i.cat', 'a'))
				:where(q.gt(c'i.score', 90)):where(q.le(c'i.score', 100))
				:select{'i.id id'}, nil, 'id', true), {1, 2, 3})

			--eq_prefix: cat pinned, no fact on score at all -> scans the
			--whole cat='a' prefix.
			check('eq_prefix scan', sorted_vals(db:from('range_item i'):where(q.eq(c'i.cat', 'a'))
				:select{'i.id id'}, nil, 'id', true), {1, 2, 3, 4, 5, 6})

			--le at the max representable tiny (u8) value: incrementing the
			--last byte overflows, so increment_prefix() has no finite upper
			--bound. must not be mistaken for an empty range.
			check('le at byte-max (increment_prefix overflow)', sorted_vals(db:from('range_item i')
				:where(q.eq(c'i.cat', 'a')):where(q.le(c'i.tiny', 255)):select{'i.id id'},
				nil, 'id', true), {1, 2, 3, 4, 5, 6})
		end)
	end)
end

------------------------------------------------------------------------------
--FIXTURE: word -- ai_ci (case/accent-insensitive) collated column.
------------------------------------------------------------------------------

local function build_word(db)
	db:begin'w'
	db:create_table('word', {fields = {
		{col = 'id',   mdbx_type = 'u32',  not_null = true},
		{col = 'text', mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true,
			mdbx_collation = 'utf8_ai_ci'},
	}, pk = {'id'}})
	db:add_index('word', {'text'})
	local rows = {
		{id = 1, text = 'Cafe'},
		{id = 2, text = 'cafe'},
		{id = 3, text = 'CAFE'},
		{id = 4, text = 'latte'},
		{id = 5, text = 'LATTE'},
		{id = 6, text = 'mocha'},
	}
	for _, r in ipairs(rows) do db:insert('word', '{}', r) end
	db:commit()
end

function test.ai_ci_exec()
	with_db(build_word, 'ai_ci', function(db)
		db:atomic('r', function()
			--eq() folds both sides; the index seek result is still
			--re-verified as a residual check (never trusted outright).
			check('ai_ci eq', sorted_vals(db:from('word w'):where(q.eq(c'w.text', 'cafe'))
				:select{'w.id id'}, nil, 'id', true), {1, 2, 3})

			--starts() never drives an ai_ci index seek (always residual),
			--but still folds correctly when evaluated.
			local plan = db:from('word w'):where(q.starts(c'w.text', 'Ca'))
				:select{'w.id id'}:explain()
			assert(plan.steps[1].kind ~= 'prefix', S{plan.steps[1].kind})
			check('ai_ci starts', sorted_vals(db:from('word w'):where(q.starts(c'w.text', 'Ca'))
				:select{'w.id id'}, nil, 'id', true), {1, 2, 3})

			--in_() folds each candidate too.
			check('ai_ci in_', sorted_vals(db:from('word w')
				:where(q.in_(c'w.text', {'CAFE', 'LATTE'})):select{'w.id id'}, nil, 'id', true),
				{1, 2, 3, 4, 5})

			--order_by() with no other filter: the planner can satisfy it by
			--scanning the ai_ci index directly (which stores folded order),
			--so the sort is pushed and rows come out fold-ordered for free.
			--a relation compiles for one terminal kind only, so explain()
			--and rows() each need their own instance of the same query.
			local function mk1()
				return db:from('word w'):order_by{{c'w.text', 'asc'}}:select{'w.id id', 'w.text text'}
			end
			assert(mk1():explain().sort_pushed == true, 'expected sort_pushed for ai_ci index scan')
			check('ai_ci order pushed', vals(mk1(), nil, 'text', false),
				{'Cafe', 'cafe', 'CAFE', 'latte', 'LATTE', 'mocha'})

			--forcing away from every index: the base table stores unfolded
			--text, so natural scan order no longer proves fold order --
			--an explicit sort is required, but must still produce the same
			--fold-ordered result via order_key()'s own folding.
			local function mk2()
				return db:from('word w'):no_index('w')
					:order_by{{c'w.text', 'asc'}}:select{'w.id id', 'w.text text'}
			end
			assert(mk2():explain().sort_pushed == false,
				'expected explicit sort once the index is forbidden')
			check('ai_ci order explicit sort', vals(mk2(), nil, 'text', false),
				{'Cafe', 'cafe', 'CAFE', 'latte', 'LATTE', 'mocha'})
		end)
	end)
end

------------------------------------------------------------------------------

function test.null_semantics_exec()
	with_db(build_core, 'null_semantics', function(db)
		db:atomic('r', function()
			--comparisons with a null operand are always false -- including
			--ne(), not just eq(): id5's null score doesn't pass ne(10)
			--even though a null is, in one sense, "not 10".
			check('ne() with null operand is false, not true', sorted_vals(db:from('item i')
				:where(q.ne(c'i.score', 10)):select{'i.id id'}, nil, 'id', true), {2, 3, 4})

			--not_in() with a null probe (left side) is false, not vacuously true.
			check('not_in with null probe', vals(db:from('item i')
				:where(q.eq(c'i.cat', 'a')):where(q.not_in(c'i.score', {10, 20}))
				:select{'i.id id'}, nil, 'id', true), {}) --id5's score is null -> excluded, not kept

			--left join, unmatched right row: a plain equality filter on the
			--right side drops the row; is_null() on that field keeps it.
			local matched = sorted_vals(db:from('item i')
				:left_join('tag t', q.eq(c't.item_id', c'i.id'))
				:where(q.eq(c't.name', 'x')):select{'i.id id'}, nil, 'id', true)
			check('left join eq filter drops unmatched', matched, {1})

			local unmatched = sorted_vals(db:from('item i')
				:left_join('tag t', q.eq(c't.item_id', c'i.id'))
				:where(q.is_null(c't.name')):select{'i.id id'}, nil, 'id', true)
			check('left join is_null keeps unmatched', unmatched, {3, 4, 5})
		end)
	end)
end

function test.join_dependency_and_cycle_exec()
	with_db(build_core, 'join_dependency_and_cycle', function(db)
		db:atomic('r', function()
			--'n' is declared before 't', but n's on_expr reads t -- the
			--compiler must schedule t first regardless of call order.
			local q1 = db:from('item i')
				:join('note n', q.and_(q.eq(c'n.tag_id', c't.tag_id'), q.eq(c'n.item_id', c'i.id')))
				:join('tag t', q.eq(c't.item_id', c'i.id'))
				:select{'i.id id', 'n.body body'}
			local pairs_t = {} --{'id:body'...}
			for row in q1:rows() do
				pairs_t[#pairs_t + 1] = tonumber(row.id)..':'..row.body
			end
			table.sort(pairs_t)
			check('multi-hop join dependency', pairs_t, {'1:n1', '1:n2', '2:n3'})
		end)

		--genuine cycle: t depends on n, n depends on t.
		local ok, err = pcall(function()
			db:from('item i')
				:join('tag t', q.eq(c't.item_id', c'n.item_id'))
				:join('note n', q.eq(c'n.tag_id', c't.tag_id'))
				:select{'i.id id'}:prepare()
		end)
		assert(not ok and err:find('source step cycle', 1, true), tostring(err))
	end)
end

function test.left_join_fragment_vs_separate_exec()
	with_db(build_core, 'left_join_fragment_vs_separate', function(db)
		db:atomic('r', function()
			--note's on_expr only compares tag_id, not item_id, so tag2
			--(item 2) matches both note3 (tag_id=2) and note4 (tag_id=2,
			--the deliberately inconsistent item_id=1 row from the
			--dependency test above) -- both are real tag_id=2 matches.

			--separate left_joins: tag and note are each independently
			--optional, so item 2's tag with no matching note (tag_id=4)
			--still produces its own null-extended row.
			local q_sep = db:from('item i')
				:left_join('tag t', q.eq(c't.item_id', c'i.id'))
				:left_join('note n', q.eq(c'n.tag_id', c't.tag_id'))
				:select{'i.id id', 'n.body body'}
			local sep = {} --{'id:body'...}
			for row in q_sep:rows() do
				sep[#sep + 1] = tonumber(row.id)..':'..(row.body or 'nil')
			end
			table.sort(sep)
			check('separate left joins', sep,
				{'1:n1', '1:n2', '2:bad', '2:n3', '2:nil', '3:nil', '4:nil', '5:nil'})

			--the same two tables as one left-joined fragment: the (tag,
			--note) cluster is one atomic optional unit. item 2's tag_id=4
			--(no note) fails the fragment's *internal* inner join, so it
			--produces no row at all -- unlike the separate-joins case above.
			local frag = db:from('tag t')
				:where(q.eq(c't.item_id', c'i.id'))
				:join('note n', q.eq(c'n.tag_id', c't.tag_id'))
			local q_frag = db:from('item i')
				:left_join(frag)
				:select{'i.id id', 'n.body body'}
			local frag_t = {} --{'id:body'...}
			for row in q_frag:rows() do
				frag_t[#frag_t + 1] = tonumber(row.id)..':'..(row.body or 'nil')
			end
			table.sort(frag_t)
			check('left-joined fragment', frag_t,
				{'1:n1', '1:n2', '2:bad', '2:n3', '3:nil', '4:nil', '5:nil'})
		end)
	end)
end

function test.left_join_residual_extends_exec()
	with_db(build_core, 'left_join_residual_extends', function(db)
		db:atomic('r', function()
			--tag has no index, so this on_expr is a residual check. every
			--candidate tag row fails it (no tag is named 'nonexistent'),
			--not just "the cursor found nothing" -- the row must still
			--null-extend instead of vanishing.
			local q1 = db:from('item i')
				:left_join('tag t', q.and_(q.eq(c't.item_id', c'i.id'), q.eq(c't.name', 'nonexistent')))
				:select{'i.id id', 't.name name'}
			local rows = {} --{'id:name'...}
			for row in q1:rows() do
				rows[#rows + 1] = tonumber(row.id)..':'..(row.name or 'nil')
			end
			table.sort(rows)
			check('left join null-extends after failed residual', rows,
				{'1:nil', '2:nil', '3:nil', '4:nil', '5:nil'})
		end)
	end)
end

function test.outer_scope_exec()
	with_db(build_core, 'outer_scope', function(db)
		db:atomic('r', function()
			--skip-level outer(): the innermost exists() (over note) reads
			--i.id, skipping its immediate parent scope (tag), which has no
			--where() of its own. items with >=1 note are 1 and 2.
			local ids = sorted_vals(db:from('item i'):where(q.exists(
				db:from('tag t'):where(q.exists(
					db:from('note n'):where(q.eq(c'n.item_id', q.outer'i.id'))
				))
			)):select{'i.id id'}, nil, 'id', true)
			check('skip-level outer scope', ids, {1, 2})
		end)

		--unqualified col ambiguous across two same-shaped members.
		local ok, err = pcall(function()
			db:from('item i1'):join('item i2', true):where(q.eq(c'id', 1)):prepare'count'
		end)
		assert(not ok and err:find('ambiguous field', 1, true), tostring(err))
	end)
end

------------------------------------------------------------------------------
--FIXTURE: gitem -- composite pk (cat, id), so a plain full scan is already
--ordered by cat: grouping/distinct by cat can stream for free.
------------------------------------------------------------------------------

local function build_gitem(db)
	db:begin'w'
	db:create_table('gitem', {fields = {
		{col = 'cat', mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
		{col = 'id',  mdbx_type = 'u32',  not_null = true},
		{col = 'val', mdbx_type = 'i32',  not_null = true},
	}, pk = {'cat', 'id'}})
	local rows = {
		{cat = 'a', id = 1, val = 5},
		{cat = 'a', id = 2, val = 7},
		{cat = 'b', id = 1, val = 5}, --val=5 dup, not adjacent to the first val=5 row
		{cat = 'b', id = 2, val = 9},
		{cat = 'c', id = 1, val = 7}, --val=7 dup, not adjacent to the first val=7 row
	}
	for _, r in ipairs(rows) do db:insert('gitem', '{}', r) end
	db:commit()
end

function test.grouping_streaming_and_hash_exec()
	with_db(build_gitem, 'grouping_streaming_and_hash', function(db)
		db:atomic('r', function()
			--group by cat: cat is the leading pk column, so a plain full
			--scan is already grouped by cat -- streaming grouping applies.
			local sums = {} --{'cat:total'...}
			for row in db:from('gitem g'):group{{c'g.cat', 'cat'}, {q.sum(c'g.val'), 'total'}}
				:select{{c'cat', 'cat'}, {c'total', 'total'}}:rows() do
				sums[#sums + 1] = row.cat..':'..tonumber(row.total)
			end
			table.sort(sums)
			check('streaming group by pk-leading col', sums, {'a:12', 'b:14', 'c:7'})
		end)
	end)

	--forced hash: an 'in' plan never guarantees any order (not even by
	--pk), so grouping after it can never stream.
	with_db(build_core, 'grouping_hash_via_in_plan', function(db)
		db:atomic('r', function()
			local sums = {} --{'cat:total'...}
			for row in db:from('item i'):where(q.in_(c'i.id', {1, 2, 3, 4}))
				:group{{c'i.cat', 'cat'}, {q.sum(c'i.score'), 'total'}}
				:select{{c'cat', 'cat'}, {c'total', 'total'}}:rows() do
				sums[#sums + 1] = row.cat..':'..tonumber(row.total)
			end
			table.sort(sums)
			check('hash group forced by in-plan', sums, {'a:30', 'b:35'})

			--all-aggregate group() with zero matching rows: exactly one
			--output row, count()=0. exercise it on the same forced-hash path.
			local rows = {} --{row...}
			for row in db:from('item i'):where(q.eq(c'i.cat', 'zzz'))
				:group{{q.count(), 'n'}}:select{{c'n', 'n'}}:rows() do
				rows[#rows + 1] = row
			end
			assert(#rows == 1 and tonumber(rows[1].n) == 0,
				'expected one row with n=0, got '..#rows..' rows')
		end)
	end)

	--same zero-row all-aggregate check on the naturally-streaming path.
	with_db(build_gitem, 'grouping_streaming_zero_rows', function(db)
		db:atomic('r', function()
			local rows = {} --{row...}
			for row in db:from('gitem g'):where(q.eq(c'g.cat', 'zzz'))
				:group{{q.count(), 'n'}}:select{{c'n', 'n'}}:rows() do
				rows[#rows + 1] = row
			end
			assert(#rows == 1 and tonumber(rows[1].n) == 0,
				'expected one row with n=0, got '..#rows..' rows')
		end)
	end)
end

function test.distinct_streaming_and_hash_exec()
	with_db(build_gitem, 'distinct_streaming_and_hash', function(db)
		db:atomic('r', function()
			--distinct on cat: cat is the leading pk column, so adjacent
			--duplicates in scan order really are all the duplicates.
			check('streaming distinct on pk-leading col',
				vals(db:from('gitem g'):select{'g.cat cat'}:distinct(), nil, 'cat', false),
				{'a', 'b', 'c'})

			--distinct on val: val isn't part of the pk, so duplicates are
			--not adjacent in scan order (a hash-based dedup is required;
			--a naive adjacent-only pass would miss the val=5 and val=7
			--repeats since another row sits between each pair).
			check('hash distinct catches non-adjacent duplicates',
				sorted_vals(db:from('gitem g'):select{'g.val val'}:distinct(), nil, 'val', true),
				{5, 7, 9})
		end)
	end)
end

------------------------------------------------------------------------------
--FIXTURE: desc_item -- single-column pk stored descending.
------------------------------------------------------------------------------

local function build_desc(db)
	db:begin'w'
	db:create_table('desc_item', {fields = {
		{col = 'id',  mdbx_type = 'u32', not_null = true},
		{col = 'val', mdbx_type = 'i32', not_null = true},
	}, pk = {'id', desc = {true}}})
	db:insert('desc_item', '{}', {id = 1, val = 100})
	db:insert('desc_item', '{}', {id = 2, val = 200})
	db:insert('desc_item', '{}', {id = 3, val = 300})
	db:commit()
end

function test.order_by_desc_pushdown_exec()
	with_db(build_desc, 'order_by_desc_pushdown', function(db)
		db:atomic('r', function()
			--matching direction: the pk is already stored descending, so a
			--plain forward scan comes out in the requested order for free.
			--a relation compiles for one terminal kind only, so explain()
			--and rows() each need their own instance of the same query.
			local function mk_desc()
				return db:from('desc_item d'):order_by{{c'd.id', 'desc'}}:select{'d.id id'}
			end
			assert(mk_desc():explain().sort_pushed == true, 'expected desc order to be pushed')
			check('desc pushdown order', vals(mk_desc(), nil, 'id', true), {3, 2, 1})

			--opposite direction: the stored order can't satisfy it, so an
			--explicit sort is required -- but must still come out correct.
			local function mk_asc()
				return db:from('desc_item d'):order_by{{c'd.id', 'asc'}}:select{'d.id id'}
			end
			assert(mk_asc():explain().sort_pushed == false, 'expected asc order to require an explicit sort')
			check('asc requires explicit sort', vals(mk_asc(), nil, 'id', true), {1, 2, 3})
		end)
	end)
end

function test.order_by_limit_priority_exec()
	with_db(build_core, 'order_by_limit_priority', function(db)
		db:atomic('r', function()
			--exact full-key match on item/cat,score (both columns pinned):
			--even with order_by()+limit() active, the exact seek must win
			--over any order-preferring alternative.
			local function mk_exact()
				return db:from('item i')
					:where(q.eq(c'i.cat', 'a')):where(q.eq(c'i.score', 10))
					:order_by{{c'i.id', 'asc'}}:limit(5):select{'i.id id'}
			end
			local plan_exact = mk_exact():explain()
			assert(plan_exact.steps[1].kind == 'exact', S{plan_exact.steps[1].kind})
			check('exact seek wins over order preference', vals(mk_exact(), nil, 'id', true), {1})

			--no competing fact on score: order_by(score)+limit(2) pushes
			--the scan through item/cat,score in score order. score is
			--nullable, and null sorts first on asc, so id5 (null score)
			--comes before id1 (10) even though id1 was inserted first.
			local q_ord = db:from('item i'):where(q.eq(c'i.cat', 'a'))
				:order_by{{c'i.score', 'asc'}}:limit(2):select{'i.id id'}
			check('order+limit pushdown with null-first', vals(q_ord, nil, 'id', true), {5, 1})
		end)
	end)
end

function test.order_by_partial_coverage_exec()
	with_db(build_core, 'order_by_partial_coverage', function(db)
		db:atomic('r', function()
			--order_by() on more columns than any candidate key can supply
			--(id has no relation to cat/score ordering) must fall back to
			--an explicit sort rather than silently returning scan order.
			local function mk1()
				return db:from('item i'):where(q.eq(c'i.cat', 'a'))
					:order_by{{c'i.score', 'asc'}, {c'i.id', 'desc'}}:select{'i.id id'}
			end
			assert(mk1():explain().sort_pushed == false, 'expected an explicit sort')
			--score asc (null first) decides the order; id desc only breaks
			--ties on equal scores, and 10 vs 20 aren't tied.
			check('partial order coverage falls back to sort', vals(mk1(), nil, 'id', true), {5, 1, 2})
		end)
	end)
end

function test.limit_offset_compose_exec()
	with_db(build_core, 'limit_offset_compose', function(db)
		db:atomic('r', function()
			--query-level limit(n, offset) composed with a terminal cap
			--(first() asks collect_rows() for 1 row).
			local q1 = db:from('item i'):order_by{{c'i.id', 'asc'}}:limit(2, 1):select{'i.id id'}
			local row = q1:first()
			assert(tonumber(row.id) == 2, 'expected id=2, got '..tostring(row and row.id))

			--order_by() needing an explicit sort must still respect
			--limit()+offset() correctly (sort happens before the cut).
			local q2 = db:from('item i'):where(q.eq(c'i.cat', 'a'))
				:order_by{{c'i.score', 'asc'}}:limit(1, 1):select{'i.id id'}
			check('sorted limit+offset', vals(q2, nil, 'id', true), {1}) --after id5(null), next is id1(10)
		end)
	end)
end

function test.use_index_hint_exec()
	with_db(build_core, 'use_index_hint', function(db)
		db:atomic('r', function()
			--force the weaker single-column index (item/cat); the score
			--filter can't be proven by it and must survive as a residual
			--check, but the result must still be correct.
			local function mk1()
				return db:from('item i')
					:where(q.eq(c'i.cat', 'a')):where(q.eq(c'i.score', 10))
					:use_index('i', 'item/cat')
					:select{'i.id id'}
			end
			local plan1 = mk1():explain()
			assert(plan1.steps[1].scan == 'item/cat', S{plan1.steps[1].scan})
			assert(plan1.steps[1].row_checks >= 1, 'expected a residual row check')
			check('forced weaker index still correct', vals(mk1(), nil, 'id', true), {1})

			--force the same index for an order_by() that it satisfies
			--(item/cat,score, ordered by score) vs one it does not
			--(ordered by id, which isn't part of that index at all).
			local q2 = db:from('item i'):use_index('i', 'item/cat,score')
				:where(q.eq(c'i.cat', 'a')):order_by{{c'i.score', 'asc'}}:select{'i.id id'}
			assert(q2:explain().sort_pushed == true,
				'expected the forced index to satisfy order_by(score)')

			local function mk3()
				return db:from('item i'):use_index('i', 'item/cat,score')
					:where(q.eq(c'i.cat', 'a')):order_by{{c'i.id', 'asc'}}:select{'i.id id'}
			end
			assert(mk3():explain().sort_pushed == false,
				'expected the forced index to not satisfy order_by(id)')
			check('forced index order results still correct',
				sorted_vals(mk3(), nil, 'id', true), {1, 2, 5})
		end)
	end)
end

function test.params_exec()
	with_db(build_core, 'params', function(db)
		db:atomic('r', function()
			--missing param raises.
			local ok, err = pcall(function()
				db:from('item i'):where(q.eq(c'i.score', p'MIN')):select{'i.id id'}:rows()
			end)
			assert(not ok, 'expected missing param to raise')

			--a param explicitly bound to the null sentinel behaves as null:
			--comparisons against it are false, is_null() against it is true.
			check('null-valued param in comparison', vals(db:from('item i')
				:where(q.eq(c'i.score', p'V')):select{'i.id id'}, {V = null}, 'id', true), {})
			check('null-valued param with is_null', sorted_vals(db:from('item i')
				:where(q.is_null(p'V')):select{'i.id id'}, {V = null}, 'id', true), {1, 2, 3, 4, 5})

			--in_()/not_in() with a param-bound list: null entries in the
			--runtime list are filtered out, same as a literal list.
			check('in_ with param list, null filtered', sorted_vals(db:from('item i')
				:where(q.in_(c'i.score', p'LIST')):select{'i.id id'},
				{LIST = {10, null, 30}}, 'id', true), {1, 3})
		end)
	end)
end

------------------------------------------------------------------------------

local name = ...
if name == 'mdbx_query_test' then name = nil end
local tests = name and {name} or test
local n_ok, n_fail = 0, 0
for _, k in ipairs(tests) do
	io.write('test.'..k..' ... ')
	io.flush()
	local ok, err = xpcall(test[k], debug.traceback)
	if ok then
		print'ok'
		n_ok = n_ok + 1
	else
		print'FAILED'
		print(err)
		n_fail = n_fail + 1
		break
	end
end
print(('ok: %d, failed: %d'):format(n_ok, n_fail))
if n_fail > 0 then os.exit(1) end
