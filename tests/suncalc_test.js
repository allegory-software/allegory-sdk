// run: node tests/suncalc_test.js
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const ctx = {
	console, setTimeout, clearTimeout, TextEncoder, TextDecoder, URL,
	URLSearchParams, performance, Intl, atob, btoa, queueMicrotask,
}
ctx.window = ctx
ctx.document = {currentScript: {hasAttribute: k => k == 'global'}}
ctx.navigator = {language: 'en', userAgent: ''}
ctx.location = {href: 'http://x/'}
ctx.localStorage = {}
ctx.addEventListener = () => {}
vm.createContext(ctx)
for (let f of ['glue.js', 'suncalc.js']) {
	let file = path.resolve(__dirname, '../www', f)
	vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
}

let n_fail = 0
let n_pass = 0
function check(name, f) {
	let r
	try {
		r = f()
	} catch (e) {
		r = 'threw: ' + e.message
	}
	if (r === true) {
		n_pass++
	} else {
		n_fail++
		console.log('FAIL', name, r === false ? '' : r)
	}
}

// reference values from the upstream SunCalc tests: 2013-03-05 UTC, kyiv.
const t = Date.UTC(2013, 2, 5) / 1000 // this version takes seconds.
const lat = 50.5
const lng = 30.5

check('sun_position', () => {
	let p = vm.runInContext(`suncalc.sun_position(${t}, ${lat}, ${lng})`, ctx)
	return Math.abs(p.azimuth - -2.5003175907168385) < 1e-9 &&
		Math.abs(p.altitude - -0.7000406838781611) < 1e-9 ||
		`azimuth ${p.azimuth}, altitude ${p.altitude}`
})

check('times: solar noon within a second of the upstream value', () => {
	let ts = vm.runInContext(`suncalc.times(${t}, ${lat}, ${lng})`, ctx)
	let upstream = Date.parse('2013-03-05T10:10:57.283Z') / 1000
	return Math.abs(ts.solar_noon - upstream) < 1 ||
		new Date(ts.solar_noon * 1000).toISOString()
})

check('times: sunrise before solar noon before sunset', () => {
	let ts = vm.runInContext(`suncalc.times(${t}, ${lat}, ${lng})`, ctx)
	return ts.sunrise < ts.solar_noon && ts.solar_noon < ts.sunset
})

console.log(`${n_pass} passed, ${n_fail} failed`)
process.exit(n_fail ? 1 : 0)
