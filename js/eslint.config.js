const fs = require('fs')
const path = require('path')
const page_globals = require('./.eslint-globals.json')

const glue_source = fs.readFileSync(
	path.join(__dirname, '..', 'www', 'glue.js'),
	'utf8'
)
const glue_exports = new Set(
	glue_source.split('let glue = {')[1]
		.split('\n}', 1)[0]
		.match(/[A-Za-z_$][\w$]*/g)
)

const globals = {}
for (const k of page_globals)
	if (!glue_exports.has(k))
		globals[k] = 'readonly'

module.exports = [
	{
		ignores: [
			'www/lezer.js',
		],
	},
	{
		files: ['www/**/*.js'],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: 'script',
			globals: globals,
		},
		rules: {
			'no-undef'          : 'error',
			'no-const-assign'   : 'error',
			'no-dupe-args'      : 'error',
			'no-dupe-keys'      : 'error',
			'no-dupe-else-if'   : 'error',
			'no-duplicate-case' : 'error',
			'no-unreachable'    : 'error',
			'no-unsafe-negation': 'error',
			'no-cond-assign'    : 'error',
			'use-isnan'         : 'error',
		},
	},
]
