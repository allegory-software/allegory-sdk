# mdbx_query.lua - architecture and implementation guide

This doc is a running log of explanations built up while reading through
mdbx_query.lua. It starts with the high-level picture (what the module is
trying to do, and why it's shaped the way it is), goes stage by stage
through compile() and the executor, then adds deep-dive sections on
specific concepts as they come up in later questions.

## What is this actually trying to do

MDBX gives you nothing but sorted key-value B+trees and cursors that walk
them in key order. No query language, no planner. You already know this
from writing [mdbx_schema.lua](lua/mdbx_schema.lua) — a table is one tree
keyed by primary key, an index is another tree keyed by
indexed-columns-then-pk.

mdbx_query.lua's job is to let you write something that reads like SQL,
and turn it into a sequence of cursor operations that produce the right
rows, using an index instead of reading every row whenever the query
shape allows it.

Two design choices shape everything downstream:

**1. Build first, run later.** You chain methods (`where`, `join`,
`select`, ...) to build up a "relation" value. Nothing touches the
database until a terminal method (`rows()`, `count()`, ...) is called.
This matters because deciding whether an index helps requires seeing the
*whole* query at once — one `where()` call in isolation tells you
nothing; you need every condition together to know which columns are
pinned down.

**2. No statistics, no cost model.** A real SQL engine picks a plan by
estimating row counts and costs. This module has none of that. It has a
fixed set of structural rules: "if there's an equality condition on the
primary key's first column, seek to it; if there's a range, scan that
range; otherwise scan everything and check each row by hand." The plan
depends only on the *shape* of the query and the schema, never on what
data is actually in the table. That's simpler and fully predictable, at
the cost of sometimes picking a worse plan than a real optimizer would.

Because of choice 2, "the stages" aren't really a cost-based search over
alternative plans. They're closer to a compiler: parse -> resolve names
-> classify what each condition can prove -> pick one deterministic scan
strategy per table -> generate an executor. That compiler framing is the
right one to hold in your head.

## The two halves

- **Compile time** (once per relation, triggered lazily by the first
  terminal call): resolve names, decide which index each table scans,
  decide join order, decide whether sort/dedup can be skipped. Expensive,
  done once.
- **Run time** (once per `rows()`/`count()`/... call, can repeat with
  different params): walk cursors, decode rows, evaluate leftover
  checks, group/sort/limit. Cheap, repeatable — because params never
  change the plan, only which rows a fixed plan visits.

## The stages

**1. Building the relation** (`Rel` methods, `parse_*` functions)
In: your method calls (`where`, `join`, `select`, ...). Out: a relation
value that's just stored, unvalidated data — lists of conditions, a
select-outputs list, etc. Nothing is checked against a schema yet. Why:
this gives you a mutable value the rest of the pipeline can transform in
place, and it decouples *how you wrote the query* (method call order)
from *what order it runs in* (fixed SQL order) — the builder just
accumulates, order is imposed later.

**2. Expressions** (`q.col`, `q.eq`, `q.exists`, ...)
Each of these just builds a small tagged Lua table like `{'eq', a, b}`.
Not resolved to anything real yet — no schema knowledge is needed to
construct one. Why: expressions need to exist as a rewritable tree,
because later stages need to walk them (to bind names, to classify
facts, to reshape `q.or_` into `q.in_`, etc.) without re-parsing
anything.

**3. `compile()` entry**
This one function does everything from here on, in a single recursive
pass — recursive because a subquery (in `exists()`, `in_()`, or a join
source) gets compiled too, with this relation as its parent scope. It's
triggered lazily by the first terminal call, remembers which terminal
kind (`rows`, `count`, `exists`, ...) it was compiled for, and refuses to
compile again for a different kind. Why lazy: a relation might be
embedded as someone else's subquery and never compiled standalone at
all.

**4. `resolve_sources`**
In: the raw `source`/`joins` list. Out: a `members` list — one entry per
table or nested relation participating in this query, each with a name
(its alias) and the fields it can supply. This step also flattens
"fragments" — an unaliased relation passed to `join()` isn't a subquery,
it's just a way to group several joined tables so `left_join()` can
treat the whole group as one atomic optional unit; its members get
merged straight into this relation's member list, and its `where()`
conditions get merged into the join's `on` condition. (See the deep dive
below.)

**5. Output name maps**
Before any name gets resolved, the compiler needs to know what
`select()`/`group()` produce as named outputs, because some later
expressions (like `order_by()` after a `group()`) bind against *those*
names instead of table columns.

**6. Scope + `bind_expr`** — name resolution
This walks every expression tree stored anywhere in the relation and
rewrites each `q.col()` node in place to point at a real field: which
member, which column. It uses a different lookup scope depending on
where the expression sits — `where()`/join `on` look up table fields,
`having()` looks up group outputs, `select()` after a `group()` looks up
group outputs, and so on. Nested relations get a "parent scope" chained
on, so `q.outer()` inside them can validate that a name resolves
*outside* the subquery. This is exactly the scoping problem a compiler
solves for nested function bodies — same shape, different vocabulary.

**7. Condition splitting and fact classification**
`where()` conditions and a top-level `q.and_()` both get flattened into
one list of independent conditions (since `A and B and C` can be checked
as three independent things, whichever order is convenient). Each
condition is then tagged with a "fact kind" — equality, range, prefix,
membership, existence, or null — *if* its shape is one an index could in
principle answer. `q.or_(eq, eq, eq)` over the same column gets
rewritten into `q.in_()` here too, since a seek-based plan can handle
that just as well as a real `in_()`. Anything that doesn't fit one of
those shapes just stays an ordinary condition with no fact kind — it'll
be checked row by row later, never used to drive a seek. (See the deep
dive below on how "fact" relates to "condition".)

**8. Cursor choice / access planning** — the actual "planner"
This is the core of the module. For each table member, it looks only at
the conditions that mention *that one member and nothing else*, and
asks: how many leading columns of some key (the primary key, or an
available index) does an equality condition pin down exactly? Can the
next column after that be narrowed by a range, a prefix, or a membership
list? That answer — which key, how many leading columns are pinned, what
(if anything) bounds the next one — *is* the plan for scanning that
member. Everything not covered by the chosen key becomes a "residual"
row check, run after the row is fetched. There's one extra rule: if
there's a `limit()` and the scan's natural order already matches
`order_by()`, that ordered scan can beat a filter-driven plan, because
stopping early after N rows in the right order can be cheaper than
filtering everything then sorting and truncating it.

This stage also decides join order: a member can only start scanning
once every member its `on_expr` reads from has already been scheduled (a
dependency sort — cycles are a compile error), and it records whether
the resulting overall scan order happens to already satisfy
`order_by()`/`group()`/`distinct()`, so later stages know whether they
can skip materializing everything just to sort or dedupe it.

Why no cost model here either: picking "the best" index in general needs
row-count estimates. This code sidesteps that by using a purely
structural ranking — more pinned/narrowed key columns wins, ties broken
by fact kind. It can't be "wrong" in the sense of returning bad rows,
only "not optimal" in the sense a cost-based planner might do better on
skewed data.

**9. Executor construction** (still compile time)
Each chosen access plan gets turned into a reusable "opener" — a closure
factory that, when called, opens real MDBX cursors and hands back
`run()`/`close()` functions. Built once per compiled relation, not once
per call to `rows()` — because building all these value-reading closures
is real work you don't want to repeat every execution, let alone every
row.

**10. Run time: join execution** (`run_query`/`build_processors`)
This is where rows actually get produced. The access steps are wired
into a closure chain, innermost to outermost: scanning step N calls step
N+1's runner once for every one of its rows. Nested loops fall out of
that chain implicitly, without an explicit loop-of-loops in the code.
This module only implements one join strategy — nested loop — which is
the natural consequence of walking dependency-ordered cursors; there's
no hash join or merge join.

**11. Residual and late conditions**
A condition an index only partially proved gets checked the moment its
member's row is available (attached right to that step). A condition
that reads more than one member can't be checked until every member it
needs has been scanned, so those run last, after a full row combination
is assembled.

**12. Group / having**
Once rows are flowing, they can optionally fold into groups. If the scan
order already keeps equal group keys next to each other, grouping is
streaming (single pass, no memory). Otherwise it falls back to a hash
table keyed by the group key. `having()` then filters finished groups.

**13. Select / distinct / sort / limit**
`select()` turns the row into named output fields. `distinct()` removes
duplicates — streaming (adjacent-only) when the scan order already
groups equal rows together, hash-set otherwise. Sorting only happens if
the chosen scan order doesn't already satisfy `order_by()` — this is the
same "did stage 8 already give me this order" fact reused three times
(group, distinct, sort). `limit()`/`offset()` get pushed down into the
raw scan itself when nothing downstream needs every row first (no
group/distinct/explicit sort), stopping the cursor early by throwing a
sentinel value up through a `pcall` — a deliberate use of Lua's error
mechanism as a fast way to unwind out of the nested closures from stage
10.

**14. Terminals**
`rows()`, `first()`, `one()`, `must_one()`, `count()`, `exists()` are
thin wrappers that differ mainly in how many rows they ask for (1 for
`first()`, 2 for `one()`/`must_one()` — just enough to detect "more than
one exists" without reading everything) and whether they need decoded
output rows at all (`count()`/`exists()` often don't).

That's the whole arc: describe the query as data -> resolve every name
-> classify what each condition can prove -> pick one scan strategy per
table using only structural rules -> wire cursors into a nested-loop
chain -> apply whatever the chosen scans couldn't prove -> group/dedupe/
sort/limit, skipping any step stage 8 already proved unnecessary.

Note: the module header's own "IMPLEMENTATION PLAN" section (stages 1-9
in the doc comment at the top of the file) is a design sketch, not a
literal map of the code. In the real code, stages 3-8 above all happen
inside one call to `compile()`, not as separate passes.

## Deep dives

### resolve_sources: building the member scope

`resolve_sources` (plural) and `resolve_source` (singular) are two different functions doing two different jobs — worth keeping separate in your head since the naming is easy to conflate.

#### What "resolving" means here

`resolve_source` (singular) takes one source — either a table spec
(`{kind='table', table=, alias=}`, produced earlier by
`parse_table_spec`) or a relation object — and turns it into a uniform
shape with three things:
- `.member` — the name it's addressed by (alias if given, else the table
  name)
- `.schema` — for a table, an actual lookup into `mdbx_schema`
  (`db:table_schema(source.table)`) to get the real schema object
- `.fields` — a name-to-field map

For a table, `.fields` comes straight from the schema. For a relation
source, there's no schema — instead `.fields` is synthesized from the
*already-compiled* subquery's `returned_fields`: `{name = name, index =
i}` for each output column. So a subquery's output columns become
addressable exactly like table columns, but only the columns it chose to
return — its internals stay invisible. That's the point: after this
step, code anywhere downstream (name binding, index planning) can treat
"a table" and "a subquery result" identically, through the same
`.member`/`.fields` shape, without caring which one it actually is.

So "resolving" = going from *what the user wrote* (a bare string, or a
`Rel` object) to *a concrete, schema-backed thing with known columns* —
the same sense as "resolving a symbol": you had a name, now you have the
definition it points to.

#### Why build the members list

`resolve_sources` (plural) is the driver: it calls `resolve_source` on
the base source and every join's right side, and assembles the results
into `rel.members` — both an ordered array and a name-to-source map
(`members[source.member] = source`).

This list is what stage 6 (`bind_expr`, specifically
`find_member`/`find_col`) searches when it resolves `q.col()`. Qualified
refs (`q.col('p.title')`) look up `members['p']` directly — O(1) map
lookup. Unqualified refs (`q.col('title')`) have to walk the ordered
array checking every member's `.fields` for one that has that column,
raising "ambiguous field" if more than one does — that needs the array,
not just the map, since it has to check *all* candidates before
deciding. The map is also how alias collisions get caught
(`assertf(not members[source.member], 'duplicate source member')`).

Stage 8 (`choose_access`) also consumes this list — `access_conditions`
and `referenced_members` check whether a `q.col()`'s bound `.source` is a
member of *this* relation's flat scope (`members[expr.source.member] ==
expr.source`) versus belonging to an outer scope. So the members list is
really the flat symbol table this whole compile pass resolves names
against.

#### The fragment "contradiction" — it isn't one, it's two different concerns

A fragment always flattens its members into the parent's name scope, but
also stays grouped as one atomic unit at execution time for
`left_join()`. Both are true, but they answer two unrelated questions,
at two different stages:

**Stage 4 (`resolve_sources`, naming):** a fragment *always* flattens
its members into `rel.members`, regardless of whether it was passed to
`join()` or `left_join()`. This has to happen because a fragment is
unaliased by definition — it's not a subquery, it's just a grouping
device. If its members didn't flatten into the parent's name scope,
you'd have no way to write `q.col('pt.tag')` from the outer query at
all; you'd need an alias, which is exactly what turns it into an aliased
sub-relation instead of a fragment. So flattening at the naming level is
what makes a fragment a fragment rather than a subquery — it's the whole
reason the feature exists.

**Stage 8 (`build_access`, execution):** here the join kind actually
matters, and this is a separate question — not "what can I call this
table," but "does matching-or-not get decided per table, or for the
whole cluster together." Look at
[mdbx_query.lua:1892-1902](lua/mdbx_query.lua#L1892-L1902):

```lua
if picked.kind == 'join' then
	add(access, base_step)
	scheduled[fragment.source.member] = true
	build_access(fragment.joins, scheduled, access)
else
	local nested_scheduled = {[fragment.source.member] = true}
	local nested = {base_step}
	build_access(fragment.joins, nested_scheduled, nested)
	add(access, {member = false, join = picked, nested = nested})
end
```

For `join()` (inner), the fragment's steps get added straight into the
*flat* access list, same level as everything else. That's correct
because inner join semantics already are "all or nothing" — if any table
in the fragment fails to match, the whole combination gets dropped
regardless of whether you tracked it as one group or several. So there's
nothing to gain from grouping; flat is simpler and works.

For `left_join()`, the fragment's steps get collected into their own
`nested` sub-list and wrapped as *one* access entry (`{nested =
nested}`). That's what makes execution (stage 10, `build_processors`)
treat it as one unit: it runs the whole nested chain, and only if
nothing in it matched does it null-extend *every* member in the fragment
together (`step_members` walks the nested group recursively to collect
all their names before nil-ing them out). If the fragment had instead
been flattened at this stage too, each table would get its own
independent left-join slot, and you could end up with a row where table
A of the fragment matched but table B didn't — the exact thing atomicity
is meant to prevent (a category matched through post_tag but not through
tag, say, producing a nonsensical half-joined cluster instead of "this
whole chain either connects or none of it does").

So: same word "flatten" describes two unrelated mechanisms — one is
about *what names are visible* (always flattens), the other is about
*what optionality unit rows and null-extension respect* (flattens only
when there's no optionality decision to make, i.e. inner join; stays
grouped when there is, i.e. left join). No contradiction — the naming
scope and the execution grouping are just orthogonal, and inner join
happens to make the execution-level distinction moot.

### fact vs condition: separate objects or one augmented object?

It's an augmentation that then partially crystallizes into a separate
object — two stages, worth separating clearly:

**The condition**
([mdbx_query.lua:1370-1393](lua/mdbx_query.lua#L1370-L1393)) is the
enduring record. `split_conditions` creates one per top-level AND-branch:
`{kind = nil|fact_kind, expr = expr}`. `kind` is just a string tag
(`'equality'`, `'range'`, `'prefix'`, `'membership'`, `'existence'`,
`'null'`) looked up from `fact_kind[expr[1]]` — it doesn't pull anything
out of the expression, it just labels the condition with what *shape* it
has. This is the object stored in `rel.where_conditions`,
`rel.having_conditions`, `join.on_conditions`, and it keeps accumulating
fields as compile goes on: `.member` gets set by `attribute_conditions`
([mdbx_query.lua:1497-1509](lua/mdbx_query.lua#L1497-L1509)) once it's
known that exactly one member's columns are referenced, and `.consumed`
gets set later once something actually uses it.

**The fact** (as `bucket_facts` at
[mdbx_query.lua:1544-1604](lua/mdbx_query.lua#L1544-L1604) builds it) is
a different, smaller, throwaway object. For each member being planned,
`bucket_facts` walks that member's conditions and, for each one whose
`kind` says it *could* drive a seek, pulls the actual operand value out
into a per-column bucket entry: `eq[col] = {cond = cond, expr = val}`,
or for range `bucket[col] = {cond = cond, op = rop, expr = val}`, etc.
These bucket entries are keyed by column name, in five separate tables
(`eq`, `lo`, `hi`, `prefix`, `in_by`), and they carry a back-pointer
(`.cond`) to the condition they came from — that's how `choose_access`
later does `fact.cond.consumed = true` once it decides to actually use
that fact for the chosen key.

So: `kind` on the condition is a classification tag, cheap and
permanent. The bucket entry is a real extraction step — decode "this
condition, applied to this member, says column X equals/starts-with/
ranges-over this value" into a plain `{cond=, expr=[, op=]}` record —
done fresh inside `bucket_facts` every time a member's access plan is
computed, then discarded once `choose_access` returns. It exists so
`try_key` can reason about "what do I know about column X" by column,
without re-inspecting expression shapes, and so the first-wins-per-column
bucketing rule ("each column gets one fact per kind... duplicate facts
stay residual checks") has a natural place to live.

One condition can also produce zero facts (if `member_operand` can't
find its own member on either side, e.g. a two-column comparison) — in
which case it just never enters any bucket and stays a residual check,
still carrying its `kind` label but with no fact ever built from it.
