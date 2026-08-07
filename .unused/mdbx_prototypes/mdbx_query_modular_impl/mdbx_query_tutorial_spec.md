# mdbx_query query builder — tutorial suite spec

## Goal

A single Lua file (`tests/mdbx_query_tutorial.lua`) that is simultaneously:
- runnable (harness: `~/sdk/bin/luajit -lscite tests/mdbx_query_tutorial.lua`)
- a tutorial for the **query builder** layer of `mdbx_query.lua`

Scope: **query builder only** — the `db:from(...):...:rows()` API and its terminals.
Low-level node API (`pk_get`, `merge_join`, etc.) has coverage in
`tests/mdbx_query_test.lua` and is excluded here.

Primary reference: `lua/mdbx_query_nodes.md` (the authoritative spec).
Implementation: `lua/mdbx_query.lua` (the ground truth for what is actually implemented).

---

## Collab rules (for the implementer)

- Pause and ask before making assumptions about API behavior.
- Do not hack around API limitations silently; surface the limitation and ask.
- If something is unclear or the doc and the code disagree, stop and ask.
- Do not go in circles when things are undefined — ask.

---

Rules for the description of each example:

- Terse but complete — reader must not need to chase source or another doc.
- State what the method/filter does, what it returns, and any sharp edges.
- Show the call signature(s), not implementation details.
- ASCII only; no Unicode arrows or dashes.

---

## Schema

All tests share one schema.  Use the paper schema language exactly as in
`lua/webb_auth_mdbx.lua` (setfenv-based DSL, `import'schema_std'`, `tables.X = {...}`).

Proposed domain: **blog** (category -> post <- tag via post_tag).

```lua
function blog_schema()
    import'schema_std'

    tables.category = {
        id   , idpk,
        name , name,
        slug , name, uk,
    }

    tables.post = {
        id       , idpk,
        category , id, not_null, child_fk,
        title    , name,
        status   , enum'draft published archived',
        score    , int,
        ctime    , ctime,
    }

    tables.tag = {
        id   , idpk,
        name , name, uk,
    }

    tables.post_tag = {
        post , id, not_null, child_fk,
        tag  , id, not_null, child_fk, pk(post, tag),
    }
end
```

---

## Fixture data

Insert rows that exercise every test:

- **category**: 3 rows — cat_a (id=1), cat_b (id=2), cat_c (id=3, no posts — for hasnt/anti tests).
- **post**: 5 rows:
  - post 1: category=1, status='draft',     score=10,  ctime early
  - post 2: category=1, status='published', score=50,  ctime mid
  - post 3: category=2, status='published', score=80,  ctime mid
  - post 4: category=2, status='archived',  score=null, ctime late
  - post 5: category=2, status='draft',     score=20,  ctime late
- **tag**: 4 rows — lua(1), db(2), web(3), oop(4).
- **post_tag**: post1->[lua,db], post2->[web], post3->[lua,web], post4->[oop], post5->[] (no tags).

Assign IDs explicitly so assertions are deterministic.
Insert all rows in a single write transaction; verify by raw row count after commit.

---

## Unimplemented features check (ask before writing each section)

The `mdbx_query_nodes.md` lists several features.  Before writing a test section, verify the
feature exists in `mdbx_query.lua`.  Known suspects (in the doc but not obviously in
the source):

- `:in_(col, query)` — `in_` accepting a query object (doc says `values|query`); source
  only shows list handling (`for _, v in ipairs(f.set)`).
- `pk_group_first` optimization in `group_by` lowering (doc line ~479); not in source.
- `:limit` early-termination via `pk_and_probe` when `order_by` + `limit` present (doc
  line ~468).

For each section, verify against the source before writing.  If a feature is absent,
skip it and add a note ("not yet implemented") rather than writing a test that errors.

---

## Open questions about the query builder API (ask before each section)

**Q-A: `get_cols` call signature in `filter(fn)` and `{name=,fn=}` callbacks.**
  The doc says `node:get_cols(member, cols)`.  The source shows two call forms:
  - `node:get_cols(sn, {col})` — table with single name (in mk_pkfn closures)
  - `node:get_cols(sn, fk_cols)` — comma-separated string (in pk_parent_lookup)
  - `node:get_cols(o.member, o.col)` — bare string (in select decode)
  Confirm: what exactly does the user pass as `cols`, and what does it return?
  Are there multiple return values for multi-column requests?

**Q-B: `outer'ref'` vs `mdbx_outer'ref'`.**
  The doc uses `outer'u.id'`.  The source (line ~2463) sets `mdbx_outer = outer`.
  Which name is available in the test environment after `require'mdbx_query'`?

**Q-C: `where_exists(fn)` — what is `o` in `function(o) ... end`.**
  The doc shows:
  ```
  db:from'users u':where_exists(function(o)
      return db:from'sessions':where('user_id', o'u.id') end)
  ```
  `o` is called as a function with a ref string.  The source (`lower_ex_filter`) wraps
  `on` in a proxy table with `__call`.  Confirm: does `o('u.id')` return the Lua value
  of that column for the current outer row?

**Q-D: `where_has(tbl, fn)` — what does `fn` receive.**
  The source passes `on` (the outer positioned node) to `inner_fn(on)`.  Confirm:
  does `fn` receive the outer PK node (and can call `on:get_cols(member, col)`), or
  does it receive something else?

**Q-E: `nested_join(fn)` — what `fn` receives and returns.**
  The doc says `fn(outer_node) -> query`.  The source calls `j.fn(on)` and then checks
  if `r.lower` exists.  Confirm: can `fn` return a plain query object
  (`db:from(...):where(...)`), and how does the inner query correlate to the outer row?

**Q-F: `:distinct(cols)` argument form.**
  Source: `self._dist = type(cols) == 'table' and cols or {cols}`.
  Confirm: `cols` is a field name string or table of field name strings (not `member.col`
  qualified names)?

**Q-G: `:having(col, op, v)` — `col` is the aggregate output field name.**
  Source reads `r[hcol]` from the value record.  Confirm: `col` here is the `name`
  from the `agg` spec, not a `member.col` reference.

---

## Test plan (tutorial order)

Each item = one or more test functions.  Items 1-7 are the common path; items 8+
are more specialized.

### 1. Full scan + select + terminals

Feature: `from`, `select`, `rows`, `first`, `count`, `exists`.

```lua
-- iterate all posts
for id, title in db:from('post'):select('post.id, post.title'):rows() do ... end

-- request an array or named table row when a single row value is preferred
for row in db:from('post'):select('post.id, post.title'):rows'[]' do ... end
for row in db:from('post'):select('post.id, post.title'):rows'{}' do ... end

-- first row only (nil when empty)
local id = db:from('post'):select('post.id'):first()

-- total count (no select needed)
local n = db:from('post'):count()

-- boolean existence check
local found = db:from('post'):exists()
```

Notes to cover in comment:
- `select` takes a `'member.col [alias], ...'` string or a list.
- `member` is the table name (or alias from `from`).
- `rows()` returns an iterator of unpacked values by default; `'[]'` returns
  an array row and `'{}'` returns a named table row.
- `first()`, `one()`, and `must_one()` use the same shape rules.
- `rows_array()` returns the two-level array directly, or named rows with
  `'{}'`.
- `first()` opens and closes the node in one call.
- `count()` and `exists()` work without a `select` (operate at PK level).

### 2. Equality filter — `where`

Feature: `where(col, v)`, `where(col, op, v)`.

```lua
db:from('post'):where('status', 'published'):select('post.id'):rows()
db:from('post'):where('status', '==', 'published'):select('post.id'):rows()
```

Also: not-equal with `where(col, '~=', v)`, verifying that it is always residual
(no index push-down).

Note: equality on an indexed column folds to `pk_seek`; on the full PK to `pk_get`.

### 3. Range filters — `where` / `between`

Feature: range comparators.

```lua
db:from('post'):where('score', '>=', 50):where('score', '<', 100):select('post.id, post.score'):rows()
db:from('post'):between('score', 50, 100):select('post.id'):rows()  -- inclusive both ends
```

Notes: `between(col, lo, hi)` is `>= lo AND <= hi`.  Range on an indexed column folds
to `pk_range`; on a non-indexed column is residual `pk_filter`.

### 4. NULL / NOT NULL filters

Feature: `is_null`, `is_not_null`.

```lua
db:from('post'):is_null('score'):select('post.id'):rows()
db:from('post'):is_not_null('score'):select('post.id'):rows()
```

Note: `null` sorts before non-null; `is_not_null` lowers to a `pk_range`
lower bound that is open on the DB `null` sentinel.

### 5. Set filters — `in_` / `not_in`

Feature: `in_`, `not_in`.

```lua
db:from('post'):in_('status', {'draft','archived'}):select('post.id'):rows()
db:from('post'):not_in('status', {'published'}):select('post.id'):rows()
```

Note: always residual — no index push-down.  Lowers to `pk_hash_filter`.

### 6. Custom predicate — `filter(fn)`

Feature: `filter(fn)`.  fn receives the positioned PK node; always residual.

```lua
db:from('post'):filter(function(node)
    -- ask in Q-A what the exact call form is
    local ok, s = node:get_cols('post', ???)
    return ok and s == 'published'
end):select('post.id'):rows()
```

Note: used when no other filter method covers the predicate.  Runs after any index
access so the node is already positioned.

### 7. Chained filters (AND)

Chaining multiple filters produces an AND.  Show that the planner picks the best
index and makes the rest residual.

```lua
db:from('post'):where('status', 'published'):where('score', '>=', 40):select('post.id, post.score'):rows()
```

Explain what "consumed" means: the planner uses one index per member; filters not
covered by the chosen index become `pk_filter` post-scan predicates.

### 8. Child-to-parent join — `join` / `left_join`

Feature: `join`, FK direction child->parent (post.category -> category).

```lua
-- inner join
for r in db:from('post'):join('category'):select('post.title, category.name cat_name'):rows() do
    ...
end

-- left join: posts with missing category would appear (not in fixture but worth noting)
db:from('post'):left_join('category'):select('post.id, category.name'):rows()
```

Notes:
- Auto FK detection: finds FK from `post.category` to `category`.
- Lowers to `pk_parent_lookup`.
- Left join: row appears with category columns nil when no match.
- `select` aliases: `'category.name cat_name'` renames the output field.

### 9. Parent-to-child join

Feature: `join` FK direction parent->child (category -> post).

```lua
for r in db:from('category'):join('post'):select('category.name, post.title'):rows() do
    ...
end
```

Notes:
- Lowers to `pk_join_seek` (when driver is small) or `merge_join` (when already in
  parent-PK order and inputs can be merged).
- Rows are in category PK order; within each category, post PK order.
- cat_c (no posts) produces no rows in inner join.

### 10. Join alias and `from` / `on` opts

Feature: `join(spec, {from=, on=, as=})`.

```lua
-- when two tables share a FK path ambiguity, pin with from=
db:from('post p'):join('category c', {from='p'}):select('p.title, c.name'):rows()
```

Notes:
- `from` pins which existing member the FK comes from (useful when multiple members
  could connect to the new table).
- `as` renames the member in the output.
- `on` pins the FK by name when multiple FKs exist between the same two tables.

### 11. Multi-table join chain

Before writing this section, read `Q:lower` join logic (`acc` table) to understand
what chains are supported.  Two candidate patterns:

**Pattern A** — linear chain through an association table:
```lua
db:from('post'):join('category'):join('tag')  -- ERROR if no direct FK post->tag
```

**Pattern B** — explicit through post_tag:
```lua
db:from('post'):join('post_tag'):join('tag'):select('post.title, tag.name'):rows()
```

**Open question (ask before this section)**: does the builder support a three-table
chain where `#acc > 1`?  The source at line ~2958 (`if #acc == 1 then ... else ...`)
shows a `nested_join` fallback for the multi-member case.  Trace what it does and
confirm the user-facing behavior, then write the example and comment accordingly.

### 12. Order by

Feature: `order_by`.

```lua
db:from('post'):select('post.id, post.score'):order_by('score desc'):rows()
db:from('post'):select('post.id, post.score'):order_by('score desc', 'id asc'):rows()
```

Notes:
- When driver already has the needed order (index order matches), no `value_sort` is
  added — explain this.
- When not, lowers to `value_sort` (materialises all rows, then sorts).
- Null sorts before non-null in asc; after in desc.

### 13. Limit and offset

Feature: `limit`, `offset`.

```lua
-- with order_by: applied after value_sort
db:from('post'):order_by('id asc'):select('post.id'):limit(2):offset(1):rows()

-- without order_by: pushed into the PK-level scan (stops early)
db:from('post'):select('post.id'):limit(3):rows()
```

Notes: without `order_by`, `limit` is applied at PK level before decoding (fast path).
With `order_by`, it is applied after `value_sort` (all rows materialised first).

### 14. Distinct

Feature: `distinct(cols)`.

```lua
db:from('post'):select('post.status'):distinct({'status'}):rows()
```

Notes: `cols` is a list of output field names (from `select`, not `member.col` refs).
When input is already grouped by those fields, uses `stream_distinct` (no memory).
Otherwise uses `hash_distinct` (O(n) memory).
(Verify which lowering the builder chooses — ask if uncertain.)

### 15. Alias in `from`

Feature: `from('table alias')`.

```lua
db:from('post p'):where('p.status', 'published'):select('p.id, p.title'):rows()
```

Notes: all filter and select column refs use the alias, not the table name.
Useful when the same table is joined multiple times (requires alias).

### 16. `where_has` / `where_hasnt` (no fn)

Feature: `where_has(table)`, `where_hasnt(table)`.

```lua
-- categories that have at least one post
db:from('category'):where_has('post'):select('category.id, category.name'):rows()

-- categories with no posts
db:from('category'):where_hasnt('post'):select('category.id'):rows()
```

Notes:
- `table` is the child table that holds the FK to `from`'s table.
- Without fn: `where_has` lowers to `pk_hash_filter(..., 'in')` using `fk_parent_scan`.
- Without fn: `where_hasnt` lowers to `merge_except` + `fk_parent_scan` (set subtraction
  from all PKs).
- cat_c (no posts) must be absent from `where_has`, present in `where_hasnt`.

### 17. `where_has` with a refining fn

Feature: `where_has(table, fn)`.

```lua
-- categories that have at least one published post
db:from('category'):where_has('post', function(on)
    -- ???: what is `on`; what does fn return?  (see Q-D above)
end):select('category.id'):rows()
```

**Block**: resolve Q-D before writing this section.

### 18. `where_exists` / `where_not_exists` — uncorrelated

Feature: `where_exists(q2)` when q2 has no `outer(...)` references.

```lua
-- posts that exist in any category (trivially true but shows the form)
db:from('category'):where_exists(
    db:from('post'):where('status', 'published')
):select('category.id'):rows()
```

Notes: uncorrelated subquery runs once and the result is reused.  Lowers to
`semi_join` / `anti_join` with a constant inner.

### 19. `where_exists` — correlated

Feature: `where_exists(q2)` with `outer(ref)` sentinels.

```lua
-- categories that have at least one published post (correlated form)
db:from('category c'):where_exists(
    db:from('post'):where('category', outer'c.id'):where('status', 'published')
):select('category.id'):rows()
```

Notes: `outer'c.id'` is a sentinel resolved per outer row at execution time.
Lowers to `semi_join` with a correlated inner that rebuilds per outer row.
(See Q-B for the name `outer` vs `mdbx_outer`.)

### 20. `where_exists` — closure form

Feature: `where_exists(fn)` where fn receives a proxy `o`.

```lua
db:from('category c'):where_exists(function(o)
    return db:from('post'):where('category', o'c.id'):where('status', 'published')
end):select('category.id'):rows()
```

Notes: `o('c.id')` evaluates to the Lua value of that column in the current outer row.
The closure form is preferred when the outer scope is nested and `outer(ref)` would
be ambiguous.
(See Q-C for proxy semantics.)

### 21. `where_not_exists`

Mirror of sections 18-20 for the anti-join form.

### 22. Group by + aggregates

Feature: `group_by`, `agg`.

```lua
-- count posts per category
db:from('post')
    :group_by('category')
    :agg({
        {name='n',        op='count'},
        {name='avg_score', op='avg', member='post', col='score'},
    })
    :rows()
```

Notes:
- `group_by` takes a list of `'member.col'` or bare `'col'` column refs.
- `agg` list: each entry `{name=, op=, [member=, col=, sep=, part=]}`.
- `member` and `col` are required for ops other than `count` and `key`.
- Output fields are the `name` values from `agg`, plus the group-by columns
  (auto-added as `key` ops — confirm this in the source).
- Lowers to `pk_group` + `stream_aggregate`.

### 23. Grand-total aggregate (no group_by)

```lua
db:from('post'):agg({{name='n', op='count'}, {name='total', op='sum', member='post', col='score'}}):rows()
```

Notes: without `group_by`, a single record is always returned (even for empty input, where
`count=0` and `sum=nil`).  `stream_aggregate` with `key_fn=nil`.

### 24. `concat` aggregate

```lua
db:from('post'):group_by('category'):agg({
    {name='titles', op='concat', member='post', col='title', sep='; '},
}):rows()
```

Notes: skips null values; join order is input order.

### 25. Having

Feature: `having(col, op, v)` and `having(col, v)` (shorthand for `=`).

```lua
db:from('post'):group_by('category')
    :agg({{name='n', op='count'}})
    :having('n', '>', 1)
    :rows()
```

Notes: `col` is the aggregate output field name (from the `agg` spec), not a `member.col`
reference.  Lowers to `value_filter` applied after the aggregate node.

### 26. `nested_join(fn)`

Feature: `nested_join(fn)` on the query builder.

```lua
-- for each category, find its most recently created post
db:from('category c'):nested_join(function(on)
    -- on is the outer PK node; use outer(...) or closure to correlate
    return db:from('post'):where('category', outer'c.id'):order_by('ctime desc'):limit(1)
end):select('category.name, post.title'):rows()
```

Notes: `fn` is called once per outer item; it must return a query (or PK node).
Inner member names must not overlap outer member names.
Lowers to `nested_join(driver, fn)`.
(See Q-E before writing this section.)

### 27. Select with computed columns (`{name=, fn=}`)

Feature: `{name=, fn=}` in the `select` list.

```lua
db:from('post'):select({
    'post.id',
    {name='double_score', fn=function(node)
        -- node is the positioned PK node; call get_cols to read
        local ok, s = node:get_cols('post', ???)  -- resolve Q-A
        return ok and s * 2 or nil
    end},
}):rows()
```

Notes: `fn` receives the positioned input PK node.  Return nil to omit the field
from the record (it will be absent, not null).

### 28. `use_index` / `no_index` hints

Feature: `:use_index(member, ix)`, `:no_index(member [, ix])`.

```lua
-- force the planner to use the status index
db:from('post'):where('status','published'):use_index('post', 'post/status'):select('post.id'):rows()

-- forbid all indexes (force full scan)
db:from('post'):where('score', '>=', 50):no_index('post'):select('post.id'):rows()

-- forbid one specific index
db:from('post'):where('score', '>=', 50):no_index('post', 'post/score'):select('post.id'):rows()
```

Notes: `member` is the table name or alias.  `ix` is the index name in `table/col`
notation.  `use_index` errors if the named index matches no filter for that member.
`no_index` with no `ix` forbids all indexes (full table scan).
(Verify exact index name convention — see open question 6 in the Schema section.)

---

## Test harness details

Copy from `tests/mdbx_query_test.lua`:
- `test` table with ordered-insert metamethod.
- `with_db(name, fn)` — opens temp db, runs fn, closes and cleans up.
- `cleanup(file)` — removes db and lock file.
- Simple assertion helpers: `assert_eq(a, b, msg)`, `assert_rows(got, expected_ids)`.
- Test runner at bottom iterates `test` in insertion order.

Do not use `require'scite'` or any module not loaded by the standard test bootstrap.

---

## Implementation stages

### Stage 1 — Schema + fixture (resolve all schema open questions first)
- Implement `blog_schema()` or its low-level equivalent.
- Implement `with_db`, `build_fixture`, basic assert helpers.
- Insert fixture rows; verify raw counts.
- **Stop. Ask for review before proceeding.**

### Stage 2 — Simple queries (sections 1-7)
- Full scan, select, terminals, equality/range/null/in/filter, chaining.
- **Stop. Ask for review.**

### Stage 3 — Joins (sections 8-11)
- Resolve multi-table chain open question first.
- **Stop. Ask for review.**

### Stage 4 — Order, limit, distinct, alias (sections 12-15)
- **Stop. Ask for review.**

### Stage 5 — Existence and FK filters (sections 16-21)
- Resolve Q-B, Q-C, Q-D before writing.
- **Stop. Ask for review.**

### Stage 6 — Aggregates, having, nested_join, computed cols, hints (sections 22-28)
- Resolve Q-A, Q-E before writing sections 26-27.
- **Stop. Ask for review.**

---

## Summary of all open questions (to resolve before each stage)

| # | Stage | Question |
|---|-------|----------|
| S1 | 1 | Paper language -> mdbx path: use `schema:def+apply` or low-level API? |
| S2 | 1 | `int` type token in schema_std? |
| S3 | 1 | `ctime` type token in schema_std? |
| S4 | 1 | `enum'...'` call form correct? |
| S5 | 1 | `pk(post, tag)` composite PK form correct? |
| S6 | 1 | Auto-generated index name convention (`table/col`?) |
| U  | all | Which doc features are not yet implemented? (`or_where`, `like`, `in_(q)`, `union{q}`, `use_counts`, standalone `explain`) |
| QA | 2,6 | `get_cols(member, cols)` exact call form and return convention |
| QB | 5 | `outer'ref'` vs `mdbx_outer'ref'` in test env |
| QC | 5 | `where_exists(fn)`: proxy `o` semantics |
| QD | 5 | `where_has(tbl, fn)`: what `fn` receives |
| QE | 6 | `nested_join(fn)`: what `fn` receives and returns |
| QF | 4 | `distinct(cols)`: field name strings, not `member.col`? |
| QG | 6 | `having(col,...)`: `col` is aggregate output field name? |
| M  | 3 | Multi-table join chain (`#acc > 1`) — what is the actual behavior? |
