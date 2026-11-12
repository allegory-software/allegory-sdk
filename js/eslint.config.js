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

// globals that our scripts and the page define.
for (const k of [
	'Math3D', 'plane_graph', 'house_plan', 'earcut', 'suncalc',
	'DEBUG_PLAN', 'DEBUG_PLAN_LOAD', 'DEBUG_MODEL3',
	'user',
])
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
	{
		files: ['www/ui_call_blur_worker.js'],
		languageOptions: {
			globals: {
				importScripts: 'readonly',
				Vision: 'readonly', // from mediapipe/vision_bundle.js
			},
		},
	},
	{
		files: ['www/ui_call_e2ee.js', 'www/ui_call_e2ee_worker.js'],
		languageOptions: {
			sourceType: 'module',
		},
	},
]
