const fs = require('fs')
const vm = require('vm')
const path = require('path')

const SRC = path.join(__dirname, '..', '..', 'www', 'ui_validation.js')

let ctx = {
	console,
	TextEncoder,
	ui: {},
	glue: {
		isstr: v => typeof v == 'string',
		repl: (v, v0, v1) => v === v0 ? v1 : v,
		property: () => {},
		assert: v => { if (!v) throw new Error('assertion failed'); return v },
		obj: () => Object.create(null),
		map: () => new Map(),
		wordset: s => Object.fromEntries((s || '').split(/\s+/).filter(Boolean).map(k => [k, true])),
		empty_array: [],
		return_true: () => true,
		words: s => (s || '').split(/\s+/).filter(Boolean),
		uniq_sorted: a => a,
		try_json_arg: JSON.parse,
		assign: Object.assign,
		announce: () => {},
		S: (k, s) => s,
	},
}
ctx.window = ctx

vm.createContext(ctx)
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, {filename: SRC})

let rules = ctx.validation_rules
let failed = 0

function eq(got, want, what) {
	if (got === want)
		return
	failed++
	console.error(`FAIL ${what}: got ${got}, want ${want}`)
}

let maxlen = rules.maxlen.validate

eq(maxlen({maxlen: 4}, 'abcd'), true , 'four ASCII bytes fit')
eq(maxlen({maxlen: 4}, 'abcde'), false, 'five ASCII bytes do not fit')
eq(maxlen({maxlen: 4}, 'éé'), true , 'two two-byte characters fit')
eq(maxlen({maxlen: 4}, 'ééa'), false, 'mixed text over the byte limit does not fit')
eq(maxlen({maxlen: 3}, '€'), true , 'one three-byte character fits')
eq(maxlen({maxlen: 4}, '😀'), true , 'one four-byte character fits')
eq(maxlen({maxlen: 4}, '😀a'), false, 'four-byte character plus ASCII does not fit')
eq(maxlen({maxlen: 1}, 1), true, 'non-string parsed values are ignored')

eq(rules.min_len.validate({min_len: 2}, 'ab'), true,
	'min_len reads the JavaScript string length')
eq(rules.max_len.validate({max_len: 1}, 'ab'), false,
	'max_len reads the JavaScript string length')

if (failed)
	process.exit(1)

console.log('ui_validation: all tests passed')
