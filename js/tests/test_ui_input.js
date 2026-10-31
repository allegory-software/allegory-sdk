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
let is_building = false // whether a widget is being built
let render_state_map = null
let tab_into_id = null
let applied_edit_n = 0
let a = []
let n = 0
const BOX_ARGS = 0
const id_i = [] // command opcode -> id slot
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
function build(fn) {
	is_building = true
	let value = fn()
	is_building = false
	return value
}
`, ctx)
Object.assign(ctx.ui, {
	focusable() {}, stack() {}, end_stack() {}, bb() {}, p() {}, color() {},
	sp: () => 1,
	em_input: () => 100,
})
load_section('let state_map =', 'ui.set_state_of =')
load_section('ui.input_value = function(', '//// TEXT BOX')
load_section('ui.focused_id = null', 'ui.focusing =')
load_section('const STATE_HOVER', 'function parse_state_name')
load_section('const ALIGN_STRETCH', 'function parse_valign')
load_section('let next_min_w, next_min_h', 'function reset_spacings')
load_section('let text_flags = 0', 'function text_flags_check')
load_section('const TEXT_ASC', 'ui.heading =')
load_section('ui.select_text =', 'function remember_select_all')
load_section('function read_input_sel', 'function input_selection_changed')
load_section('ui.process_shared_screen_input =', '// a remote input is wired')
load_section('ui.input = function', '//// NUM_SLIDER')

const ui = ctx.ui
const number_field = ui.create_field({
	type: 'number', name: 'amount', scale: 100, decimals: 2,
	min: 0, max: 500,
})
const other_field = ui.create_field({type: 'number', not_null: true})
const upper_field = ui.create_field({
	validator_upper: {
		parse: (field, value) => value.toUpperCase(),
		validate: () => true,
		error: () => '',
		rule: () => '',
	},
	to_input: s => s.toLowerCase(),
})
assert.equal(number_field.align, 'right')
assert.equal(number_field.label, 'Amount')
assert.equal(number_field.to_input(125), '1.25')
assert.notEqual(number_field.validator, other_field.validator)
assert.equal(ui.field_types.number.validator, undefined)
const upper_out = upper_field.validator.create_output()
upper_field.validator.validate('abc', upper_out)
assert.equal(upper_out.value, 'ABC')
assert.equal(upper_field.validator.parse('abc'), 'ABC')

function input(value, field = number_field) {
	return ctx.build(() => ui.input('amount', value, field))
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
assert.equal(ui.interaction_value('amount'), 125)
assert.equal(ui.value('amount'), 125)
assert.equal(input(900), 125)
assert.equal(ui.record.text, '01.250')
assert.equal(ui.interaction_value('amount'), 125)
assert.deepEqual(Array.from(ctx.build(
	() => ui.text_selection('amount', true))), [-1, 0])
ctx.next_pass()
assert.equal(ui.interaction_value('amount'), undefined)
assert.equal(input(125), 125)
assert.equal(ui.record.text, '01.250')
ctx.next_pass()
assert.equal(input(300), 300)
assert.equal(ui.record.text, '3.00')

const amount_validation = () => ui.state_of('amount').validation
edit('unfinished')
assert.equal(ui.interaction_value('amount'), 'unfinished')
assert.equal(ui.value('amount'), undefined)
assert.equal(input(300), undefined)
assert.equal(ui.record.text, 'unfinished')
assert.equal(amount_validation().parse_failed, true)
assert(amount_validation().failed)
assert(amount_validation().results.some(r => r.failed && r.error))
other_field.validator.validate(42, other_field.validator.create_output())
assert(amount_validation().failed)
ctx.next_pass()
assert.equal(input(undefined), undefined)
assert.equal(ui.record.text, 'unfinished')

edit('7.00')
assert.equal(ui.interaction_value('amount'), 700)
assert.equal(ui.value('amount'), undefined)
assert.equal(input(300), undefined)
assert.equal(ui.record.text, '7.00')
assert.equal(amount_validation().parse_failed, false)
assert(amount_validation().failed)
ctx.next_pass()
assert.equal(input(undefined), undefined)
assert.equal(ui.record.text, '7.00')
edit('')
assert.equal(ui.interaction_value('amount'), null)
assert.equal(input(700), null)
assert.equal(ui.record.text, '')
assert.equal(amount_validation().failed, false)

ctx.next_pass()
assert.equal(input(999), undefined)
assert.equal(ui.record.text, '9.99')
assert(amount_validation().failed)
ctx.next_pass()
ui.process_shared_screen_input(null, {
	event: 'input', input: 'amount', value: '02.50', anchor: 5, caret: 5, n: 1,
})
assert.equal(ui.interaction_value('amount'), 250)
assert.equal(input(999), 250)
assert.equal(ui.record.text, '02.50')

ctx.next_pass()
const email_field = ui.create_field({type: 'email'})
const email_field2 = ui.create_field({type: 'email'})
const email_out = email_field.validator.create_output()
const email_out2 = email_field2.validator.create_output()
email_field.validator.validate('invalid', email_out)
email_field2.validator.validate('a@b', email_out2)
assert(email_out.failed)
assert.equal(email_out2.failed, false)
const results = email_out.results
const result = results[0]
email_field.validator.validate('a@b', email_out)
assert.equal(email_out.results, results)
assert.equal(email_out.results[0], result)
assert.equal(email_out.failed, false)
assert.equal(ui.field_types.email.validator_email.name, undefined)

const other_out = other_field.validator.create_output()
other_field.validator.validate(null, other_out)
assert(other_out.failed)
const nullable_field = ui.create_field({type: 'number'})
const nullable_out = nullable_field.validator.create_output()
nullable_field.validator.validate(null, nullable_out)
assert.equal(nullable_out.failed, false)

const password_field = ui.create_field({type: 'password', readonly: true})
ctx.build(() => ui.input('password', 'secret', password_field))
assert.equal(ui.record.input_type, 'password')
assert(ui.record.flags & vm.runInContext('TEXT_READONLY', ctx))
assert(ui.record.flags & vm.runInContext('TEXT_EDITABLE', ctx))

ctx.build(() => ui.input('upper', 'ONE', upper_field))
assert.equal(ui.record.text, 'one')
edit_input('upper', 'two')
assert.equal(ui.interaction_value('upper'), 'TWO')
assert.equal(ctx.build(() => ui.input('upper', 'ONE', upper_field)), 'TWO')
assert.equal(ui.record.text, 'two')

ctx.build(() => ui.input('plain', 'abc'))
const default_field = ui.state_of('plain').field
ctx.next_pass()
ctx.build(() => ui.input('plain', 'def'))
assert.equal(ui.state_of('plain').field, default_field)
ctx.build(() => ui.input('plain2', 'ghi'))
assert.notEqual(ui.state_of('plain2').field.validator, default_field.validator)
ctx.build(() => ui.text('', 'display'))
assert.equal(ui.record.flags & vm.runInContext('TEXT_EDITABLE', ctx), 0)

console.log('ui_input: all tests passed')
