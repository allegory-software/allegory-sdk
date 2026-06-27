require'mdbx_query'

pr[[
mdbx_query query builder tutorial.

Shows the high-level query builder: db:from(...):...:rows() and friends.
The low-level node API (pk_get, merge_join, etc.) is in mdbx_query_test.lua.

Run: ~/sdk/bin/luajit -lscite ~/sdk/lua/mdbx_query_tutorial.lua
]]

------------------------------------------------------------------------
-- Schema definition (paper schema language)
--
-- mdbx_schema() creates a schema object.
-- sc:import(fn) runs fn in a DSL environment where bare names resolve
-- to field type tokens declared in schema_std.
--
-- Each table is a flat list of alternating name/type tokens with
-- optional constraint tokens (not_null, uk, child_fk, ...).
-- idpk = u64 primary key with auto-increment.
-- child_fk = non-unique FK index pointing to the idpk of the named table.
-- uk = unique index on the preceding field; varsize fields also need nozero.
-- pk(col,...) = composite primary key replacing the default single-col pk.
------------------------------------------------------------------------

function blog_schema()
	import'schema_std'

	tables.category = {
		id  , idpk,
		name, name, not_null,
		slug, name, not_null, nozero, uk,
	}

	tables.post = {
		id      , idpk,
		category, id, not_null, child_fk,   -- FK index post/category
		title   , name, not_null,
		status  , name,                      -- 'draft' | 'published' | 'archived'
		score   , int,                       -- nullable i32
	}

	tables.tag = {
		id  , idpk,
		name, name, not_null, nozero, uk,
	}

	tables.post_tag = {
		post, id, not_null, child_fk,       -- FK index post_tag/post
		tag , id, not_null, child_fk,       -- FK index post_tag/tag
		pk(post, tag),                       -- composite PK
	}
end

------------------------------------------------------------------------
-- Tutorial table -- collects named functions in insertion order.
------------------------------------------------------------------------

local tutorial = setmetatable({}, {__newindex = function(t, k, v)
	rawset(t, k, v)
	rawset(t, #t+1, k)
end})

------------------------------------------------------------------------
-- Helpers
------------------------------------------------------------------------

local function rows_of(q)
	local t = {}
	for r in q:rows() do t[#t+1] = r end
	return t
end

------------------------------------------------------------------------
-- Database setup
--
-- 1. Create a schema object and import the schema function.
-- 2. Open the database file and attach the schema.
-- 3. Call sync_schema to create all tables and indexes that do not yet
--    exist. It validates already-existing ones and leaves them unchanged.
-- 4. Insert fixture rows inside a write transaction.
------------------------------------------------------------------------

local DB_FILE = '/tmp/mdbx_query_tutorial_'..uuid()..'.mdb'
os.remove(DB_FILE)
os.remove(DB_FILE..'-lck')

local sc = mdbx_schema()
sc:import(blog_schema)

local db = mdbx_open(DB_FILE)
db.schema = sc
db:sync_schema()

db:begin'w'

db:insert('category', '{}', {id=1, name='tech',    slug='tech'})
db:insert('category', '{}', {id=2, name='science', slug='science'})
db:insert('category', '{}', {id=3, name='art',     slug='art'})    -- no posts

db:insert('post', '{}', {id=1, category=1, title='Lua intro',   status='draft',     score=10})
db:insert('post', '{}', {id=2, category=1, title='MDBX guide',  status='published', score=50})
db:insert('post', '{}', {id=3, category=2, title='Black holes', status='published', score=80})
db:insert('post', '{}', {id=4, category=2, title='Galaxies',    status='archived',  score=nil})
db:insert('post', '{}', {id=5, category=2, title='Painting',    status='draft',     score=20})

db:insert('tag', '{}', {id=1, name='lua'})
db:insert('tag', '{}', {id=2, name='db'})
db:insert('tag', '{}', {id=3, name='web'})
db:insert('tag', '{}', {id=4, name='oop'})

db:insert('post_tag', '{}', {post=1, tag=1})   -- Lua intro  -> lua
db:insert('post_tag', '{}', {post=1, tag=2})   -- Lua intro  -> db
db:insert('post_tag', '{}', {post=2, tag=3})   -- MDBX guide -> web
db:insert('post_tag', '{}', {post=3, tag=1})   -- Black holes -> lua
db:insert('post_tag', '{}', {post=3, tag=3})   -- Black holes -> web
db:insert('post_tag', '{}', {post=4, tag=4})   -- Galaxies   -> oop
-- post 5 (Painting) has no tags

db:commit()

------------------------------------------------------------------------
-- Tutorials
------------------------------------------------------------------------

function tutorial.full_scan()
	pr[[

Full scan with select and terminals.

db:from('post') scans the post table from first to last row.
:select('post.id, post.title') picks which columns appear in each result.

Terminals run the query:
  :rows()   -- iterator, yields one record per row
  :first()  -- first matching record, or nil if none
  :count()  -- number of matching rows (no :select needed)
  :exists() -- true if at least one row matches
]]
	db:atomic('r', function()
		local rows = rows_of(db:from('post'):select('post.id, post.title'))
		pr(#rows)           -- 5
		pr(rows[1].id)      -- 1
		pr(rows[1].title)   -- Lua intro

		pr(db:from('post'):select('post.id'):first().id)  -- 1
		pr(db:from('post'):count())   -- 5
		pr(db:from('post'):exists())  -- true
	end)
end

function tutorial.column_alias()
	pr[[

Column alias in select.

Adding a name after a column renames it in the result record.
Without an alias the key is the full 'post.id' string including the table name.
]]
	db:atomic('r', function()
		local r = db:from('post'):select('post.id pid, post.title t'):first()
		pr(r.pid)    -- 1
		pr(r.t)      -- Lua intro
	end)
end

function tutorial.equality_filters()
	pr[[

Equality filters: :eq / :where / :ne.

:eq(col, v) and :where(col, v) keep rows where col equals v.
:where(col, op, v) also accepts op: =  <>  <  <=  >  >=
:ne(col, v) keeps rows where col differs from v.

When the column has an index, :eq uses it for a fast exact lookup.
When there is no index the whole table is scanned and each row checked.
col can be 'post.status' (qualified) or just 'status' (assumes the from table).
]]
	db:atomic('r', function()
		for r in db:from('post'):eq('status', 'published'):select('post.id'):rows() do
			pr(r.id)     -- 2, 3
		end

		-- :where with explicit op is identical to :eq for '='
		for r in db:from('post'):where('status', '=', 'published'):select('post.id'):rows() do
			pr(r.id)     -- 2, 3
		end

		-- :ne is always a full-table scan + per-row check
		local rows = rows_of(db:from('post'):ne('status', 'draft'):select('post.id, post.status'))
		pr(#rows)   -- 3   (published x2, archived x1)
	end)
end

function tutorial.range_filters()
	pr[[

Range filters: :gt / :ge / :lt / :le / :between.

:between(col, lo, hi) is equivalent to :ge(col, lo):le(col, hi).
On an indexed column these use the index to scan just the matching range.
On a non-indexed column the whole table is scanned.
Null sorts before all non-null values in ascending order.
]]
	db:atomic('r', function()
		-- posts with score >= 50
		for r in db:from('post'):ge('score', 50):select('post.id, post.score'):rows() do
			pr(r.id, r.score)   -- 2  50 / 3  80
		end

		-- posts with 10 <= score <= 50
		for r in db:from('post'):between('score', 10, 50):select('post.id, post.score'):rows() do
			pr(r.id, r.score)   -- 1  10 / 2  50 / 5  20
		end
	end)
end

function tutorial.null_filters()
	pr[[

Null filters: :is_null / :is_not_null.

:is_null(col)     keeps rows where col was not set.
:is_not_null(col) keeps rows where col has a value.
Null sorts before non-null in ascending order.
]]
	db:atomic('r', function()
		-- only Galaxies (post 4) has no score
		for r in db:from('post'):is_null('score'):select('post.id'):rows() do
			pr(r.id)    -- 4
		end

		local nn = rows_of(db:from('post'):is_not_null('score'):select('post.id'))
		pr(#nn)    -- 4
	end)
end

function tutorial.set_membership()
	pr[[

Set membership: :in_ / :not_in.

:in_(col, {v, ...})    keeps rows where col is in the list.
:not_in(col, {v, ...}) keeps rows where col is not in the list.
Neither uses an index; both scan the whole table.
]]
	db:atomic('r', function()
		for r in db:from('post'):in_('status', {'draft', 'archived'}):select('post.id'):rows() do
			pr(r.id)    -- 1, 4, 5
		end

		for r in db:from('post'):not_in('status', {'published', 'archived'}):select('post.id'):rows() do
			pr(r.id)    -- 1, 5
		end
	end)
end

function tutorial.chained_filters()
	pr[[

Chained filters (AND).

All filter calls chain as AND. The query picks the best available index for
one of the filters and applies the rest as row-by-row checks on top.
]]
	db:atomic('r', function()
		-- status index used for 'published'; score is a residual check
		for r in db:from('post'):eq('status', 'published'):ge('score', 60):select('post.id'):rows() do
			pr(r.id)    -- 3   (score 80, published)
		end

		-- no score index; both are residual
		for r in db:from('post'):ge('score', 10):le('score', 30):select('post.id'):rows() do
			pr(r.id)    -- 1  5   (scores 10, 20)
		end
	end)
end

function tutorial.custom_predicate()
	pr[[

Custom predicate: :filter(fn).

:filter(fn) runs a Lua function on each row. fn receives a cursor node
positioned on the current row. Call node:get_cols(member, {col, ...}) to
read values; it returns true followed by the column values (or null).
  local ok, score = node:get_cols('post', {'score'})
For multiple columns:
  local ok, score, status = node:get_cols('post', {'score', 'status'})
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:filter(function(node)
					local ok, score = node:get_cols('post', {'score'})
					return ok and score ~= null and score > 15 and score < 60
				end)
				:select('post.id, post.score'))
		for _, r in ipairs(rows) do
			pr(r.id, r.score)   -- 2  50 / 5  20
		end
	end)
end

function tutorial.from_alias()
	pr[[

From alias.

db:from('post p') assigns the alias 'p' to the post table.
All column references in filters and select must use the alias.
Aliases are required when the same table appears more than once in a query.
]]
	db:atomic('r', function()
		for r in db:from('post p'):eq('p.status', 'published'):select('p.id'):rows() do
			pr(r.id)    -- 2, 3
		end
	end)
end

function tutorial.child_to_parent_join()
	pr[[

Child-to-parent join: :join / :left_join.

:join('category') follows the FK from post.category to the category table.
When the FK points from the joined table back to the driver (child to parent),
each driver row does one lookup into the parent table.

:left_join keeps posts with a missing parent (parent columns come back nil).
In an inner :join, posts without a valid parent are dropped.

Select columns from multiple tables by prefixing with the table name.
Adding an alias renames the field: 'category.name cat_name'.

:join also accepts options: {from='member', on='fk_ix', as='alias', left=bool}.
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:join('category')
				:select('post.id, post.title, category.name cat_name'))
		pr(#rows)                -- 5
		pr(rows[1].cat_name)     -- tech
		pr(rows[3].cat_name)     -- science
	end)
end

function tutorial.parent_to_child_join()
	pr[[

Parent-to-child join.

When the FK goes from the joined table to the driver (parent to child),
each driver row seeks into the FK index to find its children.
In an inner join, parents with no children produce no output rows.
Category 3 ('art') has no posts and does not appear in the result.
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('category')
				:join('post')
				:select('category.id, post.id post_id'))
		pr(#rows)                    -- 5   (cat1: 2 posts, cat2: 3 posts, cat3: 0)
		pr(rows[1]['category.id'])   -- 1
		pr(rows[3]['category.id'])   -- 2   (cat2 starts at index 3)
	end)
end

function tutorial.three_table_join()
	pr[[

Three-table join chain.

Each :join adds a table to the current member set. With more than two tables
the builder automatically combines prior results before the next FK seek.
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:join('post_tag')
				:join('tag')
				:select('post.id, tag.name'))
		pr(#rows)                          -- 6   (post5 has no tags)
		pr(rows[1]['post.id'])             -- 1
		pr(rows[1]['tag.name'])            -- lua
	end)
end

function tutorial.order_by()
	pr[[

Order by: :order_by.

:order_by('col [asc|desc]', ...) sorts the output. Default direction is asc.
When the data is already in the required order from the index no sort is added.
Otherwise all matching rows are collected and sorted before output.
Null sorts before non-null ascending; after non-null descending.
Multiple columns: :order_by('score desc', 'id asc').
]]
	db:atomic('r', function()
		-- score desc: highest first; null sorts last
		local rows = rows_of(db:from('post'):select('post.id, post.score'):order_by('score desc'))
		pr(rows[1].id)      -- 3   (score 80)
		pr(rows[1].score)   -- 80

		-- multi-column: status asc, then id asc
		local rows2 = rows_of(
			db:from('post'):select('post.id, post.status')
				:order_by('status asc', 'id asc'))
		pr(rows2[1].status)    -- archived
		pr(rows2[1].id)        -- 4
	end)
end

function tutorial.limit_and_offset()
	pr[[

Limit and offset: :limit / :offset.

Without :order_by, :limit stops the scan as soon as enough rows are found.
Only that many rows are read; the rest of the table is not visited.
With :order_by, all matching rows are collected and sorted first; then
:limit and :offset select a window from the sorted result.
]]
	db:atomic('r', function()
		-- first 2 rows in PK order
		local rows = rows_of(db:from('post'):select('post.id'):limit(2))
		pr(rows[1].id, rows[2].id)    -- 1  2

		-- skip 1, take 2
		local rows2 = rows_of(db:from('post'):select('post.id'):limit(2):offset(1))
		pr(rows2[1].id, rows2[2].id)  -- 2  3

		-- sort then window
		local rows3 = rows_of(
			db:from('post'):select('post.id, post.score')
				:order_by('score desc'):limit(2))
		pr(rows3[1].id, rows3[2].id)  -- 3  2   (scores 80, 50)
	end)
end

function tutorial.distinct()
	pr[[

Distinct: :distinct(cols).

:distinct(cols) removes duplicate records by the named output fields.
cols is a string for a single field or a list of field name strings.
Field names are from :select (output names), not 'table.col' references.
All matching rows are read and de-duplicated in memory.
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post'):select('post.status'):distinct({'status'}))
		pr(#rows)    -- 3   (archived, draft, published)
	end)
end

function tutorial.where_has_hasnt()
	pr[[

Semi-join filters: :where_has / :where_hasnt.

:where_has('post') keeps only rows that have at least one matching child row.
:where_hasnt('post') keeps only rows with no child rows.
The child table must have an FK pointing to the driving table.
]]
	db:atomic('r', function()
		-- categories that have at least one post
		for r in db:from('category'):where_has('post'):select('category.id'):rows() do
			pr(r.id)    -- 1, 2
		end

		-- categories with no posts
		for r in db:from('category'):where_hasnt('post'):select('category.id'):rows() do
			pr(r.id)    -- 3
		end
	end)
end

function tutorial.where_has_with_predicate()
	pr[[

where_has with a predicate function.

Passing a function to :where_has lets you add conditions on the child rows.
fn receives the outer row as a cursor node; call node:get_cols to read values.
Return a query scoped to the child table.
The outer row is kept when at least one inner row matches.
]]
	db:atomic('r', function()
		-- categories that have at least one published post
		for r in db:from('category'):where_has('post', function(on)
			local _, cat_id = on:get_cols('category', {'id'})
			return db:from('post'):eq('category', cat_id):eq('status', 'published')
		end):select('category.id'):rows() do
			pr(r.id)    -- 1, 2
		end
	end)
end

function tutorial.where_exists_uncorrelated()
	pr[[

Uncorrelated where_exists.

:where_exists(q2) keeps outer rows when q2 produces at least one row.
When q2 does not reference any outer column values it runs once and the
result applies to every outer row: either all pass or none do.
]]
	db:atomic('r', function()
		-- a published post exists -> all 3 categories pass
		pr(db:from('category')
			:where_exists(db:from('post'):eq('status', 'published'))
			:count())    -- 3

		-- no 'invisible' posts -> none pass
		pr(db:from('category')
			:where_exists(db:from('post'):eq('status', 'invisible'))
			:count())    -- 0
	end)
end

function tutorial.where_exists_correlated_sentinel()
	pr[[

Correlated where_exists with mdbx_outer.

mdbx_outer'c.id' is a placeholder that takes the value of column 'id'
from the current outer row when the subquery runs. The subquery reruns
for each outer row.

Note: the reference manual spells it outer'...' but 'outer' is an
internal local in mdbx_query.lua; only mdbx_outer is exported globally.

Use a from alias when the inner and outer queries use the same table name.
]]
	db:atomic('r', function()
		for r in db:from('category c')
			:where_exists(
				db:from('post')
					:eq('category', mdbx_outer'c.id')
					:eq('status', 'published'))
			:select('category.id')
			:rows() do
			pr(r.id)    -- 1, 2
		end
	end)
end

function tutorial.where_exists_correlated_closure()
	pr[[

Correlated where_exists with a closure.

Passing a function to :where_exists lets you build the subquery lazily.
fn receives a proxy o; call o('c.id') to get the current outer column value
at the moment the function runs. Use this when two levels of nesting would
make mdbx_outer ambiguous.
]]
	db:atomic('r', function()
		for r in db:from('category c')
			:where_exists(function(o)
				return db:from('post')
					:eq('category', o'c.id')
					:eq('status', 'published')
			end)
			:select('category.id')
			:rows() do
			pr(r.id)    -- 1, 2
		end
	end)
end

function tutorial.where_not_exists()
	pr[[

where_not_exists.

:where_not_exists keeps rows where the subquery produces zero rows.
Both correlated and uncorrelated forms work the same as :where_exists.
]]
	db:atomic('r', function()
		for r in db:from('category c')
			:where_not_exists(
				db:from('post')
					:eq('category', mdbx_outer'c.id')
					:eq('status', 'published'))
			:select('category.id')
			:rows() do
			pr(r.id)    -- 3   (art has no published posts)
		end
	end)
end

function tutorial.group_by_agg()
	pr[[

Group by and aggregates: :group_by + :agg.

:group_by('col', ...) groups rows by one or more columns.
:agg{...} computes values for each group.

Each agg entry:
  {name='n',   op='count'}                               -- rows in group
  {name='tot', op='sum',    member='post', col='score'}  -- sum; null skipped
  {name='avg', op='avg',    member='post', col='score'}
  {name='lo',  op='min',    member='post', col='score'}
  {name='hi',  op='max',    member='post', col='score'}

The group-by columns appear in the output under their bare column names
(e.g., 'category', not 'post.category'). Null inputs are skipped by all ops.
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:group_by('category')
				:agg{
					{name='n',         op='count'},
					{name='avg_score', op='avg', member='post', col='score'},
				})
		pr(#rows)               -- 2
		pr(rows[1].category)    -- 1
		pr(rows[1].n)           -- 2   (posts 1, 2)
		pr(rows[2].n)           -- 3   (posts 3, 4, 5)
		-- avg_score: cat1 = (10+50)/2 = 30.0; cat2 = (80+20)/2 = 50.0 (null skipped)
		pr(rows[1].avg_score)   -- 30.0
	end)
end

function tutorial.grand_total_agg()
	pr[[

Grand-total aggregate (no group_by).

:agg{...} without :group_by collapses all rows into one result record.
Always produces exactly one row, even for an empty table (count=0, sums=nil).
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:agg{
					{name='n',   op='count'},
					{name='tot', op='sum', member='post', col='score'},
				})
		pr(#rows)         -- 1
		pr(rows[1].n)     -- 5
		pr(rows[1].tot)   -- 160   (10+50+80+nil+20; null skipped)
	end)
end

function tutorial.having()
	pr[[

Having: :having.

:having(col [, op], v) filters the aggregate output.
col is the 'name' from :agg, not a 'table.col' reference.
Default op is '='. Supported ops: =  <>  <  <=  >  >=
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:group_by('category')
				:agg{{name='n', op='count'}}
				:having('n', '>', 2))
		pr(#rows)               -- 1
		pr(rows[1].category)    -- 2   (3 posts; cat1 has 2 which fails >2)
	end)
end

function tutorial.concat_agg()
	pr[[

Concat aggregate.

op='concat' joins string column values together. sep sets the separator
(default is an empty string). Null values are skipped. Values appear in
primary key order.
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post')
				:group_by('category')
				:agg{{name='titles', op='concat', member='post', col='title', sep='; '}})
		pr(rows[1].titles)    -- Lua intro; MDBX guide
		pr(rows[2].titles)    -- Black holes; Galaxies; Painting
	end)
end

function tutorial.computed_columns()
	pr[[

Computed select columns.

:select accepts a mix of 'table.col [alias]' strings and {name=, fn=} tables
for values computed in Lua. fn receives a cursor node; call
node:get_cols('post', {'col'}) to read values.
Returning nil omits the field from the record entirely (not set, not null).
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('post'):select{
				'post.id',
				'post.score',
				{name='double', fn=function(node)
					local ok, s = node:get_cols('post', {'score'})
					return (ok and s ~= null) and s * 2 or nil
				end},
			})
		pr(rows[1].double)    -- 20    (score 10 * 2)
		pr(rows[4].double)    -- nil   (post4 has no score; field absent)
	end)
end

function tutorial.nested_join()
	pr[[

Nested join: :nested_join.

:nested_join(fn) runs fn once for each outer row to produce correlated inner
rows. fn receives a cursor node to read outer column values. The inner query's
member names must not overlap the outer ones.
Use it when you need a specific related row per driver row, such as
"for each category, find the post with the highest score".
]]
	db:atomic('r', function()
		local rows = rows_of(
			db:from('category'):nested_join(function(on)
				local _, cat_id = on:get_cols('category', {'id'})
				return db:from('post')
					:eq('category', cat_id)
					:is_not_null('score')
					:order_by('score desc')
					:limit(1)
			end):select('category.name, post.title, post.score'))
		pr(#rows)              -- 2   (art has no posts with scores)
		pr(rows[1].score)      -- 50  (tech: MDBX guide)
		pr(rows[2].score)      -- 80  (science: Black holes)
	end)
end

function tutorial.index_hints()
	pr[[

Index hints: :use_index / :no_index.

:use_index(member, ix) forces the planner to use a specific index.
  Raises an error if no filter matches the given index.
:no_index(member)     prevents any index from being used (full scan).
:no_index(member, ix) prevents one specific index.
member is the table name or alias. ix is the index name.
Index names are generated from the schema as 'table/col1,col2'.
]]
	db:atomic('r', function()
		-- force the FK index on the category column
		for r in db:from('post')
			:eq('category', 1)
			:use_index('post', 'post/category')
			:select('post.id')
			:rows() do
			pr(r.id)    -- 1, 2
		end

		-- forbid all indexes: full scan with residual filter
		local rows = rows_of(
			db:from('post')
				:eq('status', 'published')
				:no_index('post')
				:select('post.id'))
		pr(#rows)    -- 2
	end)
end

------------------------------------------------------------------------
-- Runner
------------------------------------------------------------------------

local name = ...
if name == 'mdbx_query_tutorial' then name = nil end
local items = name and {name} or tutorial
for _, k in ipairs(items) do
	pr('--- tutorial.'..k..' ---')
	tutorial[k]()
end

db:close()
os.remove(DB_FILE)
os.remove(DB_FILE..'-lck')
pr'done'
