# Grid text benchmark results

Measured 2026-08-22 with Headless Chrome 151.0.7922.137 and Firefox ESR
140.13.0 at a common 1366 x 682 CSS-pixel viewport (DPR 1). The fixture uses
the real grid/UI rendering path: 1,000 backing rows, 25 80px columns, and 322
visible cell texts per frame. Variants rotate every frame and rotate order each
cycle. Scrolling exposes one new row per cycle. Each table entry averages the
reported mean over repeats; percentages are relative to baseline.

## All visible cell values overflow

Three repeats, 15 warm-up and 80 sampled frames per variant:

```sh
node bench/run_grid_text_bench.mjs \
  both \
  baseline,no_text_clip,truncate_clip,truncate_no_clip,truncate_ratio_clip,no_fill_text \
  3 15 80 25 long scroll interleave
```

| Variant | Chrome total | Firefox total |
|---|---:|---:|
| `baseline` | 9.13ms | 22.01ms |
| `no_text_clip` | 7.62ms (-16.6%) | 20.53ms (-6.7%) |
| `truncate_clip` | 9.39ms (+2.9%) | 20.43ms (-7.2%) |
| `truncate_no_clip` | 7.73ms (-15.3%) | 18.47ms (-16.1%) |
| `truncate_ratio_clip` | 8.79ms (-3.7%) | 19.84ms (-9.9%) |
| `no_fill_text` | 6.72ms (-26.4%) | 10.30ms (-53.2%) |

Median repeat p50 totals were 8.3ms in Chrome and 20ms in Firefox for the
baseline. They fell to 6.9ms (-16.9%) and 17ms (-15%) with exact cached
truncation plus clip removal.

## Half of visible cell values overflow

Two repeats with alternating long/short values and otherwise identical setup:

```sh
node bench/run_grid_text_bench.mjs \
  both \
  baseline,no_text_clip,truncate_clip,truncate_no_clip,no_fill_text \
  2 15 80 25 mixed scroll interleave
```

| Variant | Chrome total | Firefox total |
|---|---:|---:|
| `baseline` | 7.93ms | 21.10ms |
| `no_text_clip` | 7.27ms (-8.3%) | 19.52ms (-7.5%) |
| `truncate_clip` | 8.50ms (+7.2%) | 20.16ms (-4.5%) |
| `truncate_no_clip` | 7.74ms (-2.4%) | 18.77ms (-11.0%) |
| `no_fill_text` | 6.16ms (-22.4%) | 10.72ms (-49.2%) |

`no_text_clip` deliberately permits text to paint across cell boundaries; it
isolates clipping cost but is not a production rendering mode.
`truncate_no_clip` is the visually viable combined experiment. Exact fitting
uses a binary search only on cache misses and caches by variant, font, cell
width, and original string. `truncate_ratio_clip` uses the already available
full text width for a one-shot proportional estimate; variable-width glyphs
make it unsuitable for safely removing the clip.

These are relative headless-renderer comparisons, not a prediction of absolute
GUI frame times. Gains will depend mainly on the number and length of visible
overflowing values.

## Bitmap atlas experiments

The complete-string atlas performs one `drawImage` per text command. The crop
variants reproduce horizontal clipping by cropping the source rectangle, with
no ellipsis. The slot variants instead allocate only the visible cell-width
bitmap and clip the original full `fillText` into it on a cache miss. They need
no substring fitting or truncated-text-length API. Two repeats, scrolling long
values:

```sh
node bench/run_grid_text_bench.mjs \
  both baseline,atlas_crop,atlas_slot_crop,atlas_small_crop,atlas_slot_small_crop,no_fill_text \
  2 15 80 25 long scroll interleave Arial
```

| Variant | Chrome total | Firefox total |
|---|---:|---:|
| `baseline` | 10.91ms | 22.31ms |
| `atlas_crop` (2048 pages) | 31.42ms (+187.9%) | 18.17ms (-18.5%) |
| `atlas_slot_crop` (2048 pages) | 30.01ms (+175.0%) | 17.42ms (-21.9%) |
| `atlas_small_crop` (256 pages) | 9.46ms (-13.3%) | 19.16ms (-14.1%) |
| `atlas_slot_small_crop` (256 pages) | **8.97ms (-17.8%)** | **18.04ms (-19.1%)** |
| `no_fill_text` | 5.54ms (-49.3%) | 10.73ms (-51.9%) |

The cell-width slot is better than storing the full string on both engines and
also consumes less atlas area. The bounded slot is the best common strategy.
Firefox gains another 2.8 points from a 2048 page, but that large live canvas is
still disastrous in scrolling Chrome. It was only 6.2% slower in a fully
warmed, non-scrolling Chrome run, so the scrolling regression is caused by
mutating the large source as new strings enter the viewport rather than by a
steady-state `drawImage`. Small pages contain that source invalidation and turn
the Chrome result into a gain.

A production cache would also need bounded storage/eviction and keys covering
text, visible source interval/alignment, font, fill color, device pixel ratio,
and other raster-affecting state.

The literal word-atlas experiment avoids nearly all scrolling churn because
only the shared visible prefix is rasterized, but it needs about 719 blits per
frame rather than roughly 372 complete-string blits:

```sh
node bench/run_grid_text_bench.mjs \
  both baseline,atlas_words_crop,atlas_words_small_crop,no_fill_text \
  3 15 80 25 long scroll interleave Arial
```

| Variant | Chrome total | Firefox total |
|---|---:|---:|
| `baseline` | 10.33ms | 23.64ms |
| `atlas_words_crop` (2048 pages) | 12.60ms (+22.0%) | 21.72ms (-8.1%) |
| `atlas_words_small_crop` (256 pages) | 12.79ms (+23.9%) | 21.86ms (-7.5%) |

The word atlas is inferior to one cached bitmap per complete displayed string
on both engines. The extra blits cost more than the avoided rasterizations.
Splitting further into glyphs would increase that unfavorable draw-call count.

## Font comparison in Firefox

Two repeats of the unmodified renderer with a static viewport and overflowing
values. `Arial` resolves to Liberation Sans on this Linux host; the other
families were also verified through fontconfig.

| Requested family | Draw | Total | Total vs. `Arial` |
|---|---:|---:|---:|
| `Arial` (Liberation Sans) | 20.41ms | 26.18ms | reference |
| `DejaVu Sans` | 20.66ms | 26.59ms | +1.6% |
| `FreeSans` | 21.70ms | 27.74ms | +6.0% |
| `Nimbus Sans` | 22.41ms | 28.51ms | +8.9% |
| `monospace` (DejaVu Sans Mono) | 22.61ms | 28.79ms | +10.0% |
| `Lato` | 31.86ms | 37.39ms | +42.9% |

None of the tested alternatives beat the current local `Arial` fallback.
Lato is substantially slower in Firefox, so changing font is not a useful
performance lever here and can easily regress it. Font metrics and rasterizers
are platform-specific, so this result should not be generalized to an actual
Arial installation on another OS.

## Layout phase breakdown

Three repeats, 20 warm-up and 100 sampled scrolling frames:

```sh
node bench/run_grid_text_bench.mjs \
  both baseline 3 20 100 25 long scroll interleave Arial
```

| Layout component | Chrome | Firefox |
|---|---:|---:|
| Total layout | 3.84ms | 5.31ms |
| Build visible cell/frame commands | 1.41ms | 2.87ms |
| Recursively lay out those commands | 1.63ms | 1.71ms |
| Residual coordinate translation | 0.05ms | 0.07ms |
| Native `measureText` (14 misses/frame) | 0.30ms | 0.39ms |

The apparent translation hotspot was mostly the grid frame callback building
visible cell commands and the nested layout it triggers. Actual coordinate
offsetting is negligible. The existing text-metric cache limits native
`measureText` work to the newly exposed row while scrolling; a perfect repeated
value reduced native calls to zero, but direct measurement is only about
0.3--0.4ms/frame in the unique-value case.

To isolate the text node's generic-layout cost, `no_fill_text` retained all
cell text commands while making native painting a no-op; `no_cell_text` omitted
only those commands. Averaged over two corrected-instrumentation repeats:

| Comparison | Chrome | Firefox |
|---|---:|---:|
| Layout with text nodes, no `fillText` | 4.44ms | 5.43ms |
| Layout without cell text nodes | 2.68ms | 3.33ms |
| Removable text-node layout delta | **1.76ms** | **2.09ms** |

This makes a grid-specific, fixed-geometry text draw command worth prototyping:
the grid already knows each cell rectangle, so its ordinary single-line text
does not need the general text measure/position/translate path. That saving is
separate from replacing `fillText`; a fixed command combined with a cropped
complete-string atlas is the most promising next experiment.
