/*

	Canvas IMGUI code editor widget.
	Written by Cosmin Apreutesei. Public Domain.

	* TODO: draw inline tabs, space indent, trailing whitespace
	* TODO: search, replace

DESIGN TRADEOFFS

	- monospace fonts, no ligatures, no combining marks.
		=> codepoint == grapheme
		=> constant grapheme width
	- tabs are used only for indentation and are not valid inside the line.
		=> it's the only way to have user-defined tab-width that makes sense.
		=> tabs are not aligned to tabstops.
		=> inner tabs (those after the first non-space char) take 1 space.
		=> when typing or pasting, inner tabs are converted to 1 space.
	- no mixed line terminators in the same file.
		=> line terminator is detected and text is normalized to that or '\n'.
	- no line folding.

IMPL. TERMINOLOGY

	line      line number counting from 0.
	char      char (so codepoint) index in line.
	col       column (so visible char) index in line.
	pos       char (so codepoint) index in whole text.

IMPL. NOTES

- tab-based indent requires char <-> col conversion on rendering, hit-testing
  and vertical navigation.
- cursor.char can go at line_s.length so 1 char beyond the last char in line.
- selected text is between cursor{.line|.char} and cursor{.sel_line|.sel_char-1}
  (note the -1) or viceversa, the caret being at cursor{.line|.char} always.
- vline2 is the last visible line. sline2 is the last selected line.

*/

(function () {
"use strict"
const G = window

const {
	cx,
	caret_w = 2,
} = ui

//           theme    name        state       h     s     L    a
// ---------------------------------------------------------------------------
ui.fg_style('light', 'keyword'  , 'normal', 240, 1.00, 0.35)
ui.fg_style('light', 'string'   , 'normal',   5, 0.85, 0.40)
ui.fg_style('light', 'number'   , 'normal',   5, 0.80, 0.45)
ui.fg_style('light', 'symbol'   , 'normal', 240, 1.00, 0.20)
ui.fg_style('light', 'comment'  , 'normal', 100, 0.00, 0.45)
ui.fg_style('light', 'error'    , 'normal',   0, 0.85, 0.45)

ui.fg_style('dark' , 'keyword'  , 'normal',  60, 0.95, 0.60)
ui.fg_style('dark' , 'string'   , 'normal',   5, 0.95, 0.60)
ui.fg_style('dark' , 'number'   , 'normal',   5, 0.95, 0.70)
ui.fg_style('dark' , 'symbol'   , 'normal',   0, 1.00, 1.00)
ui.fg_style('dark' , 'comment'  , 'normal', 140, 0.85, 0.30)
ui.fg_style('dark' , 'error'    , 'normal',   0, 0.85, 0.65)

ui.bg_style('light', 'find', 'normal' ,   0, 0.00, 0.93)
ui.bg_style('light', 'find', 'focused', 209, 0.55, 0.92)

ui.bg_style('dark' , 'find', 'normal' , 208, 0.08, 0.16)
ui.bg_style('dark' , 'find', 'focused', 211, 0.50, 0.17)

ui.capture_keydown('ctrl f'  ) // browser: find -> editor: find
ui.capture_keyup  ('ctrl f'  ) // browser: find -> editor: find
ui.capture_keydown('ctrl h'  ) // browser: history -> editor: replace
ui.capture_keyup  ('ctrl h'  ) // browser: history -> editor: replace
ui.capture_keydown('ctrl s'  ) // browser: save as html -> editor: save
ui.capture_keydown('f3'      ) // browser: find next -> editor: find next
ui.capture_keydown('shift f3') // browser: find prev -> editor: find prev

let token_colors = {
	'tok-keyword':     'keyword',
	'tok-atom':        'keyword',
	'tok-bool':        'keyword',
	'tok-typeName':    'keyword',
	'tok-className':   'keyword',
	'tok-meta':        'keyword',
	'tok-string':      'string',
	'tok-string2':     'string',
	'tok-url':         'string',
	'tok-number':      'number',
	'tok-operator':    'symbol',
	'tok-punctuation': 'symbol',
	'tok-comment':     'comment',
}

function first_content_char(s) {
	for (let i = 0, n = s.length; i < n; i++) {
		let c = s.charCodeAt(i)
		if (c != 9 && c != 32)
			return i
	}
	return -1
}

function tab_draw_offset(s, tab_width) {
	let i = 0 // char index (i.e. index in line string s)
	let j = 0 // col index (i.e. visual char index, or column)
	while (1) {
		let c = s.charCodeAt(i++)
		if (c == 9)
			j += tab_width
		else if (c != 32)
			return j
	}
}

function char_to_col(on_i, s, tab_width) {
	let i = 0 // char index
	let j = 0 // col index
	while (i < on_i) {
		let c = s.charCodeAt(i++)
		if (c == 9)
			j += tab_width
		else if (c == 32)
			j++
		else // after indent it's 1:1 (tabs are 1 space)
			return j + (on_i - i) + 1
	}
	return j
}

function col_to_char(on_j, s, tab_width) {
	on_j = max(0, on_j)
	let i = 0 // char index
	let j = 0 // col index
	let n = s.length
	let in_indent = true
	while (i < n) {
		let c = s.charCodeAt(i++)
		if (!(c == 9 || c == 32))
			in_indent = false
		let j0 = j
		j += in_indent && c == 9 ? tab_width : 1
		// i is now at next char, j is now at next col, j0 is at last col.
		if (on_j >= j0 && on_j <= j) // on_j is somewhere between j0 and j
			return i + (on_j - j0 < j - on_j ? -1 : 0)
	}
	return n + (on_j - j) // go beyond text correctly
}

function detect_line_terminator(s) {
	let crlf = 0, cr = 0, lf = 0
	for (let i = 0, n = s.length; i < n; i++) {
		let c = s.charCodeAt(i)
		if (c == 13)
			if (i+1 < n && s.charCodeAt(i+1) == 10)
				{ crlf++; i++ }
			else
				cr++
		else if (c == 10)
			lf++
	}
	if (crlf && !cr && !lf) return '\r\n'
	if (cr && !crlf && !lf) return '\r'
	if (lf && !crlf && !cr) return '\n'
}

function cursor_has_selection(cursor) {
	return cursor.block ? cursor.col != cursor.sel_col : (
		cursor.line != cursor.sel_line ||
		cursor.char != cursor.sel_char
	)
}

ui.widget('code_edit_sidebar', {
	create: ui.cmd,
	draw: function(a, i) {
		let x0          = a[i+0]
		let y0          = a[i+1]
		let w           = a[i+2]
		let vx          = a[i+3]
		let vy          = a[i+4]
		let vw          = a[i+5]
		let vh          = a[i+6]
		let vline1      = a[i+7]
		let vline2      = a[i+8]
		let line_h      = a[i+9]
		let font_size   = a[i+10]
		let font_descent= a[i+11]
		let margin_l    = a[i+12]
		let bookmarks   = a[i+13]

		cx.save()

		cx.beginPath()
		cx.rect(vx, vy, vw, vh)
		cx.clip()

		cx.font = font_size+'px mono'
		cx.fontKerning = 'none'
		cx.textAlign = 'right'
		cx.fillStyle = 'gray'

		let x = x0 + margin_l + w
		for (let line = vline1; line <= vline2; line++)
			cx.fillText(
				line+1, x,
				y0 + (line + 1) * line_h - font_descent - 1)

		cx.font = font_size+'px tabler'
		cx.textAlign = 'center'
		cx.fillStyle = ui.fg_color('marker')

		let bx = x0 + margin_l / 2
		for (let line of bookmarks)
			if (line >= vline1 && line <= vline2)
				cx.fillText('\uea3a', bx,
					y0 + (line + 1) * line_h - font_descent - 1)

		cx.restore()
	},
})

ui.widget('code_edit_text', {
	create: ui.cmd,
	draw: function(a, i) {
		let x0          = a[i+0]
		let y0          = a[i+1]
		let vx          = a[i+2]
		let vy          = a[i+3]
		let vw          = a[i+4]
		let vh          = a[i+5]
		let line_h      = a[i+6]
		let font_size   = a[i+7]
		let font_descent= a[i+8]
		let char_w      = a[i+9]
		let vline1      = a[i+10]
		let vline2      = a[i+11]
		let vlines      = a[i+12]
		let tab_width   = a[i+13]
		let vcolors     = a[i+14]
		let hit_line    = a[i+15]
		let cursor      = a[i+16]
		let focused     = a[i+17]
		let vfinds      = a[i+18]
		let find_landed = a[i+19]

		cx.save()

		cx.font = font_size+'px mono'
		cx.fontKerning = 'none'

		// reset viewport to alpha 0 so we can blend text with highlighting rectangles.
		cx.clearRect(vx, vy, vw, vh)

		// draw the text.
		cx.textAlign = 'left'
		cx.fillStyle = ui.fg_color('text')
		for (let line = vline1; line <= vline2; line++) {
			let s = vlines[line - vline1]
			// using tab_width-1 because tabs take one char with fillText().
			let indent_w = tab_draw_offset(s, tab_width-1) * char_w
			cx.fillText(s,
				x0 + indent_w,
				y0 + (line + 1) * line_h - font_descent - 1)
		}

		// this blending mode will draw only where alpha != 0, i.e. over the text.
		cx.globalCompositeOperation = 'source-atop'

		// draw highlighting rectangles.
		let fg_colors = ui.get_theme().fg[0] // get all fg colors once
		let text_color = fg_colors.text
		for (let line = vline1; line <= vline2; line++) {
			let s = vlines[line - vline1]
			let c = vcolors[line - vline1]
			for (let i = 0, n = c.length; i < n; i += 3) {
				let ci    = c[i+0]
				let cw    = c[i+1]
				let color = c[i+2]
				let x = round(x0 + ci * char_w)
				let y = y0 + line * line_h
				let w = round(cw * char_w)
				let h = line_h
				let color_hsl = (fg_colors[color] ?? text_color)[0]
				cx.fillStyle = color_hsl
				cx.fillRect(x, y, w, h)
			}
		}

		// this blending mode will draw only where alpha == 0,
		// i.e. around what's been drawn before i.e. drawing "behind".
		cx.globalCompositeOperation = 'destination-over'

		// draw caret.
		if (focused) {
			cx.fillStyle = ui.fg_color('text')
			if (cursor.block) {
				let bline1 = max(min(cursor.line, cursor.sel_line), vline1)
				let bline2 = min(max(cursor.line, cursor.sel_line), vline2)
				for (let line = bline1; line <= bline2; line++)
					cx.fillRect(
						round(x0 + cursor.col * char_w),
						y0 + line * line_h,
						caret_w, line_h)
			} else if (vlines[cursor.line - vline1] != null) {
				let line_s = vlines[cursor.line - vline1]
				let col = char_to_col(cursor.char, line_s, tab_width)
				cx.fillRect(
					round(x0 + col * char_w),
					y0 + cursor.line * line_h,
					caret_w, line_h)
			}
		}

		// draw multi-line selection.
		let tail_width = round(font_size * .25)
		let sline1 = min(cursor.sel_line, cursor.line)
		let sline2 = max(cursor.sel_line, cursor.line)
		let sel_color = ui.bg_color('item', focused
			? 'focused item-focused item-selected'
			: 'item-focused item-selected')
		if (cursor.block && cursor.col != cursor.sel_col
			&& sline2 >= vline1 && sline1 <= vline2
		) {
			cx.fillStyle = sel_color
			let bcol1 = min(cursor.col, cursor.sel_col)
			let bcol2 = max(cursor.col, cursor.sel_col)
			for (let line = max(sline1, vline1); line <= min(sline2, vline2); line++)
				cx.fillRect(
					round(x0 + bcol1 * char_w),
					y0 + line * line_h,
					round((bcol2 - bcol1) * char_w),
					line_h)
		} else if (!cursor.block && cursor_has_selection(cursor)
				&& sline2 >= vline1 && sline1 <= vline2
		) {
			cx.fillStyle = sel_color
			let vsline1 = clamp(sline1, vline1, vline2)
			let vsline2 = clamp(sline2, vline1, vline2)
			if (sline1 < sline2) { // multi-line
				let schar1 = sline1 == cursor.line ? cursor.char : cursor.sel_char
				let schar2 = sline2 == cursor.line ? cursor.char : cursor.sel_char
				let scol1 = vsline1 == sline1 ? char_to_col(schar1, vlines[sline1 - vline1], tab_width) : null
				let scol2 = vsline2 == sline2 ? char_to_col(schar2, vlines[sline2 - vline1], tab_width) : null
				if (scol1 != null) {
					let line_s = vlines[sline1 - vline1]
					let scol2 = char_to_col(line_s.length, line_s, tab_width)
					cx.fillRect(
						round(x0 + scol1 * char_w),
						y0 + sline1 * line_h,
						round(max((scol2 - scol1) * char_w, tail_width)),
						line_h)
					vsline1++ // vsline1 is sline1 which we just drew.
				}
				if (scol2 != null)
					vsline2-- // vsline2 is sline2 which is partial up to scol2.
				for (let vsline = vsline1; vsline <= vsline2; vsline++) {
					let line_s = vlines[vsline - vline1]
					let scol1 = 0
					let scol2 = char_to_col(line_s.length, line_s, tab_width)
					cx.fillRect(
						round(x0 + scol1 * char_w),
						y0 + vsline * line_h,
						round(max((scol2 - scol1) * char_w, tail_width)),
						line_h)
				}
				if (scol2 != null) {
					let scol1 = 0
					cx.fillRect(
						x0 + scol1,
						y0 + sline2 * line_h,
						round(max((scol2 - scol1) * char_w, tail_width)),
						line_h)
				}
			} else if (vsline1 == sline1) { // single-line
				let line_s = vlines[sline1 - vline1]
				if (line_s != null) { // not outside visible range
					let ccol = char_to_col(cursor.char, line_s, tab_width)
					let scol = char_to_col(cursor.sel_char, line_s, tab_width)
					let col1 = min(ccol, scol)
					let col2 = max(ccol, scol)
					cx.fillRect(
						round(x0 + col1 * char_w),
						y0 + cursor.line * line_h,
						round((col2 - col1) * char_w),
						line_h)
				}
			}
		}

		// draw find matches.
		cx.fillStyle = ui.bg_color('find', focused ? 'focused' : null)
		for (let line = vline1; line <= vline2; line++) {
			let f = vfinds[line - vline1]
			for (let i = 0, n = f.length; i < n; i += 2) {
				cx.fillRect(
					round(x0 + f[i+0] * char_w),
					y0 + line * line_h,
					round(f[i+1] * char_w),
					line_h
				)
			}
		}

		// draw find landing line.
		if (find_landed) {
			cx.fillStyle = ui.bg_color('bg1')
			cx.fillRect(vx, y0 + cursor.line * line_h, vw, line_h)
		}

		// draw background.
		cx.fillStyle = ui.bg_color('bg0')
		cx.fillRect(vx, vy, vw, vh)

		cx.restore()
	}
})

function code_edit_view(id, opt) {

	let e = {}

	// lines and text-derived state.
	let newline // as detected from text or user override
	let tab_width = 3 // user setting
	let lines // [line1, ...]
	let line_offsets = [] // [line2_offset, ...]  <-- it starts with the second line!
	let max_line_col

	// text changes from edits, flushed at the end of the frame.
	let changes = [] // [line1, char1, removed_n1, inserted_n1, ...]

	// parsing/highlighting state.
	let lang = opt.lang ?? 'html'
	let parser = assert(Lezer.parsers[lang], 'invalid language ', lang)
	let syntax_tree // per Lezer parsing
	let line_colors = [] // token colors: [[char, width, color], ...], ...]  1:1 with lines

	// last text this editor put on the clipboard, and whether it was a block.
	let copied_text
	let copied_text_is_block

	// bookmarks state
	let bookmark_lines = [] // [line1,...]

	// UI state, set on each frame.
	let font_size
	let font_descent
	let line_h
	let char_w
	let sidebar_digits_w
	let sidebar_margin_l
	let last_vline1 = -1
	let last_vline2 = -1 // visible line range
	let vlines = [] // visible lines array: [vline1_s, ...]
	let vcolors = [] // token colors: [vline1_colors, ...]
	let vfinds = [] // find matches: [vline1_finds, ...]

	// mouse state
	let hit_line

	// cursor state.
	let cursor

	// find state.
	let find_open
	let find_text = ''
	let last_find_text = ''
	let find_lines = [] // [match1_line, ...]
	let find_chars = [] // [match1_char, ...]
	let find_i // current match, as index into find_lines
	let find_landed
	let find_replace
	let replace_text = ''

	// undo state.
	let undo_stack = []
	let redo_stack = []
	let undo_group
	let undoing

	// pos -> (line, char) ----------------------------------------------------

	// compute line offsets, starting with the 2nd line!
	function compute_line_offsets() {
		line_offsets.length = lines.length-1
		let pos = lines[0].length + newline.length
		for (let i = 1, n = lines.length; i < n; i++) {
			line_offsets[i-1] = pos
			pos += lines[i].length + newline.length
		}
	}

	function text_length() {
		return line_offset(lines.length-1) + lines.at(-1).length
	}

	function line_offset(line) {
		return line ? line_offsets[line-1] : 0
	}

	function find_line(pos) {
		// line_offsets[0] = offset of the 2nd line i.e. the line with index 1.
		// binsearch'ing with '<=' gives us the correct line when pos is at the
		// beginning of the line.
		return binsearch(line_offsets, pos, '<=')
	}

	// char <-> col -----------------------------------------------------------

	function cursor_rect(cursor) {
		return [
			cursor_col(cursor) * char_w,
			cursor.line * line_h,
			caret_w, line_h
		]
	}

	function pos_at(line, char) {
		return line_offset(line) + char
	}

	function cursor_col(cursor) {
		return cursor.block ? cursor.col
			: char_to_col(cursor.char, lines[cursor.line], tab_width)
	}

	function block_col_ok(col, line1, line2) {
		for (let line = line1; line <= line2; line++) {
			let line_s = lines[line]
			let char = col_to_char(col, line_s, tab_width)
			if (char_to_col(char, line_s, tab_width) != col)
				return false
		}
		return true
	}

	// nearest col in the given direction that is a char boundary on every
	// line in the range. past max_line_col every col is a boundary.
	function next_block_col(col, line1, line2, dir) {
		let new_col = col
		while (1) {
			new_col += dir
			if (new_col <= 0 || new_col > max_line_col)
				return max(0, new_col)
			if (block_col_ok(new_col, line1, line2))
				return new_col
		}
	}

	function block_char(line, col) {
		let line_s = lines[line]
		return min(col_to_char(col, line_s, tab_width), line_s.length)
	}

	function set_block_mode(on) {
		if (!cursor.block == !on)
			return
		undo_push_cursor()
		if (on) {
			cursor.col = char_to_col(cursor.char, lines[cursor.line], tab_width)
			cursor.sel_col =
				char_to_col(cursor.sel_char, lines[cursor.sel_line], tab_width)
			cursor.block = true
		} else {
			cursor.block = false
			cursor.char = block_char(cursor.line, cursor.col)
			cursor.sel_char = block_char(cursor.sel_line, cursor.sel_col)
			cursor.want_col = cursor.col
		}
	}

	function copy_selection() {
		copied_text = selected_text(cursor)
		copied_text_is_block = cursor.block
		navigator.clipboard.writeText(copied_text)
	}

	// word jump --------------------------------------------------------------

	function is_word_char(cp) {
		if (cp >= 48 && cp <= 57) return true // 0–9
		if (cp >= 65 && cp <= 90) return true // A–Z
		if (cp >= 97 && cp <= 122) return true // a–z
		return cp == 95 || cp == 36 // '_' or '$'
	}

	function next_token(cursor) {
		let i = cursor.char
		let s = lines[cursor.line]
		let n = s.length
		while (i < n &&  is_word_char(s.charCodeAt(i))) i++ // goto end of current word
		while (i < n && !is_word_char(s.charCodeAt(i))) i++ // skip non-words
		return i
	}

	function prev_token(cursor) {
		let i = cursor.char
		let s = lines[cursor.line]
		while (i && !is_word_char(s.charCodeAt(i-1))) i-- // skip non-words
		while (i &&  is_word_char(s.charCodeAt(i-1))) i-- // goto beginning of current word
		return i
	}

	// bookmarks --------------------------------------------------------------

	function toggle_bookmark(line) {
		if (remove_value(bookmark_lines, line) == -1)
			bookmark_lines.push(line)
	}

	function next_bookmark_line(from_line, dir) {
		let next_line
		let wrap_line
		for (let line of bookmark_lines) {
			if ((line - from_line) * dir > 0
					&& (next_line == null || (line - next_line) * dir < 0))
				next_line = line
			if (wrap_line == null || (line - wrap_line) * dir < 0)
				wrap_line = line
		}
		return next_line ?? wrap_line
	}

	// selection --------------------------------------------------------------

	function block_sel_range(cursor) {
		return [
			min(cursor.line, cursor.sel_line), min(cursor.col, cursor.sel_col),
			max(cursor.line, cursor.sel_line), max(cursor.col, cursor.sel_col)
		]
	}

	function sel_range(cursor) {
		let caret_first = cursor.line != cursor.sel_line
			? cursor.line < cursor.sel_line
			: cursor.char <= cursor.sel_char
		if (caret_first)
			return [cursor.line, cursor.char, cursor.sel_line, cursor.sel_char]
		else
			return [cursor.sel_line, cursor.sel_char, cursor.line, cursor.char]
	}

	function selected_text(cursor) {
		if (cursor.block) {
			let [line1, col1, line2, col2] = block_sel_range(cursor)
			let sel_lines = []
			for (let line = line1; line <= line2; line++) {
				let line_s = lines[line]
				let end_char = block_char(line, col2)
				let end_col = char_to_col(end_char, line_s, tab_width)
				sel_lines.push(line_s.slice(block_char(line, col1), end_char)
					+ ' '.repeat(col2 - max(col1, end_col)))
			}
			return sel_lines.join(newline)
		}
		let [line1, char1, line2, char2] = sel_range(cursor)
		if (line1 == line2) {
			return lines[line1].substring(char1, char2)
		} else {
			let sel_lines = []
			sel_lines.push(lines[line1].substring(char1))
			for (let line = line1 + 1; line < line2; line++)
				sel_lines.push(lines[line])
			sel_lines.push(lines[line2].substring(0, char2))
			return sel_lines.join(newline)
		}
	}

	// find -------------------------------------------------------------------

	function cursor_start() {
		return cursor.block
			? [min(cursor.line, cursor.sel_line), 0]
			: sel_range(cursor)
	}

	// decides which match should be current after the list is rebuilt
	function find_index_at_cursor() {
		if (!find_lines.length)
			return
		let [line1, char1] = cursor_start()
		for (let i = 0, n = find_lines.length; i < n; i++)
			if (find_lines[i] > line1
					|| (find_lines[i] == line1 && find_chars[i] >= char1))
				return i
		return 0
	}

	function find_scan() {
		find_lines.length = 0
		find_chars.length = 0
		if (find_text) {
			let re = new RegExp(escape_regexp(find_text), 'gi')
			for (let line = 0, line_n = lines.length; line < line_n; line++) {
				let line_s = lines[line]
				re.lastIndex = 0
				let m = re.exec(line_s)
				while (m) {
					find_lines.push(line)
					find_chars.push(m.index)
					m = re.exec(line_s)
				}
			}
		}
		find_i = find_index_at_cursor()
		last_vline1 = -1
	}

	function close_find() {
		find_open = false
		last_vline1 = -1
	}

	function select_match(i) {
		find_i = i
		let line = find_lines[i]
		let char = find_chars[i]
		undo_group = 'move'
		set_block_mode(false)
		set_cursor(line, char + find_text.length, null, false, line, char)
		undo_group = null
		find_landed = true
	}

	function goto_match(d) {
		let n = find_lines.length
		if (!n) return
		select_match((find_i + d + n) % n)
	}

	// d > 0 goes to the first match at or after the cursor, or to the one
	// after it when the cursor is already on that match.
	function goto_match_from_cursor(d) {
		let i = find_index_at_cursor()
		if (i == null)
			return
		find_i = i
		let [line1, char1] = cursor_start()
		if (d < 0 || (find_lines[i] == line1 && find_chars[i] == char1))
			goto_match(d)
		else
			select_match(i)
	}

	function replace_at(i) {
		let line = find_lines[i]
		let char = find_chars[i]
		remove_text(line, char, line, char + find_text.length)
		insert_text(line, char, replace_text)
	}

	function replace_match() {
		if (!find_lines.length)
			return
		let [line1, char1, line2, char2] = sel_range(cursor)
		if (!cursor.block
				&& find_lines[find_i] == line1 && line1 == line2
				&& find_chars[find_i] == char1
				&& char1 + find_text.length == char2
		) {
			undo_group = 'replace'
			replace_at(find_i)
			set_cursor(line1, char1 + replace_text.length, false)
			undo_group = null
			update_text_state()
		}
		goto_match_from_cursor(1)
	}

	function replace_all() {
		if (!find_lines.length)
			return
		let line1, char1, line2, char2
		if (cursor_has_selection(cursor)) {
			if (cursor.block) {
				line1 = min(cursor.line, cursor.sel_line)
				line2 = max(cursor.line, cursor.sel_line)
				char1 = 0
				char2 = 1/0
			} else {
				;[line1, char1, line2, char2] = sel_range(cursor)
			}
		}
		undo_group = 'replace'
		set_block_mode(false)
		for (let i = find_lines.length-1; i >= 0; i--) {
			let line = find_lines[i]
			let char = find_chars[i]
			if (line1 != null && (
				line < line1 || line > line2 ||
				(line == line1 && char < char1) ||
				(line == line2 && char + find_text.length > char2)
			))
				continue
			replace_at(i)
		}
		set_cursor(cursor.line, cursor.char, false)
		undo_group = null
		update_text_state()
	}

	// text & lines helpers ---------------------------------------------------

	let newline_re = /(?:\r\n|\r|\n)/g
	function normalize_newlines(s) {
		return s.replace(newline_re, newline)
	}

	function text_lines(s) {
		return s.split(newline)
	}

	function normalize_lines() {
		// remove whitespace at EOL.
		for (let i = 0, n = lines.length; i < n; i++)
			lines[i] = lines[i].trimEnd()
		// remove additional empty lines at EOF.
		while (lines.length > 1 && !lines.at(-1).length && !lines.at(-2).length)
			lines.pop()
		// insert a single empty line at EOF.
		if (lines.at(-1).length)
			lines.push('')
	}

	function insert_lines(line1, n) {
		insert_n(lines      , line1, n)
		insert_n(line_colors, line1, n)
		for (let i = 0; i < n; i++)
			line_colors[line1 + i] = []
		// update bookmarks
		for (let i = 0, bn = bookmark_lines.length; i < bn; i++)
			if (bookmark_lines[i] >= line1)
				bookmark_lines[i] += n
	}

	function remove_lines(line1, n) {
		lines.splice(line1, n)
		line_colors.splice(line1, n)
		// update bookmarks
		let j = 0
		for (let i = 0, bn = bookmark_lines.length; i < bn; i++) {
			let line = bookmark_lines[i]
			if (line < line1)
				bookmark_lines[j++] = line
			else if (line >= line1 + n)
				bookmark_lines[j++] = line - n
		}
		bookmark_lines.length = j
	}

	function reset_editor(s) {
		newline = detect_line_terminator(s) ?? '\n'
		s = normalize_newlines(s)
		lines = text_lines(s)
		// (re)init line_colors arrays.
		line_colors.length = lines.length
		for (let i = 0, n = lines.length; i < n; i++)
			if (line_colors[i] != null)
				line_colors[i].length = 0
			else
				line_colors[i] = []
		bookmark_lines.length = 0
		undo_stack.length = 0
		redo_stack.length = 0
		undo_group = null
		cursor = {line: 0, char: 0, sel_line: 0, sel_char: 0, want_col: 0}
		update_text_state(true)
	}

	// undo-able ops ----------------------------------------------------------

	function undo_push_cursor() {
		if (undo_group == 'ignore')
			return
		assert(undo_group)
		// skip if this group is not empty. only works because this is called
		// on every undo_push() so if the group is not empty, this was called.
 		if (undo_stack.at(-1)?.[0] == undo_group)
			return
		undo_stack.push([undo_group, restore_cursor, assign({}, cursor)])
	}

	function restore_cursor(saved_cursor) {
		undo_push_cursor()
		find_landed = false
		cursor = saved_cursor
		ui.scroll_to_view_rect(id+'.text_scrollbox', ...cursor_rect(cursor))
	}

	function set_cursor(
		line, char, keep_selection, keep_want_col,
		sel_line, sel_char
	) {
		assert(!cursor.block)
		undo_push_cursor()
		find_landed = false
		cursor.line = line
		cursor.char = clamp(char, 0, lines[line].length)
		if (!keep_want_col)
			cursor.want_col = cursor_col(cursor)
		if (sel_line != null) {
			cursor.sel_line = sel_line
			cursor.sel_char = clamp(sel_char, 0, lines[sel_line].length)
		} else if (!keep_selection) {
			cursor.sel_line = cursor.line
			cursor.sel_char = cursor.char
		} else if (keep_selection == 'select_all') {
			cursor.sel_line = lines.length-1
			cursor.sel_char = lines[cursor.sel_line].length
		}
		ui.scroll_to_view_rect(id+'.text_scrollbox', ...cursor_rect(cursor))
	}

	function set_block_cursor(line, col, sel_line, sel_col) {
		assert(cursor.block)
		undo_push_cursor()
		find_landed = false
		cursor.line = line
		cursor.col = col
		cursor.sel_line = sel_line
		cursor.sel_col = sel_col
		ui.scroll_to_view_rect(id+'.text_scrollbox', ...cursor_rect(cursor))
	}

	function insert_text(line, char, s, normalize_tabs) {
		if (!s)
			return [line, char]
		let line_s = lines[line]
		if (char > line_s.length) {
			s = ' '.repeat(char - line_s.length) + s
			char = line_s.length
		}
		let s1 = line_s.slice(0, char)
		let s2 = line_s.slice(char)
		// normalize line terminators before splitting so that text passed
		// to lines_changes() below matches the text in the lines.
		s = normalize_newlines(s)
		// split insert text into lines
		let ins_lines = text_lines(s)
		if (normalize_tabs) {
			let in_indent = first_content_char(s1) < 0
			let changed
			for (let i = 0; i < ins_lines.length; i++) {
				let line_s = ins_lines[i]
				let content_char = 0
				if (i > 0 || in_indent)
					content_char = first_content_char(line_s)
				if (content_char < 0 || line_s.indexOf('\t', content_char) < 0)
					continue
				ins_lines[i] = line_s.slice(0, content_char)
					+ line_s.slice(content_char).replaceAll('\t', ' ')
				changed = true
			}
			if (changed)
				s = ins_lines.join(newline)
		}
		// prepend s1 to the first insert line.
		ins_lines[0] = s1 + ins_lines[0]
		// append s2 to the last insert line.
		let end_line = line + ins_lines.length - 1
		let end_char = ins_lines.at(-1).length
		ins_lines[ins_lines.length-1] += s2
		// make room for new lines (first line is fused at cursor).
		insert_lines(line + 1, ins_lines.length - 1)
		// set the new lines (first and last is overwritten).
		for (let i = 0, n = ins_lines.length; i < n; i++)
			lines[line + i] = ins_lines[i]
		undo_push(remove_text, line, char, end_line, end_char)
		text_changed(line, char, 0, s.length)
		return [end_line, end_char]
	}

	function remove_text(line1, char1, line2, char2) {
		char1 = min(char1, lines[line1].length)
		char2 = min(char2, lines[line2].length)
		if (line1 == line2 && char1 == char2)
			return
		let removed_s
		if (line1 == line2) {
			removed_s = lines[line1].slice(char1, char2)
		} else {
			let removed_lines = [lines[line1].slice(char1)]
			for (let line = line1 + 1; line < line2; line++)
				removed_lines.push(lines[line])
			removed_lines.push(lines[line2].slice(0, char2))
			removed_s = removed_lines.join(newline)
		}
		lines[line1] = lines[line1].slice(0, char1) + lines[line2].slice(char2)
		remove_lines(line1 + 1, line2 - line1)

		undo_push(insert_text, line1, char1, removed_s)
		text_changed(line1, char1, removed_s.length, 0)
	}

	// replaces the selection with s, or with s[i] per line when the cursor
	// is a block and s is an array of one string per line.
	function replace_selection(s, normalize_tabs) {
		if (cursor.block) {
			let [line1, col1, line2, col2] = block_sel_range(cursor)
			for (let line = line1; line <= line2; line++) {
				remove_text(line, block_char(line, col1),
					line, block_char(line, col2))
				insert_text(line, col_to_char(col1, lines[line], tab_width),
					isarray(s) ? s[line - line1] : s)
			}
			set_block_cursor(cursor.line, col1, cursor.sel_line, col1)
		} else {
			let [line1, char1, line2, char2] = sel_range(cursor)
			remove_text(line1, char1, line2, char2)
			let [end_line, end_char] =
				insert_text(line1, char1, s, normalize_tabs)
			set_cursor(end_line, end_char, false)
		}
	}

	function remove_selection() {
		if (cursor_has_selection(cursor))
			replace_selection('')
	}

	function indent_selection() {
		let line1 = min(cursor.line, cursor.sel_line)
		let line2 = max(cursor.line, cursor.sel_line)
		for (let i = line1; i <= line2; i++)
			insert_text(i, 0, '\t')
		if (cursor.block)
			set_block_cursor(cursor.line, cursor.col + tab_width,
				cursor.sel_line, cursor.sel_col + tab_width)
		else
			set_cursor(cursor.line, cursor.char + 1, null, false,
				cursor.sel_line, cursor.sel_char + 1)
	}

	function outdent_selection() {
		let line1 = min(cursor.line, cursor.sel_line)
		let line2 = max(cursor.line, cursor.sel_line)
		if (cursor.block) {
			for (let i = line1; i <= line2; i++)
				if (lines[i].charCodeAt(0) != 9)
					return
			for (let i = line1; i <= line2; i++)
				remove_text(i, 0, i, 1)
			set_block_cursor(cursor.line, max(0, cursor.col - tab_width),
				cursor.sel_line, max(0, cursor.sel_col - tab_width))
		} else {
			let caret_n = 0
			let anchor_n = 0
			for (let i = line1; i <= line2; i++) {
				if (lines[i].charCodeAt(0) == 9) {
					remove_text(i, 0, i, 1)
					if (i == cursor.line) caret_n = -1
					if (i == cursor.sel_line) anchor_n = -1
				}
			}
			if (caret_n || anchor_n)
				set_cursor(cursor.line, cursor.char + caret_n, null, false,
					cursor.sel_line, cursor.sel_char + anchor_n)
		}
	}

	// undo/redo stacks -------------------------------------------------------

	function undo_push(fn, ...args) {
		if (undo_group == 'ignore') return
		assert(undo_group) // undoable ops must be done inside an undo_group.
		undo_push_cursor() // pushed only if last undo command was of different group!
		undo_stack.push([undo_group, fn, ...args])
	}

	function undo() {
		undoing = true
		let stack = undo_stack
		undo_stack = redo_stack
		while (1) {
			let rec = stack.pop()
			if (!rec)
				break
			undo_group = rec.shift()
			let fn     = rec.shift()
			fn(...rec)
			if (!stack.length)
				break
			let next_undo_group = stack.at(-1)[0]
			if (next_undo_group != undo_group) {
				if (next_undo_group == 'break')
					stack.pop()
				break
			}
		}
		undo_group = null
		undo_stack = stack
		undoing = false
	}

	function redo() {
		;[redo_stack, undo_stack] = [undo_stack, redo_stack]
		undo()
		;[redo_stack, undo_stack] = [undo_stack, redo_stack]
	}

	// syntax highlighting updating -------------------------------------------

	let LinesInput = class {
		chunk(pos) {
			let line = find_line(pos)
			let line_pos = line_offset(line)
			let char = pos - line_pos
			let line_s = lines[line]
			if (char < line_s.length)
				return line_s.slice(char)
					+ (line < lines.length - 1 ? newline : '')
			if (line < lines.length - 1)
				return newline.slice(char - line_s.length)
			return ''
		}
		read(from, to) {
			let line = find_line(from)
			let line_pos = line_offset(line)
			let line_s = lines[line]
			if (to <= line_pos + line_s.length)
				return line_s.slice(from - line_pos, to - line_pos)
			let parts = []
			while (from < to) {
				let s = this.chunk(from).slice(0, to - from)
				parts.push(s)
				from += s.length
			}
			return parts.join('')
		}
		get lineChunks() {
			return false
		}
		get length() {
			return text_length()
		}
	}
	let lines_input = new LinesInput()

	function text_changed(line, char, removed_n, inserted_n) {
		// TODO: save this and make it retreivable somehow.
		if (!undoing)
			redo_stack.length = 0
		changes.push(line, char, removed_n, inserted_n)
	}

	function update_text_state(reparse_all) {
		if (!reparse_all && !changes.length)
			return

		last_vline1 = -1
		last_vline2 = -1

		max_line_col = 0
		for (let line_s of lines)
			max_line_col = max(max_line_col,
				char_to_col(line_s.length, line_s, tab_width))

		compute_line_offsets()

		if (reparse_all) {
			syntax_tree = parser.parse(lines_input)
			build_colors(0)
		} else {
			let change_ranges = []
			let from_line = changes[0]
			let delta = 0 // chars added by the changes recorded before this one
			for (let i = 0, n = changes.length; i < n; i += 4) {
				let line       = changes[i+0]
				let char       = changes[i+1]
				let removed_n  = changes[i+2]
				let inserted_n = changes[i+3]
				let fromB = pos_at(line, char)
				let fromA = fromB - delta
				change_ranges.push({
					fromA: fromA, toA: fromA + removed_n,
					fromB: fromB, toB: fromB + inserted_n,
				})
				delta += inserted_n - removed_n
				from_line = min(from_line, line)
			}
			let fragments = Lezer.TreeFragment.addTree(syntax_tree)
			fragments = Lezer.TreeFragment.applyChanges(fragments, change_ranges)
			syntax_tree = parser.parse(lines_input, fragments)
			build_colors(from_line)
		}

		if (find_text)
			find_scan()

		changes.length = 0
	}

	function build_colors(from_line = 0) {
		for (let line = from_line; line < line_colors.length; line++)
			line_colors[line].length = 0
		Lezer.highlightTree(syntax_tree, Lezer.classHighlighter,
		function(from, to, classes) {
			let color = classes.includes('tok-invalid') ? 'error' : null
			for (let cls of classes.split(' ')) {
				color = color || token_colors[cls]
				if (color)
					break
			}
			if (!color)
				return
			let line1 = find_line(from)
			let line2 = find_line(to)
			let line1_s = lines[line1]
			let char1 = from - line_offset(line1)
			let col1 = char_to_col(char1, line1_s, tab_width)
			if (line2 > line1) {
				if (line1 >= from_line) {
					let w1 = char_to_col(line1_s.length, line1_s, tab_width) - col1
					line_colors[line1].push(col1, w1, color)
				}
				for (let line = max(line1 + 1, from_line); line < line2; line++) {
					let line_s = lines[line]
					let w = char_to_col(line_s.length, line_s, tab_width)
					line_colors[line].push(0, w, color)
				}
				if (line2 >= from_line) {
					let line2_s = lines[line2]
					let char2 = to - line_offset(line2)
					let col2 = char_to_col(char2, line2_s, tab_width)
					line_colors[line2].push(0, col2, color)
				}
			} else if (line1 >= from_line) {
				let w = to - from
				line_colors[line1].push(col1, w, color)
			}
		}, from_line == 0 ? 0 : pos_at(from_line, 0))
	}

	// UI ---------------------------------------------------------------------

	function on_sidebar_frame(a, _i, x, y, w, h, vx, vy, vw, vh) {
		let sy = vy - y
		let vline1 = floor(sy / line_h)
		let vline2 = vline1 + (floor(vh / line_h) + 2) - 1
		vline1 = max(0, min(vline1, lines.length - 1))
		vline2 = max(0, min(vline2, lines.length - 1))

		ui.code_edit_sidebar(x, y, sidebar_digits_w, vx, vy, vw, vh, vline1, vline2,
			line_h, font_size, font_descent, sidebar_margin_l, bookmark_lines)
	}

	function on_text_frame(a, _i, x, y, w, h, vx, vy, vw, vh) {

		let sx = vx - x
		let sy = vy - y

		// number of lines fully or partially in the viewport.
		let vline_n = floor(vh / line_h) + 2 // 2 is right, think it!
		let vline1 = floor(sy / line_h)
		let vline2 = vline1 + vline_n - 1
		vline1 = max(0, min(vline1, lines.length - 1))
		vline2 = max(0, min(vline2, lines.length - 1))

		if (last_vline1 != vline1 || last_vline2 != vline2) {
			vlines .length = vline2 - vline1 + 1
			vcolors.length = vline2 - vline1 + 1
			vfinds .length = vline2 - vline1 + 1
			for (let line = vline1; line <= vline2; line++) {
				let s = lines[line]
				let c = assert(line_colors[line])
				let f = vfinds[line - vline1]
				if (f) // reuse slot
					f.length = 0
				else
					vfinds[line - vline1] = []
				vlines [line - vline1] = s
				vcolors[line - vline1] = c
			}
			if (find_open) {
				let char_n = find_text.length
				let i0 = binsearch(find_lines, vline1, '<')
				for (let i = i0, n = find_lines.length; i < n; i++) {
					let line = find_lines[i]
					if (line > vline2)
						break
					let char = find_chars[i]
					let line_s = lines[line]
					let col1 = char_to_col(char, line_s, tab_width)
					let col2 = char_to_col(char + char_n, line_s, tab_width)
					vfinds[line - vline1].push(col1, col2 - col1)
				}
			}
			last_vline1 = vline1
			last_vline2 = vline2
		}

		ui.stack(id+'.text_contentbox')
			ui.measure(id+'.text_contentbox')
			ui.code_edit_text(x, y, vx, vy, vw, vh,
				line_h, font_size, font_descent, char_w,
				vline1, vline2, vlines, tab_width, vcolors,
				hit_line, cursor, ui.focused(id), vfinds, find_landed)
		ui.end_stack()
	}

	e.render = function(min_w, min_h) {

		// set layout vars

		font_size = ui.get_font_size()
		line_h = round(font_size * 1.5)
		{
			let font0 = cx.font
			cx.font = font_size+'px mono'
			let m = ui.measure_text(cx, 'm')
			cx.font = font0
			char_w = m.width
			font_descent = m.fontBoundingBoxDescent
		}
		sidebar_digits_w = (lines.length+'').length * char_w
		sidebar_margin_l = ui.em(1.25)
		let sidebar_margin_r = ui.sp1()
		let sidebar_w = sidebar_margin_l + sidebar_digits_w + sidebar_margin_r
		let text_w = ceil(max(max_line_col, cursor_col(cursor)) * char_w
			+ caret_w)
		let text_h = lines.length * line_h

		let [drag_state] = ui.drag(id+'.text_contentbox')
		if (drag_state == 'drag')
			ui.focus(id)

		// move cursor and select text based on mouse clicking and dragging.

		hit_line = null
		if (drag_state) {
			let text_state = ui.state(id+'.text_contentbox')
			let x = text_state.x
			let y = text_state.y
			hit_line = floor((ui.my - y) / line_h)
			hit_line = clamp(hit_line, 0, lines.length-1)
			let line_s = lines[hit_line]
			let hit_col = floor((ui.mx - x + char_w / 2) / char_w)
			let hit_char = col_to_char(hit_col, line_s, tab_width)
			if (drag_state != 'hover') {
				undo_group = drag_state == 'dragging' ? 'ignore' : 'drag'
				if (ui.keypressed('ctrl')) {
					set_block_mode(true)
					let sel_line = drag_state == 'drag' ? hit_line : cursor.sel_line
					let sel_col  = drag_state == 'drag' ? hit_col  : cursor.sel_col
					let bline1 = min(hit_line, sel_line)
					let bline2 = max(hit_line, sel_line)
					if (block_col_ok(hit_col, bline1, bline2)
							&& block_col_ok(sel_col, bline1, bline2))
						set_block_cursor(hit_line, hit_col, sel_line, sel_col)
				} else {
					set_block_mode(false)
					set_cursor(hit_line, hit_char, drag_state != 'drag')
				}
			}
			undo_group = null
		}

		// process keyboard input

		if (ui.focused(id)) {

			ui.capture_tab(id)
			ui.capture_tab(id, true)

			for (let [event, full_key, key, key_char, ctrl, alt, shift] of ui.key_events) {
				if (event != 'down')
					continue
				let lines_n = 0
				let chars_n = 0
				let scroll_lines = 0

				// NOTE: some key combos are captured by browser, namely:
				// ctrl+pgup/dn, ctrl(+shift)+tab
				if      (key == 'arrowup'    && (!ctrl || shift)) lines_n = -1
				else if (key == 'arrowdown'  && (!ctrl || shift)) lines_n =  1
				else if (key == 'pageup'             ) lines_n = -(last_vline2 - last_vline1)
				else if (key == 'pagedown'           ) lines_n =  (last_vline2 - last_vline1)
				else if (key == 'home'       &&  ctrl) lines_n = -1/0
				else if (key == 'end'        &&  ctrl) lines_n =  1/0
				else if (key == 'arrowleft'          ) chars_n = -1
				else if (key == 'arrowright'         ) chars_n =  1
				else if (key == 'arrowup'    &&  ctrl) scroll_lines = -1
				else if (key == 'arrowdown'  &&  ctrl) scroll_lines =  1

				if (scroll_lines) { // scrolling without moving the cursor
					let ss = ui.state(id+'.text_scrollbox')
					ss.scroll_y = (ss.scroll_y ?? 0) + scroll_lines * line_h
				}

				if (chars_n || lines_n)
					undo_group = 'move'

				if (lines_n && ctrl && shift)
					set_block_mode(true)

				if (cursor.block && !shift && (chars_n || lines_n))
					set_block_mode(false)

				if (cursor.block && (chars_n || lines_n)) { // block navigation
					let bline1 = min(cursor.line, cursor.sel_line)
					let bline2 = max(cursor.line, cursor.sel_line)
					if (chars_n) {
						let col = next_block_col(cursor.col, bline1, bline2, chars_n)
						set_block_cursor(cursor.line, col,
							cursor.sel_line, cursor.sel_col)
					} else {
						let line = clamp(cursor.line + lines_n, 0, lines.length-1)
						let nline1 = min(line, cursor.sel_line)
						let nline2 = max(line, cursor.sel_line)
						if (block_col_ok(cursor.col, nline1, nline2)
								&& block_col_ok(cursor.sel_col, nline1, nline2))
							set_block_cursor(line, cursor.col,
								cursor.sel_line, cursor.sel_col)
					}
				} else if (cursor.block
						&& (key == 'backspace' || key == 'delete')) {
					undo_group = 'delete'
					if (cursor_has_selection(cursor)) {
						remove_selection()
					} else {
						let [bline1, col1, bline2, col2] =
							block_sel_range(cursor)
						if (key == 'delete')
							col2 = next_block_col(col2, bline1, bline2, 1)
						else
							col1 = next_block_col(col1, bline1, bline2, -1)
						if (col1 < col2) {
							for (let line = bline1; line <= bline2; line++)
								remove_text(line, block_char(line, col1),
									line, block_char(line, col2))
							set_block_cursor(cursor.line, col1,
								cursor.sel_line, col1)
						}
					}
				} else if (chars_n < 0) { // navigation & selection
					if (cursor.char > 0) {
						let new_char = ctrl ? prev_token(cursor) : cursor.char-1
						set_cursor(cursor.line, new_char, shift)
					} else if (cursor.line) {
						let prev_line_s = lines[cursor.line-1]
						set_cursor(cursor.line-1, prev_line_s.length, shift)
					}
				} else if (chars_n > 0) {
					if (cursor.char < lines[cursor.line].length) {
						let new_char = ctrl ? next_token(cursor) : cursor.char+1
						set_cursor(cursor.line, new_char, shift)
					} else if (cursor.line < lines.length-1) {
						set_cursor(cursor.line+1, 0, shift)
					}
				} else if (lines_n) {
					let new_line = clamp(cursor.line + lines_n, 0, lines.length-1)
					let new_char = col_to_char(cursor.want_col, lines[new_line], tab_width)
					set_cursor(new_line, new_char, shift, true)
				} else if (full_key == 'ctrl a') {
					undo_group = 'select_all'
					set_block_mode(false)
					set_cursor(0, 0, 'select_all')
				} else if (key == 'escape') {
					if (find_open) {
						close_find()
					} else {
						undo_group = 'move'
						set_block_mode(false)
						set_cursor(cursor.line, cursor.char, false)
					}
				} else if (key_char) { // typing
					undo_group = 'insert'
					replace_selection(key_char)
					if (cursor.block)
						set_block_cursor(cursor.line, cursor.col+1,
							cursor.sel_line, cursor.col+1)
				} else if (key == 'enter' && !cursor.block) {
					undo_group = 'insert'
					replace_selection(newline)
				} else if (key == 'backspace' || key == 'delete') {
					undo_group = 'delete'
					let line = cursor.line
					let char = cursor.char
					if (cursor_has_selection(cursor)) {
						remove_selection()
					} else if (key == 'delete') {
						if (char < lines[line].length)
							remove_text(line, char, line, char+1)
						else if (line < lines.length-1)
							remove_text(line, char, line+1, 0)
					} else if (char) {
						remove_text(line, char-1, line, char)
						set_cursor(line, char-1, false)
					} else if (line) {
						let prev_char = lines[line-1].length
						remove_text(line-1, prev_char, line, 0)
						set_cursor(line-1, prev_char, false)
					}
				} else if (full_key == 'tab') {
					undo_group = 'indent'
					indent_selection()
				} else if (full_key == 'shift tab') {
					undo_group = 'indent'
					outdent_selection()
				} else if (full_key == 'ctrl c') { // cut, copy, paste
					copy_selection()
				} else if (full_key == 'ctrl x') {
					undo_group = 'cut'
					copy_selection()
					remove_selection()
				} else if (key == 'paste') {
					undo_group = 'paste'
					if (cursor.block) {
						let [line1, , line2] = block_sel_range(cursor)
						let paste_lines = copied_text_is_block
								&& ui.clipboard_text == copied_text
							? text_lines(normalize_newlines(copied_text)) : null
						if (paste_lines
								&& paste_lines.length == line2 - line1 + 1)
							replace_selection(paste_lines)
					} else {
						replace_selection(ui.clipboard_text, true)
					}
				} else if (full_key == 'ctrl z') { // undo, redo
					undo()
				} else if (full_key == 'ctrl shift z' || full_key == 'ctrl y') {
					redo()
				} else if (full_key == 'f2' || full_key == 'shift f2') {
					let line = next_bookmark_line(cursor.line, shift ? -1 : 1)
					if (line != null) {
						undo_group = 'move'
						set_block_mode(false)
						set_cursor(line, 0, false)
					}
				} else if (full_key == 'ctrl f2') {
					toggle_bookmark(cursor.line)
				} else if (full_key == 'ctrl f' || full_key == 'ctrl h') {
					find_open = true
					find_replace = full_key == 'ctrl h'
					ui.focus(id+'.find_input')
					if (find_text)
						find_scan()
				} else if (full_key == 'f3' || full_key == 'shift f3') {
					find_open = true
					goto_match_from_cursor(shift ? -1 : 1)
				}
			}

			undo_group = null // every key stroke must specify undo_group

		} // for ui.key_events

		update_text_state()

		// build editor

		// not tab-focusable because then tab traps you in the editor.
		// ui.focusable(id)
		ui.v(1, 0, 's', 's', min_w, min_h)
			let tabs = [
				{id: 'tab1', label:'Tab 1'},
				{id: 'tab2', label:'Tab 2'},
			]
			ui.stack('', 0)
				let sel_tab = ui.tabs(id+'.tabs', tabs, 'tab1')
			ui.end_stack()
			ui.stack('', 0, 's', 's', 0, 1)
				ui.bb('bg2')
			ui.end_stack()
			ui.h(1, ui.sp025())

				ui.stack('', 0)
					ui.bb('bg1')
					ui.scrollbox(id+'.sidebar_scrollbox', 0, 'hide', 'hide',
						's', 's', sidebar_w, 0, null, null, null, id+'.text_scrollbox')
						ui.frame(noop, on_sidebar_frame, 0, 's', 's', sidebar_w, text_h)
					ui.end_scrollbox()
				ui.end_stack()

				ui.stack('', 1, 's', 's')

					ui.scrollbox(id+'.text_scrollbox', 1, 'auto', 'scroll')
						ui.frame(noop, on_text_frame, 1, 's', 's', text_w, text_h)
					ui.end_scrollbox()

					if (find_open) {
						ui.m(ui.sp2())
						ui.p(ui.sp2(), ui.sp1())
						ui.popup(id+'.find_popup', null, null, 'it', ']', 0, 0, 'constrain solid')
							ui.shadow(1, 1, 3, 0, false, ui.dark() ? 'black' : '#ccc')
							ui.bb('bg2', null, 1, 'intense')
							let fid = id+'.find_input'
							let rid = id+'.replace_input'
							ui.focus_group(true)
							ui.v(0, ui.sp05())
								ui.h(0, ui.sp05())
									find_text = ui.input(fid, find_text, 0)
									if (find_text != last_find_text) {
										last_find_text = find_text
										find_scan()
									}
									ui.nofocus()
									if (ui.bare_icon_button(id+'.find_prev', 'arrow-up', null, 0))
										goto_match(-1)
									ui.nofocus()
									if (ui.bare_icon_button(id+'.find_next', 'arrow-down', null, 0))
										goto_match(1)
									ui.nofocus()
									if (ui.bare_icon_button(id+'.find_close', 'close', null, 0)) {
										close_find()
										ui.focus(id)
										ui.relayout()
									}
								ui.end_h()
								if (find_replace) {
									ui.h(0, ui.sp05())
										replace_text = ui.input(rid, replace_text, 0)
										ui.nofocus()
										if (ui.button(id+'.replace', 'Replace', 0))
											replace_match()
										if (ui.button(id+'.replace_all', 'Replace All', 0))
											replace_all()
									ui.end_h()
								}
							ui.end_v()
							ui.end_focus_group()
							if (ui.focused(fid) || ui.focused(rid)) {
								if (ui.keydown('escape')) {
									close_find()
									ui.focus(id)
									ui.relayout()
								}
								if (ui.keydown('ctrl f') || ui.keydown('ctrl h')) {
									find_replace = ui.keydown('ctrl h')
									ui.relayout()
								}
								if (ui.keydown('enter')) {
									if (ui.focused(rid))
										replace_match()
									else
										goto_match(ui.keypressed('shift') ? -1 : 1)
								}
							}
						ui.end_popup()
					}

				ui.end_stack()
			ui.end_h()
		ui.end_v()

	}

	e.free = function() {}

	reset_editor(opt.code)

	return e
}

ui.code_edit = function(id, opt, min_w, min_h) {
	ui.keepalive(id)
	let s = ui.state(id)
	let view = s.view
	if (!view) {
		view = code_edit_view(id, opt)
		ui.on_free(id, () => view.free())
		s.view = view
	}
	view.render(min_w, min_h)
}

}()) // module function
