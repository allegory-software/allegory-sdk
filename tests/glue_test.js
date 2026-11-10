// run: node tests/glue_test.js
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
const file = path.resolve(__dirname, '../www/glue.js')
vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, {filename: file})
const {glue} = ctx

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

const list = x => Array.from(x)
const same = (a, b) => JSON.stringify(list(a)) == JSON.stringify(list(b))

check('array_equals', () =>
	glue.array_equals([1, 2, 3], [1, 2, 3]) &&
	!glue.array_equals([1, 2, 3], [1, 2]) &&
	!glue.array_equals([1, 2, 3], [1, 2, 4]) &&
	glue.array_equals([1, 2, 3], [1, 2, 4], 0, 2) &&
	!glue.array_equals([1, 2, 3], [1, 2], 0, 3))

check('replace_value', () => {
	let a = [1, 2, 3, 2]
	return glue.replace_value(a, 2, 9) == 1 && same(a, [1, 9, 3, 2]) &&
		glue.replace_value(a, 7, 0) == -1
})

check('group_sorted', () =>
	same(glue.group_sorted([1, 1, 2, 3, 3, 3], (a, b) => a == b),
		[[0, 2], [2, 3], [3, 6]]) &&
	same(glue.group_sorted([], (a, b) => a == b), []) &&
	same(glue.group_sorted([5, 5, 6], (a, b) => a == b, 1), [[1, 2], [2, 3]]))

check('set_toarray', () => same(glue.set_toarray(new Set([1, 2, 3])), [1, 2, 3]))

check('hypot', () =>
	glue.hypot(3, 4) == 5 && glue.hypot(0, 0) == 0 && glue.hypot(-3, 4) == 5 &&
	isFinite(glue.hypot(1e200, 1e200)))

check('distance', () => glue.distance(0, 0, 3, 4) == 5)

check('gen_id counts per prefix and turns off', () => {
	let a = glue.gen_id('t1'), b = glue.gen_id('t1'), c = glue.gen_id('t2')
	ctx.DEBUG_GEN_ID = 0
	let off = glue.gen_id('t1')
	ctx.DEBUG_GEN_ID = 1
	return a == 1 && b == 2 && c == 1 && off === null
})

check('push_log_if silences logging until the matching pop_log', () => {
	let lines = []
	let log0 = ctx.console.log, group = ctx.console.groupCollapsed, end = ctx.console.groupEnd
	ctx.console.log = (...a) => lines.push(a.join(' '))
	ctx.console.groupCollapsed = () => {}
	ctx.console.groupEnd = () => {}
	try {
		ctx.DEBUG_LOG = 1
		glue.push_log_if(false, 'a')
		glue.log('hidden')
		glue.push_log('b')
		glue.pop_log('inner')
		let still_off = ctx.DEBUG_LOG
		glue.pop_log('outer')
		glue.log('shown')
		return !still_off && ctx.DEBUG_LOG && same(lines, ['shown']) || 'got ' + lines
	} finally {
		ctx.console.log = log0
		ctx.console.groupCollapsed = group
		ctx.console.groupEnd = end
	}
})

check('callable_constructor', () => {
	class P { constructor(x) { this.x = x } }
	let p = glue.callable_constructor(P)
	return p(5) instanceof P && p(5).x == 5 && p.class === P && p.name == 'P'
})

check('inherit_properties copies what the child lacks', () => {
	class A { a() { return 1 } b() { return 2 } }
	class B { b() { return 3 } }
	glue.inherit_properties(B, A)
	let o = new B()
	return o.a() == 1 && o.b() == 3
})

check('the former glue_ex functions are exported and dumped into window', () => {
	for (let k of ['push_log', 'pop_log', 'push_log_if', 'callable_constructor',
			'inherit_properties', 'replace_value', 'array_equals', 'group_sorted',
			'set_toarray', 'gen_id', 'hypot', 'distance'])
		if (typeof glue[k] != 'function' || ctx[k] !== glue[k])
			return 'missing ' + k
	return true
})

console.log(`${n_pass} passed, ${n_fail} failed`)
process.exit(n_fail ? 1 : 0)
