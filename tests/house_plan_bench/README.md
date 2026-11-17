# House plan Chrome benchmark

Run from any directory:

```sh
node /home/cosmin/sdk/tests/house_plan_bench/bench.mjs /path/to/plan.json
```

Without a filename, use `test-plan.json` in this folder. The input is a saved
house-plan JSON object with at least one floor. Paths are relative to the
current working directory. Legacy plans use the model's existing loader.

```sh
node tests/house_plan_bench/bench.mjs --runs 20 --warmup 3
node tests/house_plan_bench/bench.mjs another-plan.json --runs 5 --warmup 1
```

Requires installed Google Chrome and the existing Playwright installation at
`/usr/local/lib/node_modules/playwright`. The runner serves local SDK files on
an ephemeral localhost port and closes the browser and server on completion.
It does not change the input file or save editor state to disk.

## Samples

The page displays the 2D floor editor beside the full 3D house editor at
1600 by 900 CSS pixels, DPR 1. The 2D editor starts on floor zero; the 3D
editor includes all floors and roofs. The bench positions the 3D camera from
the model's bounding box so that plans at different origins and sizes remain
in view. The bench does not send mouse events.

The report separates:

- First load, including editor creation, WebGL context and shader setup.
- Full reloads after the requested number of warmup loads. Each reload parses
  the file text into a new object, passes it to the existing floor editor,
  and rebuilds the model in the existing 3D editor and WebGL context.
- Unchanged frames, each sampled after a reload. The bench fails if those
  frames reload the plan or rebuild cut walls or model faces.

The bench reports median, p95 and maximum milliseconds. With 20 samples, p95
is the nineteenth sorted sample. First-load results are one observation.
Warmup applies to the browser execution and retained editor/context, not to
the derived geometry: each full reload starts with a new house model.

## Timings

All durations are inclusive. Do not sum parent rows with their nested rows.

| Row | Includes |
| --- | --- |
| Wall time | JSON parsing, wait for the requested frame, frame execution, and final GPU completion wait. Excludes Playwright communication and file/server startup. |
| Frame CPU | The UI animation callback, including hit testing, widget building, layout/preparation and drawing. Excludes JSON parsing and the final GPU wait. |
| Plan loading | Model initialization: wall graph, offsets, room state and object placement. Input JSON parsing has its own row. |
| Wall outlines and opening cuts | Grid paths, opening grouping, and clipping on a cache miss. Reused polygons do not generate a timing event. |
| Roof areas / roof faces | Calls from both 2D preparation and 3D prism construction. Each row sums all calls in the sampled frame. |
| Prism construction | All wall, slab and roof prisms, including any roof geometry and opening clipping computed inside this stage. Excludes prism union. |
| Prism union | Cut/split regions, snapping, cell overlay, top/bottom surfaces, side surfaces and final face merging/lifting. Each substage has its own row. |
| Model components, points, faces | Creation of model components and insertion of points and faces from the union result. |
| Model update | Instance updates, triangulation, normals, render-buffer preparation and buffer uploads. Includes calls made while clearing the previous model. |
| WebGL buffer calls | CPU time inside `bufferData` and `bufferSubData`, across the entire sampled frame. Nested inside model update, renderer setup or drawing. |
| 2D drawing | The floor editor's canvas drawing. Excludes layout/preparation. |
| 3D render and canvas blit | Canvas resize, scene rendering, copying the WebGL canvas into the UI canvas and drawing helper points. This can already wait for GPU work. |
| GPU completion wait | `gl.finish()` after the frame: remaining work for the complete frame, not upload-only GPU time. A short wait does not mean that rendering or uploads were free. |

The report also includes buffer-call counts, bytes supplied to upload calls,
and bytes requested by allocation-only `bufferData` calls. These are traffic
and allocation requests, not retained GPU memory or physical bus transfers.

The runner uses Chrome's normal GPU selection and prints Chrome's version,
WebGL renderer/vendor, plan counts and viewport. Chrome can choose software
rendering in headless mode. Read the renderer before comparing GPU timings;
SwiftShader results measure software rendering on that machine.

## Published probes

Set `window.DEBUG = true` to collect timings. The flag defaults to false
in `glue`; the existing UI debug toggle changes the same flag.
Set `ui.DEBUG_WINDOW = false` to collect timings without displaying the debug
window. It defaults to true, preserving the existing debug-window behavior.

```js
window.DEBUG = true
ui.DEBUG_WINDOW = false
let t = glue.profile_time()
// measured work
t = glue.profile_time('stage.one', t)
// more measured work
t = glue.profile_time('stage.two', t)
console.log(glue.profile_times)
```

`glue.profile_time(stage, t0)` adds the elapsed milliseconds and one call to
`glue.profile_times[stage]`, a `{ms, calls}` record, and returns the current
timestamp. With no arguments, it returns the timestamp without recording a
stage. It creates one record on the first call for each stage and reuses
that record. The bench zeros both fields before each sample and copies the
totals into its result afterward.

When `DEBUG` is false, both helpers return zero without reading the clock
or allocating anything per call. The shared totals table is created once
when loading `glue`.

The production probes record `plan.load`, `wall.openings`, `roof.areas`,
`roof.faces`, `prism.build`, `prism.union`, `prism.cuts`, `prism.snap`,
`prism.cells`, `prism.surfaces`, `prism.sides`, `prism.merge`, `model.create`,
`model.update`, `plan.draw` and `model.draw`. The bench collects unrounded UI
frame timings through `ui.frame_graphs` and measures WebGL calls only inside
its own page.

In the bench page, `window.house_plan_bench` exposes `load(text)`,
`run(reload)` and `info()`. A run returns stage totals and call counts plus
upload/allocation byte counts. The command-line runner checks that full
reloads rebuild the plan and model and that unchanged frames reuse them.
