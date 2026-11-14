// run: node tests/roof_overhang_probe_test.js
// prints the roof skeleton faces of an L plan with a gable end, to see the
// arcs at the footprint corners (input for the R3 overhang design).
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const sdk = path.resolve(__dirname, '..')
const ctx = {console, setTimeout, clearTimeout, TextEncoder, TextDecoder,
	URL, URLSearchParams, performance, Intl, atob, btoa, queueMicrotask}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let f of ['glue.js', 'roof_skeleton.js'])
	vm.runInContext(fs.readFileSync(path.join(sdk, 'www', f), 'utf8'), ctx,
		{filename: f})
// L: 600 x 400 with a 300 x 300 wing; edge 0 is a gable end.
let ring = [[0, 0], [600, 0], [600, 400], [300, 400], [300, 700], [0, 700]]
let pitches = [90, 45, 30, 45, 45, 45]
for (let face of ctx.roof_skeleton([ring], pitches, 0))
	console.log(JSON.stringify(face.edge_is), JSON.stringify(face.rings[0]
		.map(([x, y, z]) => [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)])))
