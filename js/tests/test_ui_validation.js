const fs = require('fs')
const vm = require('vm')
const path = require('path')

const WWW = path.join(__dirname, '..', '..', 'www')

let ctx = {
	console,
	TextEncoder,
	TextDecoder,
	structuredClone,
	navigator: {language: 'en-US', userAgent: ''},
	document: {
		currentScript: {hasAttribute: () => false},
		documentElement: {lang: 'en', getAttribute: () => 'US'},
	},
	addEventListener() {},
	ui: {},
}
ctx.window = ctx

vm.createContext(ctx)
for (const file of ['glue.js', 'ui_field.js']) {
	const src = path.join(WWW, file)
	vm.runInContext(fs.readFileSync(src, 'utf8'), ctx, {filename: src})
}

let rules = ctx.ui.validation_rules
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
