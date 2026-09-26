const fs = require('fs')
const vm = require('vm')
const path = require('path')
const assert = require('node:assert/strict')

const www = path.join(__dirname, '..', '..', 'www')
const ctx = {
	console, TextEncoder, TextDecoder, structuredClone,
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
for (let file of ['glue.js', 'ui_field.js'])
	vm.runInContext(fs.readFileSync(path.join(www, file), 'utf8'), ctx,
		{filename: file})
Object.assign(ctx, ctx.glue)

const ui_source = fs.readFileSync(path.join(www, 'ui.js'), 'utf8')
function load_section(start, end) {
	let start_i = ui_source.indexOf(start)
	let end_i = ui_source.indexOf(end, start_i)
	assert(start_i >= 0 && end_i > start_i)
	vm.runInContext(ui_source.slice(start_i, end_i), ctx,
		{filename: 'ui.js:'+start})
}

vm.runInContext(`
let build_no = 1
let render_state_map = null
let tab_into_id = null
let applied_edit_n = 0
let a = []
let n = 0
let text_flags = 0
const BOX_ARGS = 0
const id_slot = []
function cmd() { return 1 }
function animate() {}
function clicked() { return false }
function ui_cmd_box_begin() { a = []; n = 0; return 0 }
function ui_cmd_box_end() {
	ui.record = {
		text: a[TEXT_S],
		flags: a[TEXT_FLAGS],
		input_type: a[TEXT_ARGS_I],
	}
}
function next_pass() { build_no++ }
`, ctx)
Object.assign(ctx.ui, {
	focusable() {}, stack() {}, end_stack() {}, bb() {}, p() {}, color() {},
	sp: () => 1,
	em_input: () => 100,
})
load_section('let state_map      =', 'ui.set_state_of =')
load_section('ui.value = function', '//// TEXT BOX')
load_section('ui.focused_id = null', 'ui.focusing =')
load_section('const ALIGN_STRETCH', 'function parse_valign')
load_section('const TEXT_ASC', 'ui.heading =')
load_section('ui.select_text =', 'function remember_select_all')
load_section('function read_input_sel', 'function input_selection_changed')
load_section('ui.process_shared_screen_input =', '// a remote input is wired')
load_section('ui.input = function', '//// NUM_SLIDER')

const ui = ctx.ui
const number_field = ui.create_field({
	type: 'number', name: 'amount', scale: 100, min: 0, max: 500,
})
const other_field = ui.create_field({type: 'number', required: true})
const upper_field = ui.create_field({
	from_input: s => s.toUpperCase(),
	to_input: s => s.toLowerCase(),
})
assert.equal(number_field.align, 'right')
assert.equal(number_field.label, 'Amount')
assert.equal(number_field.to_input(125), '1.25')
assert.notEqual(number_field.validator, other_field.validator)
assert.equal(ui.field_types.number.validator, undefined)
upper_field.validator.validate('abc')
assert.equal(upper_field.validator.value, 'ABC')
assert.equal(upper_field.validator.parse('abc'), 'ABC')

function input(value, field = number_field) {
	return ui.input('amount', value, null, null, null, field)
}
function edit(text) {
	ctx.next_pass()
	ctx.input_text_changed.call({
		_ui_id: 'amount', value: text,
		selectionStart: text.length, selectionEnd: text.length,
		selectionDirection: 'forward',
	})
}

function edit_input(id, text) {
	ctx.next_pass()
	ctx.input_text_changed.call({
		_ui_id: id, value: text,
		selectionStart: text.length, selectionEnd: text.length,
		selectionDirection: 'forward',
	})
}

assert.equal(input(125), 125)
assert.equal(ui.record.text, '1.25')
assert.equal(ui.state_of('amount').field, number_field)
assert.equal(ui.state_of('amount.text'), undefined)
ui.focus('amount')
assert(ui.focused('amount'))

edit('01.250')
assert.equal(ui.input_value('amount'), 125)
assert.equal(ui.value('amount'), 125)
assert.equal(input(900), 125)
assert.equal(ui.record.text, '01.250')
assert.equal(ui.input_value('amount'), 125)
assert.deepEqual(Array.from(ui.text_selection('amount', true)), [-1, 0])
ctx.next_pass()
assert.equal(ui.input_value('amount'), undefined)
assert.equal(input(125), 125)
assert.equal(ui.record.text, '01.250')
ctx.next_pass()
assert.equal(input(300), 300)
assert.equal(ui.record.text, '3')

edit('unfinished')
assert.equal(ui.value('amount'), 'unfinished')
assert.equal(number_field.validator.parse_failed, true)
assert.equal(input(300), 'unfinished')
assert.equal(ui.record.text, 'unfinished')
assert(number_field.validator.failed)
assert(number_field.validator.results.some(r => r.failed && r.error))
other_field.validator.validate(42)
assert(number_field.validator.failed)

edit('7.00')
assert.equal(ui.value('amount'), 700)
assert.equal(number_field.validator.parse_failed, false)
assert(number_field.validator.failed)
assert.equal(input(300), 700)
assert.equal(ui.record.text, '7.00')
edit('')
assert.equal(ui.input_value('amount'), null)
assert.equal(input(700), null)
assert.equal(ui.record.text, '')
assert.equal(number_field.validator.failed, false)

ctx.next_pass()
assert.equal(input(999), 999)
assert.equal(ui.record.text, '9.99')
assert(number_field.validator.failed)
ctx.next_pass()
ui.process_shared_screen_input(null, {
	event: 'input', input: 'amount', value: '02.50', anchor: 5, caret: 5, n: 1,
})
assert.equal(ui.input_value('amount'), 250)
assert.equal(input(999), 250)
assert.equal(ui.record.text, '02.50')

ctx.next_pass()
const email_field = ui.create_field({type: 'email'})
const email_field2 = ui.create_field({type: 'email'})
email_field.validator.validate('invalid')
email_field2.validator.validate('a@b')
assert(email_field.validator.failed)
assert.equal(email_field2.validator.failed, false)
const results = email_field.validator.results
const result = results[0]
email_field.validator.validate('a@b')
assert.equal(email_field.validator.results, results)
assert.equal(email_field.validator.results[0], result)
assert.equal(email_field.validator.failed, false)
assert.equal(ui.field_types.email.validator_email.name, undefined)

other_field.validator.validate(null)
assert(other_field.validator.failed)
other_field.required = false
assert(other_field.validator.prop_changed('required'))
other_field.validator.validate(null)
assert.equal(other_field.validator.failed, false)

const password_field = ui.create_field({type: 'password', readonly: true})
ui.input('password', 'secret', null, null, null, password_field)
assert.equal(ui.record.input_type, 'password')
assert(ui.record.flags & vm.runInContext('TEXT_READONLY', ctx))
assert(ui.record.flags & vm.runInContext('TEXT_EDITABLE', ctx))

ui.input('upper', 'ONE', null, null, null, upper_field)
assert.equal(ui.record.text, 'one')
edit_input('upper', 'two')
assert.equal(ui.input_value('upper'), 'TWO')
assert.equal(ui.input('upper', 'ONE', null, null, null, upper_field), 'TWO')
assert.equal(ui.record.text, 'two')

ui.input('plain', 'abc')
const default_field = ui.state_of('plain').field
ctx.next_pass()
ui.input('plain', 'def')
assert.equal(ui.state_of('plain').field, default_field)
ui.input('plain2', 'ghi')
assert.notEqual(ui.state_of('plain2').field.validator, default_field.validator)
ui.text('', 'display')
assert.equal(ui.record.flags & vm.runInContext('TEXT_EDITABLE', ctx), 0)

console.log('ui_input: all tests passed')
