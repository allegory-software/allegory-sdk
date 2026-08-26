# Grid text benchmark

Runs the real `ui.grid` rendering path in Chrome and/or Firefox. The runner
serves the fixture locally and generates an instrumented `ui.js` in memory;
it does not modify `www/ui.js`.

```sh
node js/tests/grid-bench/run_grid_text_bench.mjs \
  both \
  baseline,no_text_clip,baseline,truncate_clip,truncate_no_clip,baseline,max_width,baseline \
  1 20 80 25 long scroll interleave Arial
```

Arguments are: browser (`chrome`, `firefox`, or `both`), comma-separated
variant sequence, repeats, warm-up frames, sample frames, column count, text
mode (`short`, `long`, `mixed` for alternating long/short values, or `repeated`
for one shared long value), optional `scroll`, optional `interleave`, and the
optional font family (default `Arial`).
With `interleave`, the runner rotates variants every frame; warm-up and sample
counts then apply to each variant. Variant order is shifted each cycle to spread
first-frame and cache-miss work evenly. This is preferred for comparative runs.
When combined with `scroll`, the viewport advances once per complete variant
cycle, so every variant sees the same rows.

Useful variants:

- `baseline`: unchanged text drawing.
- `count_calls`: count native `fillText` and `measureText` calls.
- `no_fill_text`: retain layout and clipping but make `fillText` a no-op.
- `no_text_clip`: disable only the clipping branch in `draw[CMD_TEXT]`.
- `truncate_clip`: cached exact binary-search truncation, retaining clipping.
- `truncate_no_clip`: the same exact truncation, then omit clipping.
- `truncate_ratio_clip`: proportional one-shot truncation, retaining clipping.
- `max_width`: pass the cell width as Canvas `fillText`'s `maxWidth`; this
  scales text horizontally and is a performance comparison, not ellipsis.
- `atlas_clip`: cache each complete string in a 2048 x 2048 canvas atlas and
  retain the destination clip.
- `atlas_crop`: cache each complete string in a 2048 x 2048 atlas, source-crop
  the blit to the cell, and omit the destination clip.
- `atlas_small_crop`: the same complete-string experiment using bounded
  256 x 256 pages. This limits source-canvas invalidation when new strings are
  rasterized while scrolling.
- `atlas_slot_crop` and `atlas_slot_small_crop`: allocate only the visible
  cell-width slot in a 2048 x 2048 or 256 x 256 atlas, clip the original full
  `fillText` into that slot on a miss, then blit the pre-clipped bitmap. This
  needs no substring fitting or truncation-length API.
- `atlas_words_crop` and `atlas_words_small_crop`: split strings into word
  runs and cache/blit only runs intersecting the cell, using 2048 x 2048 or
  256 x 256 pages respectively.
- `no_cell_text`: omit the standard cell text command entirely.

Results are emitted as one JSON object per line. In addition to frame make,
layout, draw, and total timing, `layout_phases_ms` reports the root layout
passes, time spent building visible frame contents (`frame_make`), recursively
laying those contents out (`frame_layout`), native text measurement, and
residual translation. Atlas results also report blits and rasterizations per
frame.

Use paired sequences with a baseline before and after a variant to limit
browser warm-up and load drift. The latest checked cross-browser results are in
`RESULTS.md`.
