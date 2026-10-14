"use strict"

const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const {compileFunction} = require('node:vm')

const noop = () => {}
const window = {
	ui: {
		icon_def: noop,
		animate: noop,
		saved_state: Object.create(null),
	},
}
const navigator = {userAgent: 'node', language: 'en-US'}
const document = {
	currentScript: {hasAttribute: () => false},
	documentElement: {lang: '', getAttribute: () => null},
}

function load(name) {
	const filename = join(__dirname, name)
	const source = readFileSync(filename, 'utf8')
	compileFunction(source,
		['window', 'navigator', 'document', 'addEventListener', 'glue'],
		{filename})(window, navigator, document, noop, window.glue)
}

load('glue.js')

window.ui.save_state = function(id, k, v) {
	window.glue.attr(this.saved_state, id)[k] = v
}

load('ui_field.js')
load('ui_nav.js')

module.exports = {ui: window.ui, glue: window.glue}
