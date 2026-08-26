const fs = require('fs')
const vm = require('vm')
const path = require('path')

const WWW = path.join(__dirname, '..', '..', 'www')
const SRC = path.join(WWW, 'ui_code_edit.js')
const GLUE = path.join(WWW, 'glue.js')

const FONT_SIZE = 12
const CHAR_W = 8
const LINE_H = Math.round(FONT_SIZE * 1.5)

let glue_src = fs.readFileSync(GLUE, 'utf8')

function glue_fn(name) {
	let re = new RegExp('^function ' + name + '\\(', 'm')
	let m = re.exec(glue_src)
	if (!m) throw new Error('not found in glue.js: ' + name)
	let depth = 0
	for (let k = glue_src.indexOf('{', m.index); k < glue_src.length; k++) {
		let c = glue_src[k]
		if (c == '{') depth++
		else if (c == '}' && !--depth)
			return glue_src.slice(m.index, k+1)
	}
	throw new Error('unbalanced braces in glue.js: ' + name)
}

let cmps_src = glue_src.slice(
	glue_src.indexOf('let cmps = {}'),
	glue_src.indexOf('function binsearch'))

let glue = cmps_src +
	['insert', 'remove', 'insert_n', 'binsearch'].map(glue_fn).join('\n')

let Lezer = {
	parsers: {html: {parse: () => ({})}},
	TreeFragment: {addTree: () => [], applyChanges: f => f},
	classHighlighter: {},
	highlightTree: () => {},
}

let key_events = []
let clipboard_text = ''
let drag_state = null
let keys = {}
let captured = null
let states = new Map()

function state(id, k) {
	let s = states.get(id)
	if (!s) {
		s = Object.create(null)
		states.set(id, s)
	}
	return k ? s[k] : s
}

let ui = {
	cx: {font: '', save(){}, restore(){}, fillRect(){}, fillText(){},
		clearRect(){}, beginPath(){}, rect(){}, clip(){}},
	caret_w: 2,
	fg_style(){}, bg_style(){},
	widget(){}, cmd(){}, keepalive(){}, on_free(){}, focus(){},
	capture_keydown(){}, capture_keyup(){}, capture_tab(){},
	scroll_to_view(){}, measure(){},
	v(){}, end_v(){}, h(){}, end_h(){}, stack(){}, end_stack(){},
	scrollbox(){}, end_scrollbox(){}, bb(){}, tabs(){},
	code_edit_sidebar(){},
	code_edit_text(...a) { captured = a },
	frame(draw_fn, frame_fn) { frame_fn(null, 0, 0, 0, 400, 400, 0, 0, 400, 400) },
	get_font_size: () => FONT_SIZE,
	measure_text: () => ({width: CHAR_W, fontBoundingBoxDescent: 2}),
	get_theme: () => ({fg: [{}]}),
	fg_color: () => '#000',
	bg_color: () => '#000',
	sp025: () => 1, sp05: () => 2, sp1: () => 4,
	em: n => Math.round((n ?? 1) * FONT_SIZE),
	focused: () => true,
	state,
	drag: () => [drag_state, 0, 0, state('drag')],
	key: k => !!keys[k],
	mx: 0, my: 0,
	get key_events() { return key_events },
	get clipboard_text() { return clipboard_text },
}

let copies = []

let ctx = {
	console, Math, Object, Array, String, JSON,
	min: Math.min, max: Math.max, round: Math.round,
	ceil: Math.ceil, floor: Math.floor,
	clamp: (x, a, b) => Math.min(Math.max(x, a), b),
	assert: (v, ...m) => { if (!v) throw new Error('assert: ' + m.join('')); return v },
	assign: Object.assign,
	isarray: Array.isArray,
	noop: () => {},
	pr: (...a) => console.log(...a),
	empty_array: [],
	navigator: {clipboard: {writeText: s => copies.push(s)}},
	ui, Lezer,
}
ctx.window = ctx
vm.createContext(ctx)
vm.runInContext(glue, ctx, {filename: 'glue-subset.js'})
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, {filename: SRC})

let ed

function open_text(s) {
	states = new Map()
	key_events = []
	keys = {}
	drag_state = null
	ui.mx = 0
	ui.my = 0
	ui.code_edit('ed', {code: s, lang: 'html'}, 100, 100)
	ed = states.get('ed').view
	state('ed.text_contentbox').x = 0
	state('ed.text_contentbox').y = 0
}

function press(full_key, key, key_char, ctrl, alt, shift) {
	key_events = [['down', full_key, key, key_char, !!ctrl, !!alt, !!shift]]
	ed.render(100, 100)
	key_events = []
}

function click_at(line, col, state_name) {
	ui.mx = col * CHAR_W
	ui.my = line * LINE_H + 1
	drag_state = state_name
	ed.render(100, 100)
	drag_state = null
}

function dump() {
	captured = null
	ed.render(100, 100)
	return {lines: captured[12].slice(), cursor: captured[16]}
}

function cursor() { return dump().cursor }
function lines() { return dump().lines }

// -> line, char | line, col if block
function caret() {
	let c = cursor()
	return c.block ? [c.line, c.col] : [c.line, c.char]
}

// -> line1, x1, line2, x2 in the cursor's own units
function selection() {
	let c = cursor()
	return c.block
		? [c.line, c.col, c.sel_line, c.sel_col]
		: [c.line, c.char, c.sel_line, c.sel_char]
}

function make_block(line1, col1, line2, col2) {
	keys.ctrl = true
	click_at(line1, col1, 'drag')
	click_at(line2, col2, 'dragging')
	keys = {}
}

function copy_selection() {
	copies = []
	press('ctrl c', 'c', null, true)
	return copies[0]
}

let failed = 0
let passed = 0

function eq(got, want, what) {
	let g = JSON.stringify(got)
	let w = JSON.stringify(want)
	if (g === w) {
		passed++
	} else {
		failed++
		console.log(`FAIL ${what}\n  got  ${g}\n  want ${w}`)
	}
}

// navigation ----------------------------------------------------------------

open_text('hello\nhi\nlong\n')
for (let i = 0; i < 5; i++) press('arrowright', 'arrowright')
eq(caret(), [0, 5], 'right x5 reaches EOL')
press('arrowright', 'arrowright')
eq(caret(), [1, 0], 'right at EOL wraps to the next line')
press('arrowleft', 'arrowleft')
eq(caret(), [0, 5], 'left at BOL wraps back')

open_text('hello\nhi\nlong\n')
for (let i = 0; i < 5; i++) press('arrowright', 'arrowright')
press('arrowdown', 'arrowdown')
eq(caret(), [1, 2], 'down onto a short line clamps to EOL')
press('arrowdown', 'arrowdown')
eq(caret(), [2, 4], 'want_col restores the column further down')
eq(cursor().want_col, 5, 'want_col survives both moves')

open_text('hello world\n')
press('arrowright', 'arrowright', null, true)
eq(caret(), [0, 6], 'ctrl+right jumps a word')
press('arrowleft', 'arrowleft', null, true)
eq(caret(), [0, 0], 'ctrl+left jumps back')

open_text('ab\ncd\n')
press('arrowright', 'arrowright', null, false, false, true)
eq(selection(), [0, 1, 0, 0], 'shift+right selects')
press('escape', 'escape')
eq(selection(), [0, 1, 0, 1], 'escape collapses the selection')

// typing, enter, backspace, delete -------------------------------------------

open_text('ab\ncd\n')
press('x', 'x', 'x')
eq([lines(), caret()], [['xab', 'cd', ''], [0, 1]], 'typing inserts at the caret')
press('ctrl z', 'z', null, true)
eq([lines(), caret()], [['ab', 'cd', ''], [0, 0]], 'undo removes it')
press('ctrl y', 'y', null, true)
eq([lines(), caret()], [['xab', 'cd', ''], [0, 1]], 'redo puts it back')

open_text('abcd\n')
press('arrowright', 'arrowright')
press('arrowright', 'arrowright')
press('enter', 'enter')
eq([lines(), caret()], [['ab', 'cd', ''], [1, 0]], 'enter splits the line')

open_text('abcd\n')
press('arrowright', 'arrowright')
press('backspace', 'backspace')
eq([lines(), caret()], [['bcd', ''], [0, 0]], 'backspace removes the char left')
press('delete', 'delete')
eq([lines(), caret()], [['cd', ''], [0, 0]], 'delete removes the char right')

open_text('ab\ncd\n')
press('arrowdown', 'arrowdown')
press('backspace', 'backspace')
eq([lines(), caret()], [['abcd', ''], [0, 2]], 'backspace at BOL joins lines')
press('ctrl z', 'z', null, true)
eq([lines(), caret()], [['ab', 'cd', ''], [1, 0]], 'undo unjoins')

open_text('ab\ncd\n')
for (let i = 0; i < 2; i++) press('arrowright', 'arrowright')
press('delete', 'delete')
eq([lines(), caret()], [['abcd', ''], [0, 2]], 'delete at EOL joins lines')

// selection editing ----------------------------------------------------------

open_text('abcdef\n')
for (let i = 0; i < 3; i++)
	press('arrowright', 'arrowright', null, false, false, true)
eq(copy_selection(), 'abc', 'copy takes the selected run')
press('x', 'x', 'x')
eq([lines(), caret()], [['xdef', ''], [0, 1]], 'typing replaces the selection')

open_text('abcdef\n')
for (let i = 0; i < 3; i++)
	press('arrowright', 'arrowright', null, false, false, true)
press('ctrl x', 'x', null, true)
eq([lines(), copies[0]], [['def', ''], 'abc'], 'cut removes and copies')

open_text('ab\ncd\nef\n')
for (let i = 0; i < 2; i++)
	press('arrowdown', 'arrowdown', null, false, false, true)
press('backspace', 'backspace')
eq(lines(), ['ef', ''], 'backspace removes a multi-line selection')

// indent and outdent ---------------------------------------------------------

open_text('ab\ncd\n')
press('arrowdown', 'arrowdown', null, false, false, true)
press('tab', 'tab')
eq(lines(), ['\tab', '\tcd', ''], 'tab indents every selected line')
eq(selection(), [1, 1, 0, 1], 'indent shifts both ends of the selection')
press('shift tab', 'tab', null, false, false, true)
eq(lines(), ['ab', 'cd', ''], 'shift+tab outdents them again')
eq(selection(), [1, 0, 0, 0], 'outdent shifts both ends back')

open_text('ab\n\tcd\n')
press('arrowdown', 'arrowdown', null, false, false, true)
press('shift tab', 'tab', null, false, false, true)
eq(lines(), ['ab', 'cd', ''], 'shift+tab skips lines with no leading tab')

// block mode: creation and clearing -------------------------------------------

open_text('aaaa\nbbbb\ncccc\n')
make_block(0, 1, 2, 3)
eq(cursor().block, true, 'ctrl+drag makes a block')
eq(selection(), [2, 3, 0, 1], 'the block spans the dragged lines and columns')
press('escape', 'escape')
eq(cursor().block, false, 'escape leaves block mode')
eq(caret(), [2, 3], 'the block caret becomes a char position')

open_text('aaaa\nbbbb\n')
make_block(0, 1, 1, 3)
click_at(1, 2, 'drag')
eq(cursor().block, false, 'a plain click leaves block mode')

open_text('l0\nl1\nl2\n')
press('arrowdown', 'arrowdown', null, true, false, true)
eq([cursor().block, selection()], [true, [1, 0, 0, 0]],
	'ctrl+shift+down makes a block and extends it')
press('arrowdown', 'arrowdown', null, true, false, true)
eq(selection(), [2, 0, 0, 0], 'again extends it further')

// block navigation ------------------------------------------------------------

open_text('aaaa\nbbbb\n')
make_block(0, 1, 1, 1)
press('arrowright', 'arrowright', null, false, false, true)
eq(selection(), [1, 2, 0, 1], 'shift+right moves the caret column only')
press('arrowleft', 'arrowleft', null, false, false, true)
eq(selection(), [1, 1, 0, 1], 'shift+left moves it back')
press('arrowright', 'arrowright')
eq([cursor().block, selection()], [false, [1, 2, 1, 2]],
	'an unshifted arrow leaves block mode')

open_text('\t\tab\n\tcd\n')
make_block(0, 0, 1, 0)
press('arrowright', 'arrowright', null, false, false, true)
eq(caret()[1], 3, 'right stops at the first tab stop valid on both lines')
press('arrowright', 'arrowright', null, false, false, true)
eq(caret()[1], 6, 'right skips the column inside the deeper tab')
press('arrowleft', 'arrowleft', null, false, false, true)
eq(caret()[1], 3, 'left comes back to the same stop')

open_text('aaaa\nbbbb\ncccc\n')
make_block(0, 1, 1, 1)
press('arrowdown', 'arrowdown')
eq(selection(), [2, 1, 2, 1], 'down collapses the block to one line and moves')
press('arrowdown', 'arrowdown', null, true, false, true)
eq(selection(), [3, 1, 2, 1], 'ctrl+shift+down makes a block again and grows it')

// block editing ---------------------------------------------------------------

open_text('aaaa\nbbbb\ncccc\n')
make_block(0, 2, 2, 2)
press('x', 'x', 'x')
eq(lines(), ['aaxaa', 'bbxbb', 'ccxcc', ''], 'typing inserts on every line')
eq(selection(), [2, 3, 0, 3], 'and the block advances one column')
press('ctrl z', 'z', null, true)
eq(lines(), ['aaaa', 'bbbb', 'cccc', ''], 'undo removes all of them')

open_text('aaaa\nbb\ncccc\n')
make_block(0, 3, 2, 3)
press('x', 'x', 'x')
eq(lines(), ['aaaxa', 'bb x', 'cccxc', ''],
	'typing pads a line that ends before the column')

open_text('aaaa\nbbbb\n')
make_block(0, 1, 1, 3)
press('backspace', 'backspace')
eq([lines(), selection()], [['aa', 'bb', ''], [1, 1, 0, 1]],
	'backspace removes the block and collapses it')

open_text('aaaa\nbbbb\n')
make_block(0, 2, 1, 2)
press('backspace', 'backspace')
eq([lines(), caret()], [['aaa', 'bbb', ''], [1, 1]],
	'backspace on a zero-width block eats one column on every line')

open_text('aaaa\nbbbb\n')
make_block(0, 2, 1, 2)
press('delete', 'delete')
eq([lines(), caret()], [['aaa', 'bbb', ''], [1, 2]],
	'delete on a zero-width block eats the column to the right')

open_text('aaaa\nbbbb\n')
make_block(0, 2, 1, 2)
press('enter', 'enter')
eq(lines(), ['aaaa', 'bbbb', ''], 'enter does nothing in a block')

open_text('\taa\n\tbb\n')
make_block(0, 3, 1, 3)
press('shift tab', 'tab', null, false, false, true)
eq(lines(), ['aa', 'bb', ''], 'shift+tab outdents a block whose lines all indent')

open_text('\taa\nbb\n')
make_block(0, 3, 1, 3)
press('shift tab', 'tab', null, false, false, true)
eq(lines(), ['\taa', 'bb', ''],
	'shift+tab refuses when some line has no leading tab')

// block clipboard -------------------------------------------------------------

open_text('aaaa\nbbbb\ncccc\n')
make_block(0, 1, 2, 3)
eq(copy_selection(), 'aa\nbb\ncc', 'copy takes the rectangle')

open_text('aaaa\nbb\ncccc\n')
make_block(0, 1, 2, 3)
eq(copy_selection(), 'aa\nb \ncc', 'copy pads a line that ends inside it')

open_text('aaaa\nbbbb\ncccc\n')
make_block(0, 0, 2, 2)
clipboard_text = copy_selection()
make_block(0, 3, 2, 3)
press('paste', 'paste')
eq(lines(), ['aaaaaa', 'bbbbbb', 'cccccc', ''],
	'a block paste into a block of the same height')

open_text('aaaa\nbbbb\ncccc\n')
make_block(0, 0, 2, 2)
clipboard_text = copy_selection()
make_block(0, 3, 1, 3)
press('paste', 'paste')
eq(lines(), ['aaaa', 'bbbb', 'cccc', ''],
	'a block paste refuses when the heights differ')

open_text('aaaa\nbbbb\n')
make_block(0, 1, 1, 1)
clipboard_text = 'zz'
press('paste', 'paste')
eq(lines(), ['aaaa', 'bbbb', ''],
	'a block paste refuses text this editor did not copy')

// ---------------------------------------------------------------------------

console.log(`${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
