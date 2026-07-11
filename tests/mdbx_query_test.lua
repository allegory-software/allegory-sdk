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

			--a same-column equality disjunction is rewritten to one in plan,
			--so it uses the repeated-seek executor rather than a residual or.
			local function or_rel()
				return db:from('item i')
					:where(q.or_(q.eq(c'i.id', 1), q.eq(c'i.id', 3)))
					:select{'i.id id'}
			end
			assert(or_rel():explain().steps[1].kind == 'in', 'expected or() to use an in plan')
			check('or equality rewrite', vals(or_rel(), nil, 'id', true), {1, 3})

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

function test.union_materialization_exec()
	with_db(build_core, 'union_materialization', function(db)
		db:atomic('r', function()
			local function union_ids()
				local a = db:from('item i'):where(q.in_(c'i.id', {1, 2}))
					:select{'i.id id'}
				local b = db:from('item i'):where(q.in_(c'i.id', {2, 3}))
					:select{'i.id id'}
				return a:union(b)
			end

			check('union keeps duplicate rows', vals(union_ids(), nil, 'id', true), {1, 2, 2, 3})

			local set = db:from(union_ids(), 'u')
				:select{'u.id id'}
				:distinct()
				:order_by{{c'id', 'desc'}}
				:limit(2)
			check('union relation materializes before distinct sort limit',
				vals(set, nil, 'id', true), {3, 2})

			local members = db:from('item i')
				:where(q.in_(c'i.id', union_ids()))
				:select{'i.id id'}
			check('in_ reads union rows', vals(members, nil, 'id', true), {1, 2, 3})
		end)
	end)
end

function test.relation_exists_and_terminals_exec()
	with_db(build_core, 'relation_exists_and_terminals', function(db)
		db:atomic('r', function()
			local function union_for_exists()
				local empty = db:from('item i'):where(q.eq(c'i.id', 99)):select{'i.id id'}
				local found = db:from('item i'):where(q.eq(c'i.id', 2)):select{'i.id id'}
				return empty:union(found)
			end
			check('relation exists scans later union input', vals(db:from('item i')
				:where(q.exists(union_for_exists())):select{'i.id id'}, nil, 'id', true),
				{1, 2, 3, 4, 5})
			assert(union_for_exists():exists(), 'union exists() must scan past an empty first input')

			local function empty_groups()
				return db:from('tag t'):where(q.eq(c't.name', 'missing'))
					:group{{q.count(), 'n'}}
					:having(q.gt(c'n', 0))
			end
			check('relation exists finishes grouped input before testing it', vals(db:from('item i')
				:where(q.exists(empty_groups())):select{'i.id id'}, nil, 'id', true), {})
			assert(not empty_groups():exists(), 'group exists() must apply having()')

			local function count_union()
				local a = db:from('item i'):where(q.eq(c'i.id', 1)):select{'i.id id'}
				local b = db:from('item i'):where(q.in_(c'i.id', {2, 3})):select{'i.id id'}
				return a:union(b)
			end
			assert(count_union():count() == 3, 'union count() must sum input counts')

			local grouped = db:from('item i')
				:group{{c'i.cat', 'cat'}, {q.count(), 'n'}}
				:having(q.gt(c'n', 2))
			assert(grouped:count() == 1, 'group count() must count rows after having()')

			local distinct = db:from('item i')
				:left_join('tag t', q.eq(c't.item_id', c'i.id'))
				:select{'i.id id'}
				:distinct()
			assert(distinct:count() == 5, 'distinct count() must count deduped rows')
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
		{col = 'id',    mdbx_type = 'u32',  not_null = true},
		{col = 'cat',   mdbx_type = 'utf8', maxlen = 4, nozero = true, not_null = true},
		{col = 'score', mdbx_type = 'i32',  not_null = true},
		{col = 'extra', mdbx_type = 'u32',  not_null = true},
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

			--a relation candidate list has the same null rule as a literal
			--list. item 5 contributes the nil candidate through score.
			local function score_values()
				return db:from('item j'):select{'j.score score'}
			end
			check('in_ relation ignores null candidate', vals(db:from('item i')
				:where(q.in_(c'i.id', score_values())):select{'i.id id'}, nil, 'id', true), {5})
			check('not_in relation ignores null candidate', vals(db:from('item i')
				:where(q.not_in(c'i.id', score_values())):select{'i.id id'}, nil, 'id', true),
				{1, 2, 3, 4})

			--this cannot become an in plan because its first arm is an and.
			--it stays one residual condition and exercises nested or/and eval.
			local residual_or = db:from('item i')
				:where(q.or_(
					q.and_(q.eq(c'i.cat', 'a'), q.eq(c'i.score', 10)),
					q.eq(c'i.id', 3)
				))
				:select{'i.id id'}
			check('residual nested or and', vals(residual_or, nil, 'id', true), {1, 3})

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

function test.table_exists_strategy_exec()
	with_db(build_core, 'table_exists_strategy', function(db)
		db:atomic('r', function()
			local function matching_items(op)
				return db:from('item i'):where(op('item j', q.and_(
					q.eq(c'j.cat', c'i.cat'),
					q.eq(c'j.score', 20),
					q.eq(c'j.label', 'beta')
				))):select{'i.id id'}
			end

			local has_match = matching_items(q.exists)
			check('indexed exists with residual', vals(has_match, nil, 'id', true), {1, 2, 5})
			local source = has_match.wheres[1][2]
			assert(source.exists_plan.kind == 'exact'
				and source.exists_plan.schema.is_index
				and #source.exists_plan.residual == 1,
				'expected an indexed exact seek with one residual')

			check('indexed not_exists with residual', vals(matching_items(q.not_exists), nil, 'id', true),
				{3, 4})

			--relation-form exists() runs the inner relation with i's decoder as
			--its parent scope, so j.cat and j.score can form an exact inner seek.
			local inner = db:from('item j'):where(q.and_(
				q.eq(c'j.cat', c'i.cat'),
				q.eq(c'j.score', 20)
			))
			local relation_exists = db:from('item i')
				:where(q.exists(inner))
				:select{'i.id id'}
			check('correlated relation exists indexed seek',
				vals(relation_exists, nil, 'id', true), {1, 2, 5})
			assert(inner.access[1].plan.kind == 'exact' and inner.access[1].plan.schema.is_index,
				'expected relation exists() to use an inner indexed exact seek')

			--having() evaluates after run_filtered() returns, so this checks
			--that table exists sources stay open through group finalization.
			local grouped = db:from('item i')
				:group{{c'i.cat', 'cat'}, {q.count(), 'n'}}
				:having(q.exists('tag t', q.eq(c't.name', 'x')))
				:select{{c'cat', 'cat'}}
			check('exists in having', sorted_vals(grouped, nil, 'cat', false), {'a', 'b'})
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
			for row in q1:rows'{}' do
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

function test.indexed_join_seek_exec()
	with_db(build_core, 'indexed_join_seek', function(db)
		db:atomic('r', function()
			--j reads both seek values from i. item 5's nil score must skip
			--the exact seek and become the left join's null-extended row.
			local rel = db:from('item i')
				:left_join('item j', q.and_(
					q.eq(c'j.cat', c'i.cat'),
					q.eq(c'j.score', c'i.score')
				))
				:select{'i.id id', 'j.id match_id'}
			rel:prepare()
			local plan = rel.access[2].plan
			assert(plan.kind == 'exact' and plan.schema.is_index,
				'expected the joined item to use an indexed exact seek')
			local pairs = {} --{'id:match_id'...}
			for row in rel:rows'{}' do
				pairs[#pairs + 1] = tonumber(row.id)..':'..(row.match_id and tonumber(row.match_id) or 'nil')
			end
			check('indexed join seek and null extension', pairs,
				{'1:1', '2:2', '3:3', '4:4', '5:nil'})
		end)
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
			for row in q_sep:rows'{}' do
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
				for row in q_frag:rows'{}' do
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
				for row in q1:rows'{}' do
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

function test.relation_exists_alias_exec()
	with_db(build_core, 'relation_exists_alias', function(db)
		db:atomic('r', function()
			local tag_counts = db:from('tag t')
				:group{
					{c't.item_id', 'item_id'},
					{q.count(), 'n'},
				}
			local grouped = db:from('item i')
				:where(q.exists(tag_counts, 'tc', q.and_(
					q.eq(c'tc.item_id', c'i.id'),
					q.ge(c'tc.n', 2)
				)))
				:select{'i.id id'}
			check('exists() aliased relation output', sorted_vals(grouped, nil, 'id', true), {1, 2})

			local function tag_items()
				return db:from('tag t'):select{'t.item_id item_id'}
			end
			local semi = db:from('item i')
				:semi_join(tag_items(), 'tags', q.eq(c'tags.item_id', c'i.id'))
				:select{'i.id id'}
			check('semi_join() aliased relation', sorted_vals(semi, nil, 'id', true), {1, 2})

			local anti = db:from('item i')
				:anti_join(tag_items(), 'tags', q.eq(c'tags.item_id', c'i.id'))
				:select{'i.id id'}
			check('anti_join() aliased relation', sorted_vals(anti, nil, 'id', true), {3, 4, 5})

			local joined = db:from('item i')
				:join(tag_items(), 'tags', q.eq(c'tags.item_id', c'i.id'))
				:select{'i.id id'}
			check('inner join scans aliased relation rows', vals(joined, nil, 'id', true), {1, 1, 2, 2})

			local function x_items()
				return db:from('tag t'):where(q.eq(c't.name', 'x'))
					:select{'t.item_id item_id'}
			end
			local left = db:from('item i')
				:left_join(x_items(), 'tags', q.eq(c'tags.item_id', c'i.id'))
				:select{'i.id id', 'tags.item_id tag_item_id'}
			local pairs = {} --{'item_id:tag_item_id'...}
			for row in left:rows'{}' do
				pairs[#pairs + 1] = tonumber(row.id)..':'..(row.tag_item_id and tonumber(row.tag_item_id) or 'nil')
			end
			check('left join null-extends aliased relation rows', pairs,
				{'1:1', '2:nil', '3:nil', '4:nil', '5:nil'})
		end)
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
					:select{{c'cat', 'cat'}, {c'total', 'total'}}:rows'{}' do
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
					:select{{c'cat', 'cat'}, {c'total', 'total'}}:rows'{}' do
				sums[#sums + 1] = row.cat..':'..tonumber(row.total)
			end
			table.sort(sums)
			check('hash group forced by in-plan', sums, {'a:30', 'b:35'})

			--all-aggregate group() with zero matching rows: exactly one
			--output row, count()=0. exercise it on the same forced-hash path.
			local rows = {} --{row...}
			for row in db:from('item i'):where(q.eq(c'i.cat', 'zzz'))
					:group{{q.count(), 'n'}}:select{{c'n', 'n'}}:rows'{}' do
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
					:group{{q.count(), 'n'}}:select{{c'n', 'n'}}:rows'{}' do
				rows[#rows + 1] = row
			end
			assert(#rows == 1 and tonumber(rows[1].n) == 0,
				'expected one row with n=0, got '..#rows..' rows')
		end)
	end)
end

function test.aggregate_having_sort_exec()
	with_db(build_core, 'aggregate_having_sort', function(db)
		db:atomic('r', function()
			--there is no group-key access hint when aggregates are present, so
			--item's pk scan forces hash grouping. order_by() then sorts the
			--finished group rows by an aggregate output.
			local summaries = db:from('item i')
				:group{
					{c'i.cat', 'cat'},
					{q.count(), 'n'},
					{q.count(c'i.score'), 'n_score'},
					{q.min(c'i.score'), 'min_score'},
					{q.max(c'i.score'), 'max_score'},
					{q.sum(c'i.score'), 'total'},
					{q.avg(c'i.score'), 'average'},
				}
				:select{
					{c'cat', 'cat'},
					{c'n', 'n'},
					{c'n_score', 'n_score'},
					{c'min_score', 'min_score'},
					{c'max_score', 'max_score'},
					{c'total', 'total'},
					{c'average', 'average'},
				}
				:order_by{{c'total', 'desc'}, {c'cat', 'asc'}}
			local got = {} --{summary...}
			for row in summaries:rows'{}' do
				got[#got + 1] = row.cat..':'..tonumber(row.n)..':'..tonumber(row.n_score)
					..':'..tonumber(row.min_score)..':'..tonumber(row.max_score)
					..':'..tonumber(row.total)..':'..tonumber(row.average)
			end
			check('hash group aggregates and sort', got, {'b:2:2:5:30:35:17.5', 'a:3:2:10:20:30:15'})

			local filtered = db:from('item i')
				:group{{c'i.cat', 'cat'}, {q.count(), 'n'}}
				:having(q.gt(c'n', 2))
				:select{{c'cat', 'cat'}}
			check('having rejects finished groups', vals(filtered, nil, 'cat', false), {'a'})
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

	with_db(build_core, 'distinct_hash_tuple', function(db)
		db:atomic('r', function()
			--the join repeats item 1 and item 2, while item 5 contributes a
			--nil score. two returned fields force hash_dedup_rows() through
			--its tuple-space path instead of the single-value table-key path.
			local rel = db:from('item i')
				:left_join('tag t', q.eq(c't.item_id', c'i.id'))
				:select{'i.cat cat', 'i.score score'}
				:distinct()
			local got = {} --{pair...}
			for row in rel:rows'{}' do
				got[#got + 1] = row.cat..':'..(row.score and tonumber(row.score) or 'nil')
			end
			table.sort(got)
			check('hash distinct pairs with nil', got, {'a:10', 'a:20', 'a:nil', 'b:30', 'b:5'})
		end)
	end)
end

------------------------------------------------------------------------------
--FIXTURE: dup -- an index with fixed-size duplicate primary keys.
------------------------------------------------------------------------------

local function build_dup(db)
	db:begin'w'
	db:create_table('dup', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
		{col = 'k',  mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:add_index('dup', {'k'})
	for id, k in ipairs({1, 1, 1, 1, 2, 2}) do
		db:insert('dup', '{}', {id = id, k = k})
	end
	db:commit()
end

function test.duplicate_index_paths_exec()
	with_db(build_dup, 'duplicate_index_paths', function(db)
		db:atomic('r', function()
			local function matching()
				return db:from('dup d'):where(q.eq(c'd.k', 1)):select{'d.id id'}
			end

			local bulk = matching()
			bulk:prepare()
			assert(bulk.access[1].plan.schema.is_index and bulk.access[1].plan.schema.dup_fixedsize,
				'expected the duplicate index to use fixed-size duplicate values')
			check('DUPFIXED bulk walk', vals(bulk, nil, 'id', true), {1, 2, 3, 4})

			local old = MDBX_NODUPFIXED
			MDBX_NODUPFIXED = true
			local one_at_a_time = matching()
			one_at_a_time:prepare()
			check('DUPFIXED fallback walk', vals(one_at_a_time, nil, 'id', true), {1, 2, 3, 4})
			MDBX_NODUPFIXED = old

			local function keys_in()
				return db:from('dup d'):where(q.in_(c'd.k', {1, 1, 2})):select{'d.id id'}
			end
			assert(keys_in():explain().steps[1].kind == 'in', 'expected an index in plan')
			check('in plan dedups duplicate non-unique keys', vals(keys_in(), nil, 'id', true),
				{1, 2, 3, 4, 5, 6})

			local function distinct_keys()
				return db:from('dup d'):select{'d.k k'}:distinct()
			end

			local skipped = distinct_keys()
			skipped:prepare()
			assert(skipped.access[1].plan.next_nodup,
				'expected distinct(k) to skip duplicate index groups')
			check('NEXT_NODUP distinct walk', vals(skipped, nil, 'k', true), {1, 2})

			old = MDBX_NO_NEXT_NODUP
			MDBX_NO_NEXT_NODUP = true
			local all_dups = distinct_keys()
			all_dups:prepare()
			assert(not all_dups.access[1].plan.next_nodup,
				'expected the bench override to keep duplicate index rows visible')
			check('NEXT_NODUP fallback walk', vals(all_dups, nil, 'k', true), {1, 2})
			MDBX_NO_NEXT_NODUP = old

			local grouped = db:from('dup d'):group{{c'd.k', 'k'}}
			grouped:prepare()
			assert(grouped.access[1].plan.next_nodup,
				'expected group(k) without aggregates to skip duplicate index groups')
			check('group without aggregates skips duplicate index groups',
				vals(grouped, nil, 'k', true), {1, 2})
		end)
	end)
end

------------------------------------------------------------------------------
--FIXTURE: parent/child -- child.parent_id has the FK-owned index.
------------------------------------------------------------------------------

local function build_fk(db)
	db:begin'w'
	db:create_table('parent', {fields = {
		{col = 'id', mdbx_type = 'u32', not_null = true},
	}, pk = {'id'}})
	db:create_table('child', {fields = {
		{col = 'id',        mdbx_type = 'u32',  not_null = true},
		{col = 'parent_id', mdbx_type = 'u32',  not_null = true},
		{col = 'kind',      mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
	}, pk = {'id'}})
	for _, row in ipairs{{id = 1}, {id = 2}, {id = 3}} do
		db:insert('parent', '{}', row)
	end
	for _, row in ipairs{
		{id = 11, parent_id = 1, kind = 'x'},
		{id = 12, parent_id = 1, kind = 'y'},
		{id = 13, parent_id = 2, kind = 'x'},
	} do
		db:insert('child', '{}', row)
	end
	db:add_fk{
		table = 'child',
		cols = {'parent_id'},
		ref_table = 'parent',
		ref_cols = {'id'},
	}
	db:commit()
end

function test.fk_paths_exec()
	with_db(build_fk, 'fk_paths', function(db)
		db:atomic('r', function()
			local parent_to_child = db:from('parent p')
				:fk_join('child c')
				:select{'p.id parent_id', 'c.id child_id'}
			local pairs = {} --{'parent_id:child_id'...}
			for row in parent_to_child:rows'{}' do
				pairs[#pairs + 1] = tonumber(row.parent_id)..':'..tonumber(row.child_id)
			end
			check('fk_join parent to child', pairs, {'1:11', '1:12', '2:13'})

			local child_to_parent = db:from('child c')
				:fk_join('parent p')
				:select{'c.id child_id', 'p.id parent_id'}
			pairs = {}
			for row in child_to_parent:rows'{}' do
				pairs[#pairs + 1] = tonumber(row.child_id)..':'..tonumber(row.parent_id)
			end
			check('fk_join child to parent', pairs, {'11:1', '12:1', '13:2'})

			local left = db:from('parent p')
				:fk_left_join('child c')
				:select{'p.id parent_id', 'c.id child_id'}
			pairs = {}
			for row in left:rows'{}' do
				pairs[#pairs + 1] = tonumber(row.parent_id)..':'..(row.child_id and tonumber(row.child_id) or 'nil')
			end
			check('fk_left_join parent to child', pairs, {'1:11', '1:12', '2:13', '3:nil'})

			local has_kind_x = db:from('parent p')
				:where_has('child c', q.eq(c'c.kind', 'x'))
				:select{'p.id id'}
			check('where_has fk and filter', vals(has_kind_x, nil, 'id', true), {1, 2})

			local lacks_kind_x = db:from('parent p')
				:where_hasnt('child c', q.eq(c'c.kind', 'x'))
				:select{'p.id id'}
			check('where_hasnt fk and filter', vals(lacks_kind_x, nil, 'id', true), {3})
		end)
	end)
end

------------------------------------------------------------------------------
--FIXTURE: group_key -- two different pairs that collided through '\1'.
------------------------------------------------------------------------------

local function build_group_key(db)
	db:begin'w'
	db:create_table('group_key', {fields = {
		{col = 'id', mdbx_type = 'u32',  not_null = true},
		{col = 'a',  mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
		{col = 'b',  mdbx_type = 'utf8', maxlen = 8, nozero = true, not_null = true},
	}, pk = {'id'}})
	local sep = string.char(1)
	db:insert('group_key', '{}', {id = 1, a = 'a'..sep..'b', b = 'c'})
	db:insert('group_key', '{}', {id = 2, a = 'a', b = 'b'..sep..'c'})
	db:commit()
end

function test.hash_group_key_collision_exec()
	with_db(build_group_key, 'hash_group_key_collision', function(db)
		db:atomic('r', function()
			--the primary-key scan does not group a and b, so this takes the
			--hash path. the two pairs used to both stringify as a\1b\1c.
			local rel = db:from('group_key g')
				:group{{c'g.a', 'a'}, {c'g.b', 'b'}}
			local sep = string.char(1)
			local pairs = {} --{'a:b'...}
			for row in rel:rows'{}' do
				pairs[#pairs + 1] = row.a..':'..row.b
			end
			table.sort(pairs)
			check('hash group keeps control-byte pairs separate', pairs,
				{'a'..sep..'b'..':'..'c', 'a'..':'..'b'..sep..'c'})
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

			--opposite direction: the stored order is exactly backward for
			--this request, so the scan walks MDBX_PREV from MDBX_LAST
			--instead of MDBX_NEXT from MDBX_FIRST -- still no explicit sort.
			local function mk_asc()
				return db:from('desc_item d'):order_by{{c'd.id', 'asc'}}:select{'d.id id'}
			end
			assert(mk_asc():explain().sort_pushed == true, 'expected asc order to be pushed via backward scan')
			check('asc pushdown via backward scan', vals(mk_asc(), nil, 'id', true), {1, 2, 3})
		end)
	end)
end

function test.order_by_desc_eq_prefix_pushdown_exec()
	with_db(build_core, 'order_by_desc_eq_prefix_pushdown', function(db)
		db:atomic('r', function()
			--item/cat,score is stored ascending: cat='a' pins the leading
			--column (eq_prefix, depth=1), score is left varying. order_by()
			--score desc is the reverse of that stored order, so the scan
			--seeks to the end of the cat='a' group (MDBX_TO_KEY_LESSER_OR_EQUAL)
			--and walks MDBX_PREV -- still no explicit sort.
			--item/cat alone would satisfy cat='a' with a plain 'exact' seek
			--(and win over eq_prefix on selectivity), so force the composite
			--index to exercise the eq_prefix desc path.
			local function mk()
				return db:from('item i'):use_index('i', 'item/cat,score')
					:where(q.eq(c'i.cat', 'a'))
					:order_by{{c'i.score', 'desc'}}:select{'i.id id'}
			end
			local plan = mk():explain()
			assert(plan.steps[1].kind == 'eq_prefix', S{plan.steps[1].kind})
			assert(plan.sort_pushed == true, 'expected desc order to be pushed via backward scan')
			--score desc, null last: id2 (20), id1 (10), id5 (null).
			check('eq_prefix desc pushdown', vals(mk(), nil, 'id', true), {2, 1, 5})
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

			--alpha occurs twice, so the explicit sorter must reach the second
			--term and reverse those two ids while still placing nil first.
			local function mk2()
				return db:from('item i')
					:order_by{{c'i.label', 'asc'}, {c'i.id', 'desc'}}
					:select{'i.id id'}
			end
			assert(mk2():explain().sort_pushed == false, 'expected a two-key explicit sort')
			check('explicit sort uses later tie keys', vals(mk2(), nil, 'id', true), {3, 4, 1, 2, 5})

			--the sort key comes from a joined member, so it cannot use the
			--base scan order. order_key() must still read it before row_ctx
			--goes away, without adding it to the returned row.
			local function joined_order()
				return db:from('item i')
					:join('tag t', q.eq(c't.item_id', c'i.id'))
					:select{'i.id id'}
					:order_by{{c't.name', 'asc'}, {c'i.id', 'desc'}}
			end
			assert(not joined_order():explain().sort_pushed,
				'joined sort key must require explicit sorting')
			local ids = {} --{id...}
			for row in joined_order():rows'{}' do
				assert(row.name == nil, 'unselected joined sort field leaked into output')
				ids[#ids + 1] = tonumber(row.id)
			end
			check('sort by unselected joined field', ids, {2, 1, 2, 1})
		end)
	end)
end

function test.limit_offset_compose_exec()
	with_db(build_core, 'limit_offset_compose', function(db)
		db:atomic('r', function()
			--query-level limit(n, offset) composed with a terminal cap
			--(first() asks rows_array() for 1 row).
			local q1 = db:from('item i'):order_by{{c'i.id', 'asc'}}:limit(2, 1):select{'i.id id'}
			local row = q1:first'{}'
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
--FIXTURE: compile -- post, comment, tag, ban.
--empty tables: these tests exercise the query builder's parsing, binding,
--and validation, not row results.
------------------------------------------------------------------------------

local function build_compile(db)
	db:begin'w'
	db:create_table('post', {fields = {
		{col = 'id',         mdbx_type = 'u32',  not_null = true},
		{col = 'status',     mdbx_type = 'utf8', maxlen = 16, nozero = true, not_null = true},
		{col = 'score',      mdbx_type = 'i32'},
		{col = 'title',      mdbx_type = 'utf8', maxlen = 32, nozero = true},
		{col = 'deleted_at', mdbx_type = 'u32'},
	}, pk = {'id'}})
	db:create_table('comment', {fields = {
		{col = 'id',      mdbx_type = 'u32', not_null = true},
		{col = 'post_id', mdbx_type = 'u32'},
	}, pk = {'id'}})
	db:create_table('tag', {fields = {
		{col = 'id',      mdbx_type = 'u32', not_null = true},
		{col = 'post_id', mdbx_type = 'u32'},
	}, pk = {'id'}})
	db:create_table('ban', {fields = {
		{col = 'post_id', mdbx_type = 'u32', not_null = true},
	}, pk = {'post_id'}})
	db:commit()
end

------------------------------------------------------------------------------

function test.query_builder_compile_exec()
	with_db(build_compile, 'query_builder_compile', function(db)
		db:atomic('r', function()
			local r = db:from('post p')
				:join('comment c', q.eq(c'c.post_id', c'p.id'))
				:left_join('tag pt', q.eq(c'pt.post_id', c'p.id'))
				:where(q.and_(
					q.eq(c'p.status', p'STATUS'),
					q.ne(c'p.status', 'banned'),
					q.lt(c'p.score', 1000),
					q.le(c'p.score', 999),
					q.gt(c'p.score', 0),
					q.ge(c'p.score', p'MIN_SCORE'),
					q.is_not_null(c'p.title'),
					q.starts(c'p.title', 'A'),
					q.in_(c'p.status', {'draft', 'live'}),
					q.not_in(c'p.status', {'deleted'}),
					q.or_(q.is_null(c'p.deleted_at'), q.eq(c'p.deleted_at', p'ASOF')),
					q.exists('comment c2', q.eq(c'c2.post_id', q.outer'p.id')),
					q.not_exists('tag t2b', q.eq(c't2b.post_id', c'p.id'))
				))
				:group{
					{c'p.status', 'status'},
					{q.count(), 'n'},
					{q.count(c'p.id'), 'n_ids'},
					{q.min(c'p.score'), 'min_score'},
					{q.max(c'p.score'), 'max_score'},
					{q.sum(c'p.score'), 'total_score'},
					{q.avg(c'p.score'), 'avg_score'},
				}
				:having(q.gt(c'n', 0))
				:select{
					{c'status', 'status'},
					{c'n', 'n'},
				}
				:distinct()
				:order_by{{c'n', 'desc'}}
				:limit(50, 10)
				:use_index('p', 'ix_status')
				:no_index('p', 'ix_old')

			assert(r.source.kind == 'table' and r.source.table == 'post' and r.source.alias == 'p',
				'table specs must parse on relation sources')
			local comment_join = r.joins[1]
			local tag_join = r.joins[2]
			assert(comment_join.right.kind == 'table' and comment_join.right.table == 'comment'
				and comment_join.right.alias == 'c', 'table specs must parse on joins')
			assert(tag_join.right.table == 'tag' and tag_join.right.alias == 'pt'
				and tag_join.alias == nil, 'table join aliases must be inline')

			local ok, err = pcall(function()
				db:from('post p', 'p2')
			end)
			assert(not ok and err:find('table alias must be inline', 1, true),
				'base table source aliases must be inline')
			ok, err = pcall(function()
				db:from('post p'):join('comment c', 'c2', true)
			end)
			assert(not ok and err:find('table alias must be inline', 1, true),
				'join table source aliases must be inline')
			ok, err = pcall(function()
				q.exists('comment c', 'c2', true)
			end)
			assert(not ok and err:find('table alias must be inline', 1, true),
				'exists() table source aliases must be inline')
			ok, err = pcall(function()
				q.not_exists('comment c', 'c2', true)
			end)
			assert(not ok and err:find('table alias must be inline', 1, true),
				'not_exists() table source aliases must be inline')

			local r3 = db:from('post p')
				:select{'p.id id', 'p.title'}
			local select_outputs = r3.select_outputs
			local id_output = select_outputs[1]
			local title_output = select_outputs[2]
			local id_expr, id_name = unpack(id_output, 1, 2)
			local id_op, id_member, id_col = unpack(id_expr, 1, 3)
			local title_expr, title_name = unpack(title_output, 1, 2)
			local title_op, _, title_col = unpack(title_expr, 1, 3)
			assert(id_op == 'col' and id_member == 'p' and id_col == 'id' and id_name == 'id',
				'select strings must parse explicit aliases')
			assert(title_op == 'col' and title_col == 'title' and title_name == 'title',
				'select strings must default names to columns')

			local sugar = db:from('post p')
				:cross_join('tag t')
				:semi_join('comment c', q.eq(c'c.post_id', c'p.id'))
				:anti_join('ban b', q.eq(c'b.post_id', c'p.id'))
				:where(q.between(c'p.score', 10, 20))
			local sugar_join = sugar.joins[1]
			local exists_where = sugar.wheres[1]
			local not_exists_where = sugar.wheres[2]
			local between_where = sugar.wheres[3]
			local exists_op, exists_right = unpack(exists_where, 1, 2)
			local not_exists_op, not_exists_right = unpack(not_exists_where, 1, 2)
			local between_op, ge_expr, le_expr = unpack(between_where, 1, 3)
			local ge_op = ge_expr[1]
			local le_op = le_expr[1]
			assert(sugar_join.kind == 'join' and sugar_join.on == true,
				'cross_join() must rewrite to join(right, true)')
			assert(exists_op == 'exists' and exists_right.table == 'comment',
				'semi_join() must rewrite to where(exists(...))')
			assert(not_exists_op == 'not_exists' and not_exists_right.table == 'ban',
				'anti_join() must rewrite to where(not_exists(...))')
			assert(between_op == 'and' and ge_op == 'ge' and le_op == 'le',
				'between() must rewrite to ge/le')

			local nested = db:from('comment c')
				:select{'c.id id', 'c.post_id post_id'}
			local from_nested = db:from(nested, 'comments')
				:select{'comments.id id'}
			from_nested:prepare()
			assert(from_nested.source.kind == 'relation' and from_nested.source.alias == 'comments'
				and from_nested.source.relation == nested, 'base relation sources must compile as nested sources')
			local nested_id_field = nested.returned_fields[1]
			local nested_post_id_field = nested.returned_fields[2]
			assert(nested.terminal_kind == 'rows' and nested_id_field == 'id'
				and nested_post_id_field == 'post_id', 'nested relation sources must expose returned fields')

			local nested_join = db:from('tag t')
				:select{'t.id id'}
			local joined_nested = db:from('post p')
				:join(nested_join, 'tags', true)
				:select{'p.id id'}
			joined_nested:prepare()
			local joined_nested_join = joined_nested.joins[1]
			local joined_nested_id_field = joined_nested_join.right.returned_fields[1]
			assert(joined_nested_join.right.kind == 'relation'
				and joined_nested_join.right.alias == 'tags'
				and joined_nested_id_field == 'id',
				'aliased join relation sources must compile as nested sources')

			local fragment = db:from('comment c')
				:where(q.eq(c'c.post_id', c'p.id'))
			local joined_fragment = db:from('post p')
				:join(fragment, true)
				:select{'p.id id'}
			joined_fragment:prepare()
			local joined_fragment_join = joined_fragment.joins[1]
			assert(joined_fragment_join.right == fragment,
				'unaliased join fragments must stay unwrapped')
			local joined_fragment_on = joined_fragment_join.on
			joined_fragment:prepare()
			assert(joined_fragment_join.on == joined_fragment_on,
				'prepare() must be idempotent')

			ok, err = pcall(function()
				db:from(db:from('post p'):select{'p.id id'}):prepare'count'
			end)
			assert(not ok and err:find('relation source requires alias', 1, true),
				'base relation sources must require aliases')

			ok, err = pcall(function()
				db:from('post p')
					:join(db:from('comment c'):select{'c.id id'}, true)
					:select{'p.id id'}
					:prepare()
			end)
			assert(not ok and err:find('relation source requires alias', 1, true),
				'selecting join relation sources must require aliases')

			ok, err = pcall(function()
				db:from('post p')
					:join(db:from('comment c'):order_by{{c'c.id', 'asc'}}, true)
					:select{'p.id id'}
					:prepare()
			end)
			assert(not ok and err:find('relation fragment may contain only source steps and where()', 1, true),
				'relation fragments must reject non-mergeable query parts')

			local exists_table = db:from('post p')
				:where(q.exists('comment c2', q.eq(c'c2.post_id', c'p.id')))
				:select{'p.id id'}
			exists_table:prepare()
			local exists_expr = exists_table.wheres[1]
			local _, exists_right = unpack(exists_expr, 1, 2)
			assert(exists_right.member == 'c2' and exists_right.schema == db:table_schema'comment'
				and exists_right.fields == db:table_schema('comment').fields,
				'exists() table sources must resolve source fields')

			local exists_inner = db:from('comment c')
				:where(q.eq(c'c.post_id', q.outer'p.id'))
			db:from('post p')
				:where(q.exists(exists_inner))
				:select{'p.id id'}
				:prepare()
			assert(exists_inner.terminal_kind == 'exists' and exists_inner.needs_output == false,
				'exists() relation subqueries must not require returned rows')
			local _, _, exists_outer = unpack(exists_inner.wheres[1], 1, 3)
			assert(exists_outer[1] == 'col' and exists_outer.source and exists_outer.field,
				'outer() must validate, then bind as a scoped col()')

			local in_inner = db:from('comment c')
				:select{'c.post_id post_id'}
			db:from('post p')
				:where(q.in_(c'p.id', in_inner))
				:select{'p.id id'}
				:prepare()
			local in_field = in_inner.returned_fields[1]
			assert(in_inner.terminal_kind == 'rows' and in_field == 'post_id',
				'in_() relation subqueries must expose one returned field')

			ok, err = pcall(function()
				db:from('post p')
					:where(q.in_(c'p.id', db:from('comment c'):select{'c.id id', 'c.post_id post_id'}))
					:select{'p.id id'}
					:prepare()
			end)
			assert(not ok and err:find('in_() relation requires one returned field', 1, true),
				'in_() relation subqueries must reject multiple returned fields')

			local bound = db:from('post p')
				:where(q.eq(c'status', p'STATUS'))
				:select{'p.id id'}
				:order_by{{c'title', 'asc'}}
			bound:prepare()
			local _, bound_left = unpack(bound.wheres[1], 1, 2)
			local _, bound_member, bound_col = unpack(bound_left, 1, 3)
			assert(bound_member == false and bound_col == 'status'
				and bound_left.source and bound.params.STATUS,
				'unqualified source fields and params must bind')

			local grouped = db:from('post p')
				:group{{c'p.status', 'status'}, {q.count(), 'n'}}
				:having(q.gt(c'n', 0))
				:select{{c'status', 'status'}, {c'n', 'n'}}
				:order_by{{c'n', 'desc'}}
			grouped:prepare()
			local _, having_col = unpack(grouped.havings[1], 1, 2)
			assert(not having_col.source, 'having() fields must bind to group outputs')

			local correlated = db:from('comment c')
				:where(q.eq(c'c.post_id', c'p.id'))
			db:from('post p')
				:where(q.exists(correlated))
				:select{'p.id id'}
				:prepare()
			local _, _, outer_col = unpack(correlated.wheres[1], 1, 3)
			assert(outer_col.source.member == 'p' and not correlated.members.p,
				'nested q.col() must bind through parent scopes')

			ok, err = pcall(function()
				db:from('post p')
					:where(q.exists(
						db:from('comment p')
							:where(q.eq(c'p.post_id', q.outer'p.id'))))
					:select{'p.id id'}
					:prepare()
			end)
			assert(not ok and err:find('outer field resolved in current scope', 1, true),
				'outer() must not bypass normal scope resolution')

			ok, err = pcall(function()
				db:from('post p')
					:select{'p.id x', 'p.title x'}
					:prepare()
			end)
			assert(not ok and err:find('duplicate select() output field: x', 1, true),
				'select() output names must be unique')

			ok, err = pcall(function()
				db:from('post p')
					:where(c'p.missing')
					:prepare'count'
			end)
			assert(not ok and err:find('unknown field: p.missing', 1, true),
				'source fields must exist')

			ok, err = pcall(function()
				db:from('post p')
					:having(q.gt(c'n', 0))
					:prepare'count'
			end)
			assert(not ok and err:find('having() requires group()', 1, true),
				'having() must require group()')

			ok, err = pcall(function()
				db:from('post p')
					:group{{c'p.status', 'status'}}
					:select{{c'p.id', 'id'}}
					:prepare()
			end)
			assert(not ok and err:find('output field must be unqualified', 1, true),
				'grouped select() must read group outputs')

			ok, err = pcall(function()
				db:from('post p')
					:group{{c'p.status', 'status'}}
					:order_by{{c'p.id', 'asc'}}
					:prepare()
			end)
			assert(not ok and err:find('output field must be unqualified', 1, true),
				'grouped order_by() must read returned fields')

			ok, err = pcall(function()
				db:from('post p')
					:use_index('p', 'ix_status')
					:no_index('p', 'ix_status')
					:prepare'count'
			end)
			assert(not ok and err:find('index is both forced and forbidden', 1, true),
				'use_index() and no_index() must not conflict')
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
