/*

	Canvas IMGUI library.
	Written by Cosmin Apreutesei. Public Domain.

USAGE (see js/demo.html):

	<script src=glue.js>
	<script src=ui.js>
	<script>
		ui.main = function() {
			if (ui.button('button1', 'OK'))
				alert('Hello!')
		}
	</script>

	Documentation is inline, search for "////" to navigate major topics and
	"///" for sections within a topic. All APIs are in the `ui` namespace, but
	not all APIs can be used in app code (i.e. in the build phase). Some APIs
	are only useful for creating widgets and some only work in certain
	rendering phases. The docs should be clear about that. Below is only the
	hi-level app code API using built-in widgets.

CONTAINERS

	ui.h|v[_aligned] (fr, gap, align, valign, min_w, min_h)
	ui.stack         (id, fr, align, valign, min_w, min_h)
	ui.sb|scrollbox  (id, fr, overflow_x, overflow_y, align, valign, min_w, min_h, sx, sy, x_id, y_id)
	ui.popup         (id, layer, target_i, side, align, min_w, min_h, flags, z_index, ox, oy)
	ui.{h|v}split    (id, size, unit, fixed_side, split_fr, gap, align, valign, min_w, min_h)
	ui.toolbox       (id, title, align, valign, x0, y0, target_i)
	ui.frame         (id, on_measure, on_build, fr, align, valign, min_w, min_h, ...args)

INPUT

	ui.button          (id, s, fr, align, valign, min_w, min_h, style)
	ui.icon_button     (id, icon, [s], fr, align, valign, min_w, min_h, style)
	ui.label           (for_id, s, fr, align, valign)
	ui.input           (id, v, fr, w, [text_align], [field], [no_box]) -> v
	ui.list_dropdown   (id, items, sel_i, fr, max_w, min_w) -> sel_i
	ui.toggle          (id, on, fr, align, valign, min_w)
	ui.checkbox        (id, on, fr, align, valign, min_w)
	ui.date_input      (id, v, [field], fr, align, valign, min_w) -> v
	ui.color_input     (id, v, fr, min_w) -> v
	ui.num_slider      (id, v, [field_or_min], [max], [decimals]) -> v

LIST

	ui.[h|v|hv]list    (id, items, focused_i, fr, align, valign,
	                   item_align, item_valign, item_fr, max_w, min_w) -> focused_i

OTHER

	ui.drag_point      (id, x, y, color)
	ui.polyline        (id, points, closed, fill_color, fill_color_state, stroke_color, stroke_color_state)
	ui.resizer         (id, default_w, default_h, axis, max_w, max_h)

RENDERING CONTROL

	ui.animate ()         request another animation frame
	ui.rebuild ([label])  request another build/layout pass in this frame

SCROLLING INTO VIEW

	ui.scroll_to_view_next_box  ()
	ui.scroll_to_view_rect      (scrollbox_id, x, y, w, h)

TODO

	toaster         side  align  timeout  spacing
	checklist
	action-band
	dialog
	slides
	md
	pagenav
	info
	errors
	range-slider
	input-group
	textarea
	[v]select-button
	textarea-input
	pass-input
	num-input
	tags-box
	tags-input
	check-dropdown
	range-calendar
	ranges-calendar
	date-input
	timeofday-input
	datetime-input
	date-range-input

*/

(function () {
"use strict"
const _G = window

// the <script global> attribute dumps the `ui` namespace into `window`
// for less typing and more name clashing.
let script_attr = k => document.currentScript.hasAttribute(k)
let ui = script_attr('global') || script_attr('ui-global') ? window : {}
_G.ui = ui

ui.VERSION = 1 // frozen at 1 until this comment is gone!

//// UTILS -------------------------------------------------------------------

const {
	repl,
	isarray, isstr, isnum, isobj, isobject, isfunc, obj,
	assert, warn, pr, debug, trace,
	floor, ceil, round, max, min, abs, clamp, snap, logbase, lerp, random,
	dec, num, str, json, json_arg, words,
	set, map, array, array_resize, array_move, empty_array, attr,
	empty_set, set_equals,
	assign, entries, insert, remove_value,
	noop, return_true, do_after, do_before,
	runafter,
	memoize,
	freelist,
	hsl_to_rgb_out,
	hsl_to_rgb_hex,
	hsl_to_rgb_int,
	hsl_to_rgba_int,
	hex_to_hsl,
	PI,
	transform_point_x,
	transform_point_y,
	runevery,
	day, week, month, weekday, year_of, month_of, month_day_of, days,
	weekday_name, month_name, time,
	parse_date, format_date,
	lang, S,
	get,
} = glue

let clock_ms = () => ui.DEBUG ? performance.now() : 0

let array_freelist = () => freelist(array)

//// THEMES ------------------------------------------------------------------

/*

Themes allow viewing a remote shared screen in the client's own color scheme,
so they can only set colors, never geometry, so that the screen shows
identical geometry to both users otherwise you won't know what you click on!

DEFAULTS

	ui.default_theme -> 'dark'
	ui.dark([theme]) -> t|f
	ui.set_default_theme(theme)

DEFINING COLORS

	ui.color_def  (theme, name, state, h, s, L, a, is_dark)       define a color
	ui.shadow_def (theme, name, x, y, blur, h, s, L, a, [inset])  define a shadow

THEME API, to be used exclusively in the drawing phase!

	ui.color_css  (name, [state], [theme]) -> css_color   for fillStyle/strokeStyle
	ui.color_hsl  (name, [state], [theme]) -> [css_color, h, s, L, a]   for hsl_adjust()
	ui.color_rgb  (name, [state], [theme]) -> 0xRRGGBB    for WebGL, ignoring alpha
	ui.color_rgba (name, [state], [theme]) -> 0xRRGGBBAA  for WebGL, with alpha
	ui.bg_is_dark   (bg_color) -> t|f                       should text be white on this bg?
	ui.get_theme    () -> theme
	ui.hsl          (h, s, L, a) -> css_color     from HSL
	ui.hsl_adjust   (c, h, s, L, a) -> css_color  from color c with adjusted h, s, L
	ui.alpha_adjust (c, a) -> css_color           from color c with adjusted alpha

	ui.set_shadow (name)   set cx.shadowColor etc. for painting a shadow

*/

/// theme objects

function color_state_map() {
	return new Map([[0, {}]]) // state 0 (normal) always present as fallback
}
function theme_make(name, is_dark) {
	themes[name] = {
		is_dark : is_dark,
		name    : name,
		colors  : color_state_map(),
		shadow : {},
	}
}
let themes = {}
ui.themes = themes
theme_make('light', false)
theme_make('dark' , true)

/// current theme

let theme // only set in draw phase
ui.get_theme = () => theme
ui.dark = (theme) => themes[theme ?? ui.default_theme].is_dark

const STATE_HOVER         =   1
const STATE_ACTIVE        =   2
const STATE_FOCUSED       =   4
const STATE_ITEM_SELECTED =   8 // list items
const STATE_ITEM_FOCUSED  =  16 // list items
const STATE_ITEM_ERROR    =  32 // list items
const STATE_NEW           =  64 // grid cells
const STATE_MODIFIED      = 128 // grid cells

let parse_state_combis = memoize(function(s) {
	s = ' '+s
	let b = 0
	if (s.includes(' hover'        )) b |= STATE_HOVER
	if (s.includes(' active'       )) b |= STATE_ACTIVE
	if (s.includes(' focused'      )) b |= STATE_FOCUSED
	if (s.includes(' item-selected')) b |= STATE_ITEM_SELECTED
	if (s.includes(' item-focused' )) b |= STATE_ITEM_FOCUSED
	if (s.includes(' item-error'   )) b |= STATE_ITEM_ERROR
	if (s.includes(' new'          )) b |= STATE_NEW
	if (s.includes(' modified'     )) b |= STATE_MODIFIED
	return b
})
function parse_state(s) {
	if (!s) return 0
	if (isnum(s)) return s
	if (s == 'normal') return 0
	if (s == 'hover' ) return STATE_HOVER
	if (s == 'active') return STATE_ACTIVE
	return parse_state_combis(s)
}

/// color utils

function hsl(h, s, L, a) {
	return `hsla(${dec(h)}, ${dec(s * 100)}%, ${dec(L * 100)}%, ${a ?? 1})`
}

function hsl_adjust(c, h, s, L, a) {
	return hsl(c[1] * h, c[2] * s, c[3] * L, (c[4] ?? 1) * (a ?? 1))
}

function alpha_adjust(c, a) {
	return hsl(c[1], c[2], c[3], (c[4] ?? 1) * a)
}

ui.hsl = hsl
ui.hsl_adjust = hsl_adjust
ui.alpha_adjust = alpha_adjust

/// color definitions

// Colors are defined in HSL so they can be adjusted if needed. Colors are
// specified by (theme, name, state) with state 0 (normal) as fallback.
// Concrete colors can also be specified by prefixing them with a `:` (for
// light colors) or `*` (for dark colors), eg. `:#fff`, `*red`, etc. but that
// throws away the ability to HSL-adjust the color.
// Colors can be copied by specifying (name, [state], [theme], [is_dark]).

function color_def(theme, name, state, h, s, L, a, is_dark) {
	if (theme == '*') { // define color for all themes
		for (let theme_name in themes)
			color_def(theme_name, name, state, h, s, L, a, is_dark)
		return
	}
	let states = themes[theme].colors
	if (state == '*') { // copy all states of a color
		assert(isstr(h), 'expected color name to copy for all states')
		for (let [state_i, src_state_colors] of states) {
			let color = src_state_colors[h]
			if (color == null)
				continue
			let dst_state_colors = states.get(state_i)
			if (!dst_state_colors) {
				dst_state_colors = {}
				states.set(state_i, dst_state_colors)
			}
			dst_state_colors[name] = color
		}
		return
	}
	let state_i = parse_state(state)
	let state_colors = states.get(state_i)
	if (!state_colors) {
		state_colors = {}
		states.set(state_i, state_colors)
	}
	if (isnum(h)) { // h, s, L, a, [is_dark]
		state_colors[name] = [hsl(h, s, L, a), h, s, L, a, is_dark]
	} else if (isarray(h)) { // color object
		state_colors[name] = h
	} else { // name, [state], [theme], [is_dark]
		let theme1 = themes[L ?? theme]
		let source_state_i = parse_state(s ?? state_i)
		let source_state_colors = theme1.colors.get(source_state_i)
		let c = (source_state_colors && source_state_colors[h]) ??
			theme1.colors.get(0)[h]
		state_colors[name] = [c[0], c[1], c[2], c[3], c[4], a ?? c[5]]
	}
}
ui.color_def = color_def

/// color lookups

// default color to fall back to when a name isn't found in the theme, so a
// missing/misspelled color name doesn't crash the whole frame.
function color_hsl(name, state, theme1) {
	let state_i = parse_state(state)
	theme1 = theme1 ? themes[theme1] : theme
	let state_colors = theme1.colors.get(state_i)
	let c = (state_colors && state_colors[name]) ??
		theme1.colors.get(0)[name]
	if (!c) {
		warn('no color for (', name, ', ',
			repl(state, 0, 'normal'), ', ', theme1.name, ')')
		c = theme1.colors.get(0).error
	}
	return c
}

let CC_COLON = ':'.charCodeAt(0) // prefix for light colors
let CC_STAR  = '*'.charCodeAt(0) // prefix for dark colors

function color_css(name, state, theme1) {
	if (name.charCodeAt(0) == CC_COLON) { // custom color
		return name.slice(1)
	}
	return color_hsl(name, state, theme1)[0]
}

function color_rgb_int(name, state, theme1) {
	let c = color_hsl(name, state, theme1)
	return hsl_to_rgb_int(c[1], c[2], c[3])
}

function color_rgba_int(name, state, theme1) {
	let c = color_hsl(name, state, theme1)
	return hsl_to_rgba_int(c[1], c[2], c[3], c[4])
}

ui.color_css = color_css
ui.color_hsl = color_hsl
ui.color_rgb = color_rgb_int
ui.color_rgba = color_rgba_int

/// set fillStyle and set theme based on whether the bg is dark or light!

function set_bg_color(color, state) {
	let dark
	assert(isstr(color))
	let c = color.charCodeAt(0)
	if (c == CC_COLON || c == CC_STAR) { // custom color: '*...' or ':...'
		dark = c == CC_STAR
		color = color.slice(1)
	} else {
		let c = color_hsl(color, state)
		dark = c[5] ?? c[3] < .5
		color = c[0]
	}
	theme = dark ? themes.dark : themes.light
	cx.fillStyle = color
}

/// text colors --------------------------------------------------------------

//         theme    name       state       h     s     L    a
// ---------------------------------------------------------------------------
ui.color_def('light', 'text'   , 'normal' ,   0, 0.00, 0.35)
ui.color_def('light', 'text'   , 'hover'  ,   0, 0.00, 0.10)
ui.color_def('light', 'text'   , 'active' ,   0, 0.00, 0.00)
ui.color_def('light', 'text'   , 'focused',   0, 0.00, 0.00)
ui.color_def('dark' , 'text'   , 'normal' ,   0, 0.00, 0.8)
ui.color_def('dark' , 'text'   , 'hover'  ,   0, 0.00, 1.00)
ui.color_def('dark' , 'text'   , 'active' ,   0, 0.00, 1.00)
ui.color_def('dark' , 'text'   , 'focused',   0, 0.00, 1.0)

ui.color_def('light', 'label'  , 'normal' ,   0, 0.00, 0.00)
ui.color_def('light', 'label'  , 'hover'  ,   0, 0.00, 0.00, 0.9)
ui.color_def('dark' , 'label'  , 'normal' ,   0, 0.00, 0.95, 0.7)
ui.color_def('dark' , 'label'  , 'hover'  ,   0, 0.00, 0.90, 0.9)

ui.color_def('dark' , 'link'   , 'normal' ,  26, 0.88, 0.60)
ui.color_def('dark' , 'link'   , 'hover'  ,  26, 0.99, 0.70)
ui.color_def('dark' , 'link'   , 'active' ,  26, 0.99, 0.80)
ui.color_def('light', 'link'   , 'normal' , 252, 0.50, 0.50, 1, true)
ui.color_def('light', 'link'   , 'hover'  , 252, 0.50, 0.40, 1, true)
ui.color_def('light', 'link'   , 'active' , 252, 0.50, 0.30, 1, true)

ui.color_def('light', 'heading', 'normal' ,   0, 0.00, 0.55)
ui.color_def('dark' , 'heading', 'normal' , 252, 0.10, 0.55)

ui.color_def('light', 'faint'  , 'normal' ,   0, 0.00, 0.70)
ui.color_def('dark' , 'faint'  , 'normal' ,   0, 0.00, 0.30)

ui.color_def('light', 'marker' , 'normal' ,  61, 1.00, 0.35)
ui.color_def('light', 'marker' , 'hover'  ,  61, 1.00, 0.42)
ui.color_def('light', 'marker' , 'active' ,  61, 1.00, 0.48)
ui.color_def('dark' , 'marker' , 'normal' ,  61, 1.00, 0.57)
ui.color_def('dark' , 'marker' , 'hover'  ,  61, 1.00, 0.65)
ui.color_def('dark' , 'marker' , 'active' ,  61, 1.00, 0.72)

ui.color_def('*', 'button-text', 'normal' , 'text', 'active')

ui.color_def('light', 'button-danger', 'normal', 0, 0.54, 0.43)
ui.color_def('dark' , 'button-danger', 'normal', 0, 0.54, 0.43)

/// border colors ------------------------------------------------------------

//             theme    name        state       h     s     L     a
// ---------------------------------------------------------------------------
ui.color_def('light', 'light'   , 'normal' ,   0,    0,    0, 0.10)
ui.color_def('light', 'light'   , 'hover'  ,   0,    0,    0, 0.30)
ui.color_def('light', 'intense' , 'normal' ,   0,    0,    0, 0.30)
ui.color_def('light', 'intense' , 'hover'  ,   0,    0,    0, 0.40)
ui.color_def('light', 'max'     , 'normal' ,   0,    0,    0, 1.00)
ui.color_def('light', 'marker'  , 'normal' ,  61, 1.00, 0.35, 1.00)

ui.color_def('dark' , 'light'   , 'normal' ,   0,    0,    1, 0.09)
ui.color_def('dark' , 'light'   , 'hover'  ,   0,    0,    1, 0.03)
ui.color_def('dark' , 'intense' , 'normal' ,   0,    0,    1, 0.20)
ui.color_def('dark' , 'intense' , 'hover'  ,   0,    0,    1, 0.40)
ui.color_def('dark' , 'max'     , 'normal' ,   0,    0,    1, 1.00)
ui.color_def('dark' , 'marker'  , 'normal' ,  61, 1.00, 0.57, 1.00)

/// background colors --------------------------------------------------------

function bg_is_dark(bg_color) {
	return isarray(bg_color) ? (bg_color[5] ?? bg_color[3] < .5) : theme.is_dark
}
ui.bg_is_dark = bg_is_dark

//           theme    name      state       h     s     L     a
// -------------------------------------------------------------
ui.color_def('light', 'bg0'   , 'normal' ,   0, 0.00, 0.98)
ui.color_def('light', 'bg'    , 'normal' ,   0, 0.00, 1.00)
ui.color_def('light', 'bg'    , 'hover'  ,   0, 0.00, 0.95)
ui.color_def('light', 'bg'    , 'active' ,   0, 0.00, 0.93)
ui.color_def('light', 'bg1'   , 'normal' ,   0, 0.00, 0.95)
ui.color_def('light', 'bg1'   , 'hover'  ,   0, 0.00, 0.93)
ui.color_def('light', 'bg1'   , 'active' ,   0, 0.00, 0.90)
ui.color_def('light', 'bg2'   , 'normal' ,   0, 0.00, 0.85)
ui.color_def('light', 'bg2'   , 'hover'  ,   0, 0.00, 0.82)
ui.color_def('light', 'bg3'   , 'normal' ,   0, 0.00, 0.70)
ui.color_def('light', 'bg3'   , 'hover'  ,   0, 0.00, 0.75)
ui.color_def('light', 'bg3'   , 'active' ,   0, 0.00, 0.80)
ui.color_def('light', 'alt'   , 'normal' ,   0, 0.00, 0.98) // grid cell alternate
ui.color_def('light', 'smoke' , 'normal' ,   0, 0.00, 1.00, 0.80)
ui.color_def('light', 'input' , 'normal' ,   0, 0.00, 0.98)
ui.color_def('light', 'input' , 'focused',   0, 0.00, 1.00)
ui.color_def('light', 'input' , 'hover'  ,   0, 0.00, 0.94)
ui.color_def('light', 'input' , 'active' ,   0, 0.00, 0.90)

ui.color_def('dark' , 'bg0'   , 'normal' , 216, 0.28, 0.08)
ui.color_def('dark' , 'bg'    , 'normal' , 216, 0.28, 0.10)
ui.color_def('dark' , 'bg'    , 'hover'  , 216, 0.28, 0.12)
ui.color_def('dark' , 'bg'    , 'active' , 216, 0.28, 0.14)
ui.color_def('dark' , 'bg1'   , 'normal' , 216, 0.28, 0.15)
ui.color_def('dark' , 'bg1'   , 'hover'  , 216, 0.28, 0.19)
ui.color_def('dark' , 'bg1'   , 'active' , 216, 0.28, 0.22)
ui.color_def('dark' , 'bg2'   , 'normal' , 216, 0.28, 0.22)
ui.color_def('dark' , 'bg2'   , 'hover'  , 216, 0.28, 0.25)
ui.color_def('dark' , 'bg3'   , 'normal' , 216, 0.28, 0.29)
ui.color_def('dark' , 'bg3'   , 'hover'  , 216, 0.28, 0.31)
ui.color_def('dark' , 'bg3'   , 'active' , 216, 0.28, 0.33)
ui.color_def('dark' , 'alt'   , 'normal' , 260, 0.28, 0.13)
ui.color_def('dark' , 'smoke' , 'normal' ,   0, 0.00, 0.00, 0.70)
ui.color_def('dark' , 'input' , 'normal' , 216, 0.28, 0.17)
ui.color_def('dark' , 'input' , 'focused', 216, 0.28, 0.08)
ui.color_def('dark' , 'input' , 'hover'  , 216, 0.28, 0.21)
ui.color_def('dark' , 'input' , 'active' , 216, 0.28, 0.25)

// disable alt color. comment this to get it back.
ui.color_def('*' , 'alt', 'normal' , 'bg')

ui.color_def('light', 'scrollbar', 'normal' ,   0, 0.00, 0.70, 0.5)
ui.color_def('light', 'scrollbar', 'hover'  ,   0, 0.00, 0.75, 0.8)
ui.color_def('light', 'scrollbar', 'active' ,   0, 0.00, 0.80, 0.8)

ui.color_def('dark' , 'scrollbar', 'normal' , 216, 0.28, 0.37, 0.5)
ui.color_def('dark' , 'scrollbar', 'hover'  , 216, 0.28, 0.39, 0.8)
ui.color_def('dark' , 'scrollbar', 'active' , 216, 0.28, 0.41, 0.8)

ui.color_def('*', 'button-bg'     , '*' , 'bg1')
ui.color_def('*', 'button-primary', '*' , 'link')

ui.color_def('*', 'search' , 'normal',  60,  1.00, 0.80) // quicksearch text bg
ui.color_def('*', 'info'   , 'normal', 200,  1.00, 0.30) // info bubbles
ui.color_def('*', 'warn'   , 'normal',  39,  1.00, 0.50) // warning bubbles
ui.color_def('*', 'error'  , 'normal',   0,  0.54, 0.43) // error bubbles

// input value states
ui.color_def('light', 'item', 'new'           , 240, 1.00, 0.97)
ui.color_def('light', 'item', 'modified'      , 120, 1.00, 0.93)
ui.color_def('light', 'item', 'new modified'  , 180, 0.55, 0.87)

ui.color_def('dark' , 'item', 'new'           , 240, 0.35, 0.27)
ui.color_def('dark' , 'item', 'modified'      , 120, 0.59, 0.24)
ui.color_def('dark' , 'item', 'new modified'  , 157, 0.18, 0.20)

// grid cell & row states. these need to be opaque!
ui.color_def('light', 'item', 'item-focused'                       ,   0, 0.00, 0.93)
ui.color_def('light', 'item', 'item-selected'                      ,   0, 0.00, 0.91)
ui.color_def('light', 'item', 'item-focused item-selected'         ,   0, 0.00, 0.87)
ui.color_def('light', 'item', 'item-focused focused'               ,   0, 0.00, 0.87)
ui.color_def('light', 'item', 'item-focused item-selected focused' , 139 / 239 * 360, 141 / 240, 206 / 240)
ui.color_def('light', 'item', 'item-selected focused'              , 139 / 239 * 360, 150 / 240, 217 / 240)
ui.color_def('light', 'item', 'item-error'                         ,   0, 0.54, 0.43)
ui.color_def('light', 'item', 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.color_def('light', 'row' , 'item-focused focused'               , 139 / 239 * 360, 150 / 240, 231 / 240)
ui.color_def('light', 'row' , 'item-focused'                       , 139 / 239 * 360,   0 / 240, 231 / 240)
ui.color_def('light', 'row' , 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.color_def('dark' , 'item', 'item-focused'                       , 195, 0.06, 0.12)
ui.color_def('dark' , 'item', 'item-selected'                      ,   0, 0.00, 0.20)
ui.color_def('dark' , 'item', 'item-focused item-selected'         , 208, 0.11, 0.23)
ui.color_def('dark' , 'item', 'item-focused focused'               ,   0, 0.00, 0.23)
ui.color_def('dark' , 'item', 'item-focused item-selected focused' , 211, 0.62, 0.24)
ui.color_def('dark' , 'item', 'item-selected focused'              , 211, 0.62, 0.19)
ui.color_def('dark' , 'item', 'item-error'                         ,   0, 0.54, 0.43)
ui.color_def('dark' , 'item', 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.color_def('dark' , 'row' , 'item-focused focused'               , 212, 0.61, 0.13)
ui.color_def('dark' , 'row' , 'item-focused'                       ,   0, 0.00, 0.13)
ui.color_def('dark' , 'row' , 'item-error item-focused'            ,   0, 1.00, 0.60)

//// CANVAS SETUP ------------------------------------------------------------

/*

There's only one global canvas stretched to the entire viewport for now
since we're not planning to have our canvas-based UI embedded in a normal
HTML page any time soon.

	ui.screen          access to canvas container div
	ui.resize()        resize canvas and request another animation frame

*/

function css(s) {
	let style = document.createElement('style')
	style.innerHTML = s
	document.head.appendChild(style)
}

css(`

* { box-sizing: border-box; }

html, body {
	width: 100%;
	height: 100%;
	padding: 0;
	margin: 0;
	border: 0;
	overflow: hidden;
	touch-action: none;
}

body {
	display: flex;
}

.ui-screen {
	position: relative; /* all inner elements are positioned relative to it */
	overflow: hidden; /* because hidden <input> elements go out of screen */
	flex: 1; /* stretch it */
}

.ui-canvas {
	position: absolute;
}

.ui-canvas:focus {
	outline: none;
}

.ui-input, .ui-input:focus {
	position: absolute;
	padding: 0;
	margin: 0;
	border: 0;
	background: none;
	outline: none;
	cursor: inherit;
}

`)

let screen = document.createElement('div')
screen.classList.add('ui-screen')
ui.screen = screen

let canvas = document.createElement('canvas')
canvas.classList.add('ui-canvas')
canvas.setAttribute('tabindex', 0)
screen.appendChild(canvas)

let cx = canvas.getContext('2d')
ui.cx = cx

let screen_w, screen_h, dpr

function resize_canvas() {
	let dpr1 = devicePixelRatio
	let screen_r = screen.getBoundingClientRect()
	let w = floor(screen_r.width  * dpr1)
	let h = floor(screen_r.height * dpr1)
	if (screen_w == w && screen_h == h && dpr == dpr1)
		return
	dpr = dpr1
	screen_w = w
	screen_h = h
	canvas.style.width  = (screen_w / dpr) + 'px'
	canvas.style.height = (screen_h / dpr) + 'px'
	canvas.width  = screen_w
	canvas.height = screen_h
	font_size_normal = ui.font_size_normal * dpr
	animate()
}
ui.resize = resize_canvas
window.addEventListener('resize', resize_canvas)

ui.default_theme = document.documentElement.getAttribute('theme') ?? 'light'
ui.default_font  = document.documentElement.getAttribute('font' ) ?? 'Arial'
function set_screen_bg() {
	theme = themes[ui.default_theme]
	let color = color_css('bg')
	theme = null
	document.documentElement.style.background = color
}
ui.set_default_theme = function(theme) {
	theme ??= system_in_dark_mode() ? 'dark' : 'light'
	ui.default_theme = theme
	set_screen_bg()
}

function system_in_dark_mode() {
	let mql = window.matchMedia
		&& window.matchMedia('(prefers-color-scheme: dark)')
	return !!(mql && mql.matches)
}

window.matchMedia('(prefers-color-scheme: dark)')
	.addEventListener('change', function(ev) {
		ui.set_default_theme()
	})

// prevent flicker on load by setting the screen's background color now.
ui.set_default_theme()
set_screen_bg()

/// font loading

let fonts_to_load = []
ui.load_font = function(name, url, desc) {
	fonts_to_load.push([name, url, desc])
}

document.addEventListener('DOMContentLoaded', async function() {
	let promises = []
	for (let [name, url, desc] of fonts_to_load) {
		desc ??= url.includes('.var.') ? {weight: '1 1000'} : {}
		let font = new FontFace(name, `url(${url})`, desc)
		promises.push(font.load().then(loaded => document.fonts.add(loaded)))
	}
	await Promise.all(promises)
	await document.fonts.ready
	ready = true
	assert(ui.main, 'ui.main not set')
	document.body.appendChild(ui.screen)
	resize_canvas()
	canvas.focus()
})

//// MOUSE HANDLING ----------------------------------------------------------

/*

We support multiple pointers for screen sharing / remote control situations
but only one can be active at any one time, so two users can't hover two
things at the same time and can't drag multiple things at the same time,
and other users can't use the mouse while one user is dragging something.

"true" multiple pointer support may sound cool, but it would complicate
mouse handling *for every widget*, and it would be a nightmare to figure
out what ops are allowed in the UI while one user is dragging something.

	ui.pointers        [p1, ...]
	ui.add_pointer     () -> pointer
	ui.pointer         -> p    active pointer

	ui.mx              active pointer x-coord, transformed
	ui.my              active pointer y-coord, transformed
	ui.mx_notrans      active pointer x-coord
	ui.my_notrans      active pointer y-coord
	ui.pressed         active pointer pressed
	ui.click           active pointer clicked
	ui.clickup         active pointer de-clicked
	ui.dblclick        active pointer double-clicked
	ui.wheel_dy        active pointer wheel delta
	ui.trackpad        active pointer wheel delta is from is a trackpad

	ui.local_pointer   = default pointer that tracks the local mouse and keyboard
	ui.mx0 my0         = mouse position when started dragging
	ui.update_mouse    ()   update mouse coords to current transform
	ui.hit_rect        (x, y, w, h) -> t|f
	ui.hit_bb          (x1, y1, x2, y2) -> t|f  ; bb means bounding box
	ui.hit_box         (a, i) -> t|f

	ui.captured_id     = id of the widget that mouse is down on
	ui.captured        (id) -> cs | null  get captured state if mouse is captured

	ui.hit             (id[, k]) -> hs|v|null hit state if id is directly hit or dragging
	ui.clicked         (id) -> hs|v|null  hit state if id was clicked this frame
	ui.dblclicked      (id) -> hs|v|null  hit state if id was double-clicked
	ui.hit_enter       (id) -> t|f            mouse started hovering widget
	ui.hit_leave       (id) -> t|f            mouse stopped hovering widget
	ui.hovers          (id) -> hs|null        hit state if mouse hovers or dragging over id
	ui.set_hit         (id) -> hs             declare that mouse hovers widget
	ui.nohit           ()                     exclude last command from hit-testing

	ui.drag            (id, ['x'|'y'|'xy']) -> cs|null  drag state if id is captured
	     cs.drag       first frame of the drag
	     cs.dragging   every frame from drag to drop
	     cs.drop       last frame of the drag
	     cs.dx,dy      how far the mouse moved since the press
	ui.drag_or_hit     (id) -> cs|hs|null  drag(id), else hit(id)

	ui.set_cursor      (cursor)   set cursor for this frame

*/

ui.pointers = []

ui.add_pointer = function() {

	let p = {}

	p.mx = null
	p.my = null
	p.pressed = false
	p.key_state = set() // keys held down by this pointer's user
	reset_pointer_state(p)

	ui.pointers.push(p)

	p.remove = function() {
		remove_value(ui.pointers, p)
	}

	p.activate = function() {

		if (ui.pointer && ui.pointer != p && ui.pointer.pressed)
			return

		ui.pointer = p

		if (!p.pressed) {
			if (ui.mx == null && p.mx != null) ui.mouseenter = true
			if (ui.mx != null && p.mx == null) ui.mouseleave = true
		}

		ui.mx         = p.mx
		ui.my         = p.my
		ui.mx_notrans = p.mx
		ui.my_notrans = p.my
		ui.pressed    = p.pressed
		ui.click      = p.click
		ui.clickup    = p.clickup
		ui.dblclick   = p.dblclick
		ui.wheel_dy   = p.wheel_dy
		ui.trackpad   = p.trackpad

		return true
	}

	return p
}

ui.mx0 = null
ui.my0 = null
ui.captured_id = null

ui.local_pointer = ui.add_pointer()

ui.local_pointer.activate()

function reset_pointer_state(p) {
	p.click = false
	p.clickup = false
	p.dblclick = false
	p.wheel_dy = 0
	p.trackpad = false
	p.mouseenter = false
	p.mouseleave = false
}

function update_mouse(ev) {
	ui.local_pointer.mx = round(ev.clientX * dpr)
	ui.local_pointer.my = round(ev.clientY * dpr)
}

screen.addEventListener('pointerdown', function(ev) {
	update_mouse(ev)
	if (ev.button == 0) {
		ui.local_pointer.click = true
		ui.local_pointer.pressed = true
		if (ev.target == canvas)
			canvas.setPointerCapture(ev.pointerId)
	}
	ui.local_pointer.activate()
	animate()
})

screen.addEventListener('pointerup', function(ev) {
	update_mouse(ev)
	if (ev.button == 0) {
		ui.local_pointer.pressed = false
		ui.local_pointer.clickup = true
		if (ev.target == canvas)
			canvas.releasePointerCapture(ev.pointerId)
	}
	ui.local_pointer.activate()
	animate()
})

screen.addEventListener('dblclick', function(ev) {
	update_mouse(ev)
	if (ev.button == 0) {
		ui.local_pointer.dblclick = true
	}
	ui.local_pointer.activate()
	animate()
})

screen.addEventListener('pointermove', function(ev) {
	update_mouse(ev)
	ui.local_pointer.activate()
	animate()
})

screen.addEventListener('pointerenter', function(ev) {
	update_mouse(ev)
	ui.local_pointer.activate()
	animate()
})

screen.addEventListener('pointerleave', function(ev) {
	if (ui.pointer != ui.local_pointer || ui.captured_id == null) {
		ui.local_pointer.mx = null
		ui.local_pointer.my = null
	}
	ui.local_pointer.activate()
	ui.set_cursor()
	apply_cursor()
	animate()
})

// NOTE: wheelDeltaY is 150 in chrome and 120 if FF. Browser developers...
screen.addEventListener('wheel', function(ev) {
	ui.local_pointer.wheel_dy = ev.deltaY * dpr
	if (!ui.local_pointer.wheel_dy)
		return
	ui.local_pointer.trackpad = ev.wheelDeltaY === -ev.deltaY * 3
	update_mouse(ev)
	ui.local_pointer.activate()
	animate()
})

function hit_bb(x1, y1, x2, y2) {
	return (
		(ui.mx >= x1 && ui.mx < x2) &&
		(ui.my >= y1 && ui.my < y2)
	)
}
ui.hit_bb = hit_bb
function hit_rect(x, y, w, h) {
	return hit_bb(x, y, x+w, y+h)
}
ui.hit_rect = hit_rect

/// mouse pointer on current transform

ui.update_mouse = function() {
	let m = cx.getTransform().invertSelf()
	let mx = ui.mx_notrans
	let my = ui.my_notrans
	ui.mx = transform_point_x(m, mx, my)
	ui.my = transform_point_y(m, mx, my)
}

/// mouse capture state

let capture_state

function capture(id) {
	ui.captured_id = id
	capture_state = assign(obj(), hovers(id))
	ui.mx0 = ui.mx
	ui.my0 = ui.my
}

function captured(id) {
	return id && ui.captured_id == id && capture_state || null
}

function release_capture() {
	ui.captured_id = null
	capture_state = null
	ui.click = false
	ui.pointer.click = false
}

/// drag & drop

ui.drag = function(id, axis) {
	let cs = captured(id)
	if (!cs)
		return null
	let move_x = !axis || axis == 'x' || axis == 'xy'
	let move_y = !axis || axis == 'y' || axis == 'xy'
	cs.dx = move_x ? ui.mx - ui.mx0 : 0
	cs.dy = move_y ? ui.my - ui.my0 : 0
	cs.drag = ui.click // the hit phase captured it this frame
	cs.dragging = true
	cs.drop = ui.clickup
	return cs
}

function drag_or_hit(id) {
	return ui.drag(id) || hit(id)
}
ui.drag_or_hit = drag_or_hit

/// setting the cursor icon

let cur_cursor
ui.set_cursor = function(cursor) {
	cur_cursor = cursor
}

function apply_cursor() {
	let cursor = cur_cursor ?? 'initial'
	let screen_cursor = cursor == 'initial' ? 'default' : cursor
	// when the mouse is captured, setting the cursor for the element that
	// is hovered doesn't work anymore, so we use this hack instead.
	let root_style = document.documentElement.style
	let root_cursor = ui.captured_id ? cursor : ''
	if (root_style.cursor != root_cursor)
		root_style.setProperty('cursor', root_cursor, 'important')
	if (screen.style.cursor != screen_cursor)
		screen.style.cursor = screen_cursor
	if (canvas.style.cursor != cursor)
		canvas.style.cursor = cursor
}

//// KEYBOARD HANDLING -------------------------------------------------------

/*

	ui.keydown         (key) -> t|f     check if a key was just pressed
	ui.keyup           (key) -> t|f     check if a key was just depressed
	ui.keypressed      (key) -> t|f     check if the active pointer's user holds a key

	ui.key_chars () -> s          printable characters typed this frame
	ui.key_events -> [['down'|'up', full_key, key, char, ctrl, alt, shift], ...]
	ui.keys_down () -> n
	ui.keys_up   () -> n

	ui.capture_keys    ()    remove current keydown() and keyup() events
	ui.capture_keydown (key)   stop the browser from acting on a keydown
	ui.capture_keyup   (key)   stop the browser from acting on a keyup

*/

let key_downs = set()
let key_ups   = set()

ui.key_events = [] // [key_event1, ...]

// keys that the app handles itself so the browser must not act on them.
// capture is app-wide, so widget modules register at load time.
let captured_keydowns = obj()
let captured_keyups   = obj()

ui.capture_keydown = function(key) {
	captured_keydowns[key] = true
}

ui.capture_keyup = function(key) {
	captured_keyups[key] = true
}

// the modifiers come from the keys that p's user is holding, so the event must
// be made on the machine where the key is typed. a forwarded event carries its
// modifiers with it and is replayed with apply_key_event().
function make_key_event(p, ev_name, key) {
	let char = key
	key = key.toLowerCase()
	// cmd is what ctrl is on a mac, and it's the same shortcuts either way.
	if (key == 'control' || key == 'meta')
		key = 'ctrl'
	let ctrl  = p.key_state.has('ctrl' ) && key != 'ctrl'
	let alt   = p.key_state.has('alt'  ) && key != 'alt'
	let shift = p.key_state.has('shift') && key != 'shift'
	char = char.length == 1 && !ctrl && !alt ? char : null
	let prefix = ctrl || alt || shift
		? (ctrl?'ctrl ':'')+(alt?'alt ':'')+(shift?'shift ':'')
		: ''
	return [ev_name, prefix + key, key, char, ctrl, alt, shift]
}

function apply_key_event(p, ev) {
	let ev_name  = ev[0]
	let full_key = ev[1]
	let key      = ev[2]
	let key_set = ev_name == 'down' ? key_downs : key_ups
	key_set.add(key)
	key_set.add(full_key)
	ui.key_events.push(ev)
	if (ev_name == 'down')
		p.key_state.add(key)
	else
		p.key_state.delete(key)
	p.activate() // typing takes over from whoever was driving
	animate()
}

function process_key(dom_ev, ev_name, key) {
	let p = ui.local_pointer
	let ev = make_key_event(p, ev_name, key)
	apply_key_event(p, ev)
	let full_key = ev[1]
	let key_low  = ev[2] // lowercased key
	let captured = ev_name == 'down' ? captured_keydowns : captured_keyups
	if (dom_ev && (key_low == 'tab' ||
		(captured[full_key] && dom_ev.target != drawn_focused_input))
	) {
		// this allows us to supress some (but not all) browser key events.
		dom_ev.preventDefault()
	}
}
document.addEventListener('keydown', function(ev) {
	process_key(ev, 'down', ev.key)
})
document.addEventListener('keyup', function(ev) {
	process_key(ev, 'up', ev.key)
})

document.addEventListener('paste', async function(ev) {
	// getting the clipboard contents and setting keydown of pseudo-key 'paste'.
	ui.clipboard_text = await navigator.clipboard.readText()
	process_key(null, 'down', 'paste')
	// because nobody is there to depress this key.
	ui.local_pointer.key_state.delete('paste')
	animate()
})

ui.capture_keys = function() {
	key_downs.clear()
	key_ups.clear()
	ui.key_events.length = 0
}

ui.keydown = function(key) {
	return key_downs.has(key)
}

ui.keyup = function(key) {
	return key_ups.has(key)
}

ui.keypressed = function(key) {
	return ui.pointer.key_state.has(key)
}

// printable characters typed this frame
ui.key_chars = function() {
	let s = ''
	for (let ev of ui.key_events)
		if (ev[0] == 'down' && ev[3] != null)
			s += ev[3]
	return s
}

function consume_key_down(key) {
	for (let i = ui.key_events.length-1; i >= 0; i--) {
		let ev = ui.key_events[i]
		if (ev[0] == 'down' && ev[2] == key) {
			key_downs.delete(ev[1])
			key_downs.delete(ev[2])
			ui.key_events.splice(i, 1)
		}
	}
}

ui.keys_down   = () => key_downs.size
ui.keys_up     = () => key_ups.size

//// WIDGET STATE ------------------------------------------------------------

/*

Persistence between frames is kept in per-id state objects. Widgets need to
call ui.state(id) otherwise their state is garbage-collected at the end
of the frame. Widgets can also register a `free` callback to be called if
the widget doesn't appear again on a future frame. State updates can be done
in an update callback registered with ui.state() so that the widget state can
be updated in advance of the widget appearing in the frame in case the widget
state is needed before the widget appears in the frame. The update callback
is called once per build pass, either due to a state access from outside or
when the widget is created in the frame.

	ui.state           (id, [update_fn]) -> state     get own state and keep it alive
	ui.state_of        (id[, k]) -> state | v | nil   get another widget's state
	ui.set_state_of    (id, k, v)           set another widget's state var, if alive
	ui.state_init      (id, k, v)           set widget state var if widget is alive
	ui.on_free         (id, free_fn)        add a widget gc hook

*/

let state_map      = map() // {id->state}
let current_id_set = set() // {id}
let remove_id_set  = set() // {id}

// an update must run once per build pass in order to avoid acting on events
// like mouse clicks more than once (one-shot state only gets cleared at the
// end of the frame). the update is triggered by ui.state() or ui.state_of().
// build_no keeps it from running twice per build pass.
function state_update(id, s) {
	let update_fn = s?.update
	if (!update_fn)
		return
	if (s.build_no == build_no)
		return
	s.build_no = build_no
	update_fn(id, s)
}

ui.state = function(id, update_fn) {
	assert(!render_state_map, 'state() called while rendering')
	assert(id, 'id required')
	current_id_set.add(id)
	remove_id_set.delete(id)
	let s = state_map.get(id)
	if (!s) {
		s = obj()
		state_map.set(id, s)
	}
	if (update_fn)
		s.update = update_fn
	state_update(id, s)
	return s
}

ui.state_of = function(id, k) {
	assert(!render_state_map, 'state_of() called while rendering')
	if (!id)
		return
	let s = state_map.get(id)
	if (!s)
		return
	state_update(id, s)
	return k ? s[k] : s
}

ui.set_state_of = function(id, k, v) {
	let s = ui.state_of(id)
	if (!s)
		return
	s[k] = v
}

ui.state_init = function(id, k, v) {
	let s = ui.state(id)
	if (s[k] != null) return
	s[k] = v
}

function free_state(id, s) {
	if (ui.captured_id == id)
		release_capture()
	let free = s.free
	if (free)
		free(s, id)
	state_map.delete(id)
}

function state_gc() {
	for (let id of remove_id_set) {
		let s = state_map.get(id)
		if (s)
			free_state(id, s)
	}
	remove_id_set.clear()
	let empty = remove_id_set
	remove_id_set = current_id_set
	current_id_set = empty
}

ui.on_free = function(id, free1) {
	let s = ui.state(id)
	let free0 = s.free
	if (!free0) {
		s.free = free1
	} else {
		s.free = function(s, id) {
			free0(s, id)
			free1(s, id)
		}
	}
}

// widget builder for widgets that are made from a closure that creates both
// the build function and the update function which allows them to coordinate
// via shared upvalues instead of via state(id) like usual. not important for
// small widgets but for big widgets like the grid it's much nicer to keep the
// state internal with faster access and declared and initialized in one place.
ui.stateful_widget = function(create) {
	return function() { // id, ...build_args
		let id = arguments[0]
		assert(isstr(id), 'id required')
		let e
		let s = ui.state_of(id)
		if (!s) {
			e = create.apply(null, arguments)
			s = ui.state(id, e.update)
			s.e = e
		} else {
			e = s.e
		}
		e.build.apply(e, arguments)
	}
}

//// TUI STYLE ---------------------------------------------------------------

ui.TUI = false

ui.set_tui = function(on) {
	if (ui.TUI == on)
		return
	ui.TUI = on
	reset_tui()
	ui.rebuild('TUI')
}

function ceil_center(x, w) {
	return ((x + w * .5) / w) * w - (w * .5)
}
function tui_padding_x(px) { return px ? ceil_center(px, tui_cell_w) : px }
function tui_padding_y(py) { return py ? ceil_center(py, tui_cell_h) : py }

function tui_snap_paddings() {
	if (!ui.TUI) return
	px1 = tui_padding_x(px1)
	px2 = tui_padding_x(px2)
	py1 = tui_padding_y(py1)
	py2 = tui_padding_y(py2)
	mx1 = tui_padding_x(mx1)
	mx2 = tui_padding_x(mx2)
	my1 = tui_padding_y(my1)
	my2 = tui_padding_y(my2)
}

//// FRAME BUILDING ----------------------------------------------------------

ui.TUI = false
let tui_cell_w
let tui_cell_h
function reset_tui() {
	if (!ui.TUI) return
	cx.font = font_size_normal + 'px monospace'
	let m = measure_text(cx, '0')
	let asc = m.actualBoundingBoxAscent
	let dsc = m.actualBoundingBoxDescent
	tui_cell_w = m.width
	tui_cell_h = asc + dsc
}

function reset_canvas() {
	assert(dpr)
	default_font = ui.TUI ? 'monospace' : ui.default_font
	reset_tui()
	default_font_str = 'normal ' + font_size_normal + 'px ' + default_font
	last_font_str = default_font_str
	cx.font = default_font_str
	reset_shadow()
}

/// container stack ----------------------------------------------------------

// used in both build phase and measuring phases.

let ct_stack = [] // [ct_i1,...]
ui.ct_stack = ct_stack

ui.ct_i = () => assert(ct_stack.at(-1), 'no container')
ui.rel_ct_i = () => ui.ct_i() - (n+2)
ui.last_i = () => cmd_last_i()

function ct_stack_check() {
	if (ct_stack.length) {
		for (let i of ct_stack)
			debug(C(a, i), 'not closed')
		assert(false)
	}
}

/// command recordings -------------------------------------------------------

/*

	ui.start_recording ()
	ui.end_recording   () -> a1
	ui.play_recording  (a1)

*/

let rec_freelist = array_freelist()

function rec() {
	let a = rec_freelist.alloc()
	return a
}

function free_rec(a) {
	if (a.nohit_set)
		a.nohit_set.clear()
	rec_freelist.free(a)
}

let rec_stack = []

// NOTE: ui.ct_i() and ui.rel_ct_i() are only valid if the container is
// inside the same rec, so open a container first in a recording!
ui.start_recording = function() {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let a1 = rec()
	rec_stack.push(a, n, ct_stack.length)
	a = a1
	n = 0
}

ui.end_recording = function() {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let ct_stack_len = rec_stack.pop()
	a.length = n
	let a1 = a
	n = rec_stack.pop()
	a = rec_stack.pop()
	assert(ct_stack.length == ct_stack_len,
		'recording must open and close its own containers')
	return a1
}

ui.play_recording = function(a1) {
	for (let j = 0; j < a1.length; j++)
		a[n++] = a1[j]
	free_rec(a1)
}

function rec_stack_check() {
	assert(!rec_stack.length, 'recordings left unplayed')
}

/// secondary command recordings ---------------------------------------------

// only used internally by redraw_all and ui.frame callbacks.

let recs = []
let rec_i

function begin_rec() {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let a0 = a
	a = rec()
	n = 0
	rec_i = recs.length
	recs.push(a)
	return a0
}

function end_rec(a0) {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	a.length = n
	let a1 = a
	a = a0
	n = a0?.length
	return a1
}

function free_recs() {
	for (let k = recs.length-1; k >= 0; k--)
		free_rec(recs[k])
	recs.length = 0
}

/// current command recording ------------------------------------------------

// Format of a command recording array:
//
//  next_i, cmd, arg1..n, prev_i; next_i, cmd, arg1..n, prev_i; ...
//    |            ^        |                    ^
//    |            +--------+                    |
//    +------------------------------------------+
//
// With next_i and prev_i we can walk back and forth between commands,
// always landing at the command's arg#1. From the arg#1 index then we have
// the command code at a[i-1], next command's arg#1 at i+a[i-2] and prev
// command's arg#1 at i+a[i-3]. To walk the command array as a tree, we check
// when a container starts with `a[i-1] & 1` (all containers have even codes)
// and when it ends with `a[i-1] == CMD_END` (all containers end with the same
// "end" command). To skip all container's children and jump to the next
// sibling we use cmd_next_sibling_i(). To go back to the container's command
// from its "end" command, we use i+a[i].
// NOTE: Using relative indexes everywhere allows creating command recordings
// that are relocatable, i.e. can be moved into other recordings without
// having to reoffset the indexes.

let a // current recording
let n = 0 // current recording's length

let cmd_names = [] // [[CMD]=NAME]: command's name
let cmd_name_map = obj()
let id_slot = [] // [[CMD]=ID]: command's ID arg index, if any

function C(a, i) { return cmd_names[a[i-1]] }

let max_cmd    =  0 // even numbers for non-containers (0 is reserved).
let max_cmd_ct = -1 // odd numbers containers
function unsparse(a, i) {
	while (a.length <= i)
		a.push(null)
}
function unsparse_all(i) {
	unsparse(measure       , i)
	unsparse(measure_end   , i)
	unsparse(position      , i)
	unsparse(translate     , i)
	unsparse(register      , i)
	unsparse(draw          , i)
	unsparse(draw_end      , i)
	unsparse(hittest       , i)
	unsparse(is_flex_child , i)
	unsparse(cmd_names     , i)
	unsparse(id_slot       , i)
}
function cmd(name, is_ct) {
	assert(cmd_name_map[name] == null, 'duplicate command ', name)
	let cmd
	if (is_ct) {
		max_cmd_ct += 2
		cmd = max_cmd_ct
	} else {
		max_cmd += 2
		cmd = max_cmd
	}
	unsparse_all(cmd)
	cmd_names[cmd] = name
	cmd_name_map[name] = cmd
	return cmd
}
function cmd_ct(name) {
	return cmd(name, true)
}

let cmd_next_i = (a, i) => i+a[i-2] // index of next cmd
let cmd_prev_i = (a, i) => i+a[i-3] // index of prev cmd
let cmd_last_i = () => cmd_prev_i(a, n+2) // index of last command in a
let cmd_arg_end_i = (a, i) => cmd_next_i(a, i)-3 // index after the last arg

function ui_cmd_begin(cmd) {
	a[n++] = 0 // next_i, filled in by ui_cmd_end()
	a[n++] = cmd
	return n // cmd_i: abs index of this cmd's arg#1
}

function ui_cmd_end(i) {
	let next_i = n+3 - i
	a[i-2] = next_i
	a[n++] = -next_i
}

function ui_cmd_add_arg(v) {
	a[n++] = v
}

function ui_cmd(cmd, ...args) {
	let i = n+2 // abs index of this cmd's arg#1
	let next_i = args.length+3 // rel index of next cmd's arg#1
	let prev_i = -next_i // rel index of this cmd's arg#1, rel to next cmd's arg#1
	a[n++] = next_i
	a[n++] = cmd
	for (let j = 0; j < args.length; j++)
		a[n++] = args[j]
	a[n++] = prev_i
	return i
}

ui.cmd_begin = ui_cmd_begin
ui.cmd_end = ui_cmd_end
ui.cmd_add_arg = ui_cmd_add_arg
ui.cmd = ui_cmd

// print current recording
ui.disas = function(a) {
	let i = 2
	while (i < a.length) {
		let cmd_num = a[i-1]
		let cmd = cmd_names[cmd_num]
		let i1 = cmd_arg_end_i(a, i)
		let args = a.slice(i, i1)
		if (cmd == 'end')
			console.groupEnd()
		if (cmd_num & 1)
			console.group(cmd, ...args)
		else
			console.log(cmd, ...args)
		i = cmd_next_i(a, i)
	}
}

//// LAYERS ------------------------------------------------------------------

let layer_map = {} // {name->layer}

//	ui.layer(name, [z_index], ['root modal'])
//
//   root flag  : popups on this layer are in the root stacking context.
//   modal flag : popups on this layer create their own stacking context.
//   no flags   : popups on this layer don't create a stacking context.
//
ui.layer = function(name, z_index, flags) {
	assert(!layer_map[name])
	let layer = obj()
	layer.name = assert(name)
	layer_map[name] = layer
	layer.z_index = z_index ?? 0 // z_index amongst layers, i.e. z_index band
	layer.root  = !!flags?.includes('root')
	layer.modal = !!flags?.includes('modal')
	return layer
}

let z_index_band = 0x10000 // 64k popups per layer

let POPUPS_SLOTS   = 4
let POPUPS_Z_INDEX = 0
let POPUPS_REC_I   = 1
let POPUPS_CT_I    = 2
let POPUPS_INNER   = 3

let popups_freelist = array_freelist()

let root_popups = []
let current_popups = root_popups

function free_inner_popups(popups) {
	for (let k = POPUPS_INNER, n = popups.length; k < n; k += POPUPS_SLOTS) {
		let inner_popups = popups[k]
		if (inner_popups) {
			free_inner_popups(inner_popups)
			inner_popups.length = 0
			popups_freelist.free(inner_popups)
		}
	}
}

function reset_popups() {
	free_inner_popups(root_popups)
	root_popups.length = 0
	current_popups = root_popups
}

function add_popup(popups, z_index, rec_i, ct_i, inner_popups) {
	let k = popups.length
	while (k) {
		let j = k - POPUPS_SLOTS
		if (popups[j+POPUPS_Z_INDEX] <= z_index) // <= preserves insert order
			break
		k = j
	}
	if (k == popups.length)
		popups.push(z_index, rec_i, ct_i, inner_popups)
	else
		popups.splice(k, 0, z_index, rec_i, ct_i, inner_popups)
}

// current draw/hit popup, so we can skip draw/hit of nested popups.
let current_popup_rec
let current_popup_ct_i

/// built-in layers ----------------------------------------------------------

const layer_base =
ui.layer('base'    , 0)
ui.layer('overlay' , 1) // focus rings, drag points: must cover siblings.
ui.layer('error'   , 2) // persistent tooltips: not hover (tooltips are hover).
ui.layer('toolbox' , 3, 'modal') // toolboxes
ui.layer('open'    , 4, 'modal') // dropdowns, menus: must cover all non-modals.
ui.layer('modal'   , 5, 'modal') // modals: must cover all other modals.
ui.layer('tooltip' , 6, 'root') // tooltips: must cover all static.
ui.layer('drag'    , 7, 'root') // dragged object: must cover everything.

//// RENDERING PHASES --------------------------------------------------------

let measure       = []
let measure_end   = []
let position      = []
let translate     = []
let register      = []
let draw          = []
let draw_end      = []
let hittest       = []
let is_flex_child = []

/// measuring phase (per-axis) -----------------------------------------------

// walk the element tree bottom-up and call the measure function for each
// element that has it. uses ct_stack for recursion and containers'
// measure_end callback to do the work.

function measure_rec(a, axis) {
	for (let i = 2, n = a.length; i < n; i = cmd_next_i(a, i)) {
		let cmd = a[i-1]
		let measure_f = measure[cmd]
		if (!measure_f)
			continue
		measure_f(a, i, axis)
	}
}

/// positioning phase (per-axis) ---------------------------------------------

// walk the element tree top-down, and call the position function for each
// element that has it. recursive, uses call stack to pass ct_i and ct_w.

function position_rec(a, axis, ct_wh) {
	for (let i = 2, n = a.length; i < n; i = cmd_next_sibling_i(a, i)) {
		let cmd = a[i-1]
		let position_f = position[cmd]
		if (!position_f)
			continue
		let min_wh = a[i+2+axis]
		position_f(a, i, axis, 0, max(min_wh, ct_wh))
	}
}

/// translation phase --------------------------------------------------------

// do scrolling and popup positioning and offset all boxes (top-down, recursive).

// NOTE: translate is not re-runnable by design, which enables:
// - running on_build callbacks which can read one-shot state like click, etc.
// - updating offsets by delta (popups do that),
// ... but it also means you can't re-translate something if you need to,
// so you can't implement a simple force_scroll() that would work inside the
// translate phase to re-scroll a scrollbox to sync it with a later one.

function translate_rec(a, x, y) {
	for (let i = 2, n = a.length; i < n; i = cmd_next_sibling_i(a, i)) {
		let cmd = a[i-1]
		let translate_f = translate[cmd]
		if (!translate_f)
			continue
		translate_f(a, i, x, y)
	}
}

/// registration phase -------------------------------------------------------

// walk the element tree in build order and call the register function for
// each element that has it (linear scan).

function register_rec(a, rec_i) {
	for (let i = 2, n = a.length; i < n; i = cmd_next_i(a, i)) {
		let cmd = a[i-1]
		let register_f = register[cmd]
		if (!register_f)
			continue
		register_f(a, i, rec_i)
	}
}

/// drawing phase ------------------------------------------------------------

/*

Drawing phase is the only phase that can run on a remote machine on a received
and deserialized frame object, so ui.state(), ui.hit() state, ui.captured_id,
etc. don't work here. Drawing can keep local inter-frame state with
ui.render_state().

	ui.render_state    (id) -> state      get render-local widget state
	ui.local_state     (id[, k]) -> state | v | nil

	ui.cx       the canvas 2D context to draw with

*/

function create_render_state_map() {
	let sm = map()
	sm.current_id_set = set()
	sm.remove_id_set = set()
	return sm
}

function render_state_gc(sm) {
	for (let id of sm.remove_id_set) {
		let s = sm.get(id)
		if (s?.free)
			s.free(s, id)
		sm.delete(id)
	}
	sm.remove_id_set.clear()
	let empty = sm.remove_id_set
	sm.remove_id_set = sm.current_id_set
	sm.current_id_set = empty
}

let root_render_state_map = create_render_state_map()
let render_state_map

ui.render_state = function(id, k) {
	assert(render_state_map, 'render_state() called outside rendering')
	render_state_map.current_id_set.add(id)
	render_state_map.remove_id_set.delete(id)
	let s = render_state_map.get(id)
	if (!s) {
		s = obj()
		render_state_map.set(id, s)
	}
	return k ? s[k] : s
}

// normally we don't allow ui.state() in the drawing phase because it's not
// available remotely. this is an exception API for widgets that need access
// to a native object (eg. Image) when drawing locally to avoid recreating it.
ui.local_state = function(id, k) {
	assert(render_state_map, 'local_state() called outside rendering')
	if (render_state_map != root_render_state_map)
		return
	let s = state_map.get(id)
	return k ? s?.[k] : s
}

let theme_stack = []

function draw_cmd(a, i, recs) {
	let prev_ts_len = theme_stack.length
	let next_sib_i = cmd_next_sibling_i(a, i)
	while (i < next_sib_i) {

		let cmd = a[i-1]
		if (cmd & 1) // container
			theme_stack.push(theme)
		else if (cmd == CMD_END)
			theme = theme_stack.pop()

		let draw_f = draw[cmd]
		if (draw_f && draw_f(a, i, recs)) {
			i = cmd_next_sibling_i(a, i)
			if (cmd & 1) // container
				theme = theme_stack.pop()
		} else {
			i += a[i-2] // next_i
		}
	}
	assert(theme_stack.length == prev_ts_len)
}

function draw_popups(popups, recs) {
	let prev_rec  = current_popup_rec
	let prev_ct_i = current_popup_ct_i
	for (let k = 0, n = popups.length; k < n; k += POPUPS_SLOTS) {
		reset_canvas()
		let rec_i = popups[k+POPUPS_REC_I]
		let i     = popups[k+POPUPS_CT_I]
		let a = recs[rec_i]
		/*global*/ current_popup_rec  = a
		/*global*/ current_popup_ct_i = i
		draw_cmd(a, i, recs)
		let inner_popups = popups[k+POPUPS_INNER]
		if (inner_popups)
			draw_popups(inner_popups, recs)
	}
	current_popup_rec  = prev_rec
	current_popup_ct_i = prev_ct_i
}

function draw_frame(recs, popups, sm1) {
	let sm0 = render_state_map
	render_state_map = assert(sm1)
	let current_popup_rec0  = current_popup_rec
	let current_popup_ct_i0 = current_popup_ct_i

	draw_popups(popups, recs)
	assert(current_popup_rec  == current_popup_rec0)
	assert(current_popup_ct_i == current_popup_ct_i0)

	render_state_gc(render_state_map)
	render_state_map = sm0
}

/// hit-testing phase --------------------------------------------------------

let hit_id // innermost hit widget

let hit_state_map      = map() // {id->state}
let prev_hit_state_map = map() // {id->state}

function hovers(id, k) {
	if (!id) return
	let s = hit_state_map.get(id)
	return k ? s?.[k] : s
}
ui.hovers = hovers

function hit(id, k) { // looks in prev. frame
	assert(!render_state_map, 'hit() called while rendering')
	if (ui.captured_id != null) {
		if (ui.captured_id != id) // another widget captured the mouse
			return
	} else if (hit_id !== id) // an inner widget took the hit
		return
	return hovers(id, k)
}
ui.hit = hit

function clicked(id) {
	return ui.click && hit(id)
}
ui.clicked = clicked

function dblclicked(id) {
	return ui.dblclick && hit(id)
}
ui.dblclicked = dblclicked

ui.hit_enter = function(id) {
	assert(!render_state_map, 'hit_enter() called while rendering')
	if (ui.captured_id != null)
		return false
	return hit_state_map.has(id) && !prev_hit_state_map.has(id)
}

ui.hit_leave = function(id) {
	assert(!render_state_map, 'hit_leave() called while rendering')
	if (ui.captured_id != null)
		return false
	return !hit_state_map.has(id) && prev_hit_state_map.has(id)
}

function hit_match(prefix) {
	if (hit_id && hit_id.startsWith(prefix))
		return hit_id.substring(prefix.length)
}
ui.hit_match = hit_match

let hit_phase

function set_hit(id) {
	assert(hit_phase, 'set_hit() outside the hit phase')
	// ^^ because set_hit() must be called in reverse paint order so that
	// hit_state_map contains entries ordered from inner to outer.
	if (!id) return
	let s = hit_state_map.get(id)
	if (!s) {
		s = obj()
		hit_state_map.set(id, s)
		hit_id ??= id
	}
	return s
}
ui.set_hit = set_hit

function hit_popups(popups, recs) {
	// iterate popups in reverse order.
	for (let k = popups.length-POPUPS_SLOTS; k >= 0; k -= POPUPS_SLOTS) {
		let inner_popups = popups[k+POPUPS_INNER]
		if (inner_popups && hit_popups(inner_popups, recs))
			return true
		reset_canvas()
		let rec_i = popups[k+POPUPS_REC_I]
		let i     = popups[k+POPUPS_CT_I]
		let a = recs[rec_i]
		/*global*/ current_popup_rec  = a
		/*global*/ current_popup_ct_i = i
		let hit_f = hittest[a[i-1]]
		if (hit_f && !a.nohit_set?.has(i) && hit_f(a, i, recs))
			return true
	}
}

function hit_frame(recs, popups) {

	hit_frame_template_reset()

	// reset hit state. set by set_hit() calls from hit callbacks.
	hit_state_map.clear()
	hit_id = null

	if (ui.mx == null)
		return

	hit_phase = true
	hit_popups(popups, recs)
	hit_phase = false

}

//// FOCUSING ----------------------------------------------------------------

/*

	ui.focused_id      = id                    id of focused widget
	ui.focus           (id)                    focus widget
	ui.focused         (id) -> t|f             check if widget is currently focused
	ui.focusing        (id) -> t|f             widget is focusing this frame
	ui.focusable       (id, [tab_order])       add widget to the tab order
	ui.nofocus         ()                      declare the next widget not tab-focusable
	ui.keep_focus      (id)                    declare widget not click-focusable
	ui.capture_tab     (id)                    widget gets tab and shift-tab
	ui.focus_group     ([trap], [tab_order], [id]) begin a tab order group
	ui.end_focus_group ()                      end a tab order group
	ui.default_button  (id)                    enter in the group's inputs hits it
	ui.focus_inside    (group_id) -> t|f       focus is inside this focus group
	ui.focus_first     (group_id)              focus first widget unless focus is inside
	ui.tab_into        (id)                    next tab enters this focus group
	ui.window_focused -> t|f                   browser window has focus

*/

ui.focused_id = null
ui.focused_by_key = false
let focusing_id

ui.focus = function(id, by_key) {
	if (ui.focused_id == id)
		return
	ui.focused_id = id
	ui.focused_by_key = by_key
	focusing_id = id
	tab_into_id = null
}

ui.focused = function(id) {
	return id && ui.focused_id == id
}

ui.focusing = function(id) {
	return id && focusing_id == id
}

ui.window_focused = () => document.hasFocus()

window.addEventListener('blur', function(ev) {
	ui.local_pointer.key_state.clear()
	key_downs.clear()
	key_ups.clear()
	ui.key_events.length = 0
	// NOTE: won't always fire an animation frame when tabbing out!
	animate()
})

window.addEventListener('focus', function(ev) {
	ui.window_focusing = true
	animate()
})

let FOCUSABLE_SLOTS          = 6
let FOCUSABLE_ID             = 0
let FOCUSABLE_TAB_ORDER      = 1
let FOCUSABLE_END            = 2 // groups only
let FOCUSABLE_TRAP           = 3 // groups only
let FOCUSABLE_DEFAULT_BUTTON = 4 // groups only: default button id
let FOCUSABLE_CANCEL_BUTTON  = 5

let focusables = [] // FOCUSABLE_SLOTS per entry, in tab order
ui.focusables = focusables

let open_focus_groups = [] // group_i stack, while registering
let focus_group_map = map() // {focus_group_id->group_i}
let FOCUSABLE       = cmd('focusable')
let FOCUS_GROUP     = cmd('focus_group')
let END_FOCUS_GROUP = cmd('end_focus_group')

let nofocus // skip the next focusable()

ui.nofocus = function() {
	nofocus = true
}

ui.focusable = function(id, tab_order) {
	if (nofocus) {
		nofocus = false
		return
	}
	let i = ui_cmd_begin(FOCUSABLE)
	a[n++] = id
	a[n++] = tab_order ?? 0
	ui_cmd_end(i)
	// calling scroll_to_view_next_box() here means that focusable() must be
	// called before the widget box is recorded.
	if (ui.focusing(id))
		ui.scroll_to_view_next_box()
}

ui.focus_group = function(trap, tab_order, id) {
	let i = ui_cmd_begin(FOCUS_GROUP)
	a[n++] = tab_order ?? 0
	a[n++] = trap ? 1 : 0
	a[n++] = id
	ui_cmd_end(i)
}

ui.end_focus_group = function() {
	ui_cmd_end(ui_cmd_begin(END_FOCUS_GROUP))
}

// must happen on register phase because that's when secondary recordings
// are already in the layout in the right order.
register[FOCUSABLE] = function(a, i) {
	focusables.push(a[i], a[i+1], 0, 0, null, null)
}

register[FOCUS_GROUP] = function(a, i) {
	let group_i = focusables.length // where the group starts
	open_focus_groups.push(group_i)
	let id = a[i+2]
	if (id != null)
		focus_group_map.set(id, group_i)
	focusables.push(null, a[i], 0, a[i+1], null, null)
}

register[END_FOCUS_GROUP] = function() {
	let group_i = open_focus_groups.pop()
	focusables[group_i+FOCUSABLE_END] = focusables.length
}

let is_focus_group = i => focusables[i+FOCUSABLE_ID] == null

function focus_group_start(group_i) {
	return group_i == null ? 0 : group_i + FOCUSABLE_SLOTS
}

function focus_group_end(group_i) {
	return group_i == null ? focusables.length
		: focusables[group_i+FOCUSABLE_END]
}

function next_focus_sibling_i(i) {
	return is_focus_group(i) ? focusables[i+FOCUSABLE_END] : i + FOCUSABLE_SLOTS
}

function focus_group_of(i) {
	let group_i = null
	for (let j = 0; j < i; j += FOCUSABLE_SLOTS)
		if (is_focus_group(j) && focusables[j+FOCUSABLE_END] > i)
			group_i = j
	return group_i
}

function focus_find(id) {
	if (id == null)
		return null
	for (let i = 0; i < focusables.length; i += FOCUSABLE_SLOTS)
		if (focusables[i+FOCUSABLE_ID] == id)
			return i
	return null
}

ui.focus_inside = function(group_id) { // looks in prev. frame
	let group_i = focus_group_map.get(group_id)
	if (group_i == null) return
	let i = focus_find(ui.focused_id)
	if (i == null) return
	return i > group_i && i < focusables[group_i+FOCUSABLE_END]
}

function pick_focus_sibling(group_i, tab_order0, i0, back) {
	let best_i = null
	let best_tab_order
	let end_i = focus_group_end(group_i)
	for (let i = focus_group_start(group_i); i < end_i;
			i = next_focus_sibling_i(i)) {
		let tab_order = focusables[i+FOCUSABLE_TAB_ORDER]
		if (i0 != null && !(back
				? tab_order < tab_order0
					|| (tab_order == tab_order0 && i < i0)
				: tab_order > tab_order0
					|| (tab_order == tab_order0 && i > i0)))
			continue
		if (best_i == null || (back
				? tab_order > best_tab_order
					|| (tab_order == best_tab_order && i > best_i)
				: tab_order < best_tab_order
					|| (tab_order == best_tab_order && i < best_i))) {
			best_i = i
			best_tab_order = tab_order
		}
	}
	return best_i
}

function first_focusable_in(group_i, back) {
	let i = pick_focus_sibling(group_i, 0, null, back)
	if (i == null)
		return null
	if (!is_focus_group(i))
		return i
	let inner_i = first_focusable_in(i, back)
	if (inner_i != null)
		return inner_i
	return next_focusable_after(group_i, i, back)
}

function next_focusable_after(group_i, i0, back) {
	while (1) {
		let i = pick_focus_sibling(group_i,
			focusables[i0+FOCUSABLE_TAB_ORDER], i0, back)
		if (i == null)
			return null
		if (!is_focus_group(i))
			return i
		let inner_i = first_focusable_in(i, back)
		if (inner_i != null)
			return inner_i
		i0 = i
	}
}

let focus_first_id // focus group to focus, resolved after register_rec

// tab order is not fully known during build, so this is recording a request
// to be solved at the end of the build.
ui.focus_first = function(group_id) {
	if (ui.focus_inside(group_id))
		return
	focus_first_id = group_id
}

function resolve_focus_first(group_id) {
	let group_i = focus_group_map.get(group_id)
	if (group_i == null)
		return false
	let i = first_focusable_in(group_i)
	if (i == null)
		return false
	ui.focus(focusables[i+FOCUSABLE_ID])
	return true
}

/// tab-to-focus -------------------------------------------------------------

function step_focus(back) {
	if (tab_into_id != null) {
		let group_i = focus_group_map.get(tab_into_id)
		tab_into_id = null
		// null when the group was not recorded this frame: fall through to
		// stepping from the focused widget.
		if (group_i != null) {
			let i = first_focusable_in(group_i, back)
			if (i != null)
				return i
		}
	}
	let i0 = focus_find(ui.focused_id)
	if (i0 == null)
		return first_focusable_in(null, back)
	let group_i = focus_group_of(i0)
	while (1) {
		let i = next_focusable_after(group_i, i0, back)
		if (i != null)
			return i
		if (group_i == null || focusables[group_i+FOCUSABLE_TRAP])
			return first_focusable_in(group_i, back)
		i0 = group_i
		group_i = focus_group_of(i0)
	}
}

function focus_on_tab() {
	if (ui.keydown('tab') && !tab_captured(ui.focused_id)) {
		let i = step_focus(ui.keypressed('shift'))
		if (i != null) {
			ui.focus(focusables[i+FOCUSABLE_ID], true)
			consume_key_down('tab')
		}
	}
}

/// click-to-focus -----------------------------------------------------------

// mark widget as not click-focusable so clicking on it does not steal focus.
ui.keep_focus = function(id) {
	ui.state(id).keep_focus = true
}

function focus_on_click() {
	if (!ui.click) return
	for (let id of hit_state_map.keys()) { // reverse paint order
		// prevent focus stealing or clearing (scrollbar, etc.)
		if (state_map.get(id)?.keep_focus)
			return
		if (focus_find(id) != null) { // click-to-focus
			ui.focus(id)
			return
		}
	}
	// clicked outside a focusable, clear focus.
	ui.focus(null)
}

/// default buttons ----------------------------------------------------------

let GROUP_BUTTON = cmd('group_button')

ui.default_button = function(id) {
	let i = ui_cmd_begin(GROUP_BUTTON)
	a[n++] = id
	a[n++] = FOCUSABLE_DEFAULT_BUTTON
	ui_cmd_end(i)
}

ui.cancel_button = function(id) {
	let i = ui_cmd_begin(GROUP_BUTTON)
	a[n++] = id
	a[n++] = FOCUSABLE_CANCEL_BUTTON
	ui_cmd_end(i)
}

register[GROUP_BUTTON] = function(a, i) {
	let group_i = open_focus_groups.at(-1)
	assert(group_i != null,
		'default_button/cancel_button outside a focus group')
	let button_slot = a[i+1]
	focusables[group_i+button_slot] = a[i]
}

// focus group's default button or cancel button that was "clicked" by
// pressing Enter or Escape key inside an input in the group.
let clicked_button_id

function click_default_button() {
	let i = focus_find(ui.focused_id)
	if (i == null)
		return
	let group_i = focus_group_of(i)
	if (group_i == null)
		return
	let id = ui.keydown('enter')
		? focusables[group_i+FOCUSABLE_DEFAULT_BUTTON] : null
	if (id == null && ui.keydown('escape'))
		id = focusables[group_i+FOCUSABLE_CANCEL_BUTTON]
	if (id == null)
		return
	clicked_button_id = id
	ui.capture_keys()
}

/// tab capture --------------------------------------------------------------

ui.capture_tab = function(id) {
	ui.state(id).capture_tab = true
}

function tab_captured(id) {
	return !!state_map.get(id)?.capture_tab
}

let tab_into_id // focus group that the next tab must move into

ui.tab_into = function(id) {
	tab_into_id = id
}

/// nohit command ------------------------------------------------------------

let NOHIT = cmd('nohit')
ui.nohit = function(ct_i) {
	ct_i ??= ui.ct_i()
	let i = ui_cmd_begin(NOHIT)
	a[n++] = ct_i - i // make it relative
	ui_cmd_end(i)
}

// doesn't have to happen on translate, any phase will do.
translate[NOHIT] = function(a, i) {
	let ct_i = i+a[i]
	if (!a.nohit_set)
		a.nohit_set = set()
	a.nohit_set.add(ct_i)
}

//// ANIMATION FRAME LOOP ----------------------------------------------------

/*

	ui.animate ()         request another animation frame
	ui.rebuild ([label])  request another build/layout pass in this frame

*/

// frame build counter, used for:
// 1) preventing state updates from running twice in the same build pass.
// 2) expiring text measure cache entries.
let build_no = 0

let want_rebuild
let rebuild_for = [] // [label1,...]

// NOTE: call this only on a condition that is guaranteed false on a second
// build i.e. the caller must resolve whatever triggered the call so it cannot
// fire again. a label does not help with this: a repeat call with the same
// label turns into a silent no-op, it doesn't triggers another pass!
ui.rebuild = function(label) {
	if (label) {
		if (rebuild_for.includes(label))
			return
		rebuild_for.push(label)
	}
	want_rebuild = true
}

function layout_rec(a, x, y, w, h) {
	reset_canvas()

	// x-axis
	measure_rec(a, 0)
	ct_stack_check()
	position_rec(a, 0, w)

	// y-axis
	measure_rec(a, 1)
	ct_stack_check()
	position_rec(a, 1, h)

	// reset scroll-to-view request if no scrollbox consumed it.
	scroll_to_view_i = null

	translate_rec(a, x, y)
}

function frame_end_check() {
	ct_stack_check()
	rec_stack_check()
	split_stack_check()
	toolbox_stack_check()
	text_flags_check()
}

ui.frame_changed = noop

function draw_pointer(p, x0, y0) {
	if (p.mx == null)
		return
	cx.beginPath()
	cx.fillStyle = 'red'
	cx.fillRect(x0 + p.mx, y0 + p.my, 5, 5)
}

function redraw_all() {

	// hit_enter() and hit_leave() compare against the last frame that was drawn,
	// so hit_state_map moves to prev_hit_state_map once per frame, outside the
	// rebuild loop below.
	let sm = prev_hit_state_map
	prev_hit_state_map = hit_state_map
	hit_state_map = sm

	rebuild_for.length = 0
	ui._frame_drawn = false
	let rebuild_count = 0
	while (1) {
		let t0, t1

		want_rebuild = false

		t0 = clock_ms()

		// can be changed in hit phase or in build phase.
		// applied once at the end of the frame.
		ui.set_cursor()

		hit_frame(recs, root_popups)

		// auto capture pointer on click
		if (ui.click && ui.captured_id == null && hit_id != null)
			capture(hit_id)

		focus_on_click()
		focus_on_tab()
		click_default_button()

		let prev_focused_id = ui.focused_id

		t1 = clock_ms()
		frame_graph_push('frame_hit_time', t1 - t0)

		reset_popups()
		free_recs()

		t0 = clock_ms()
		frame_make_ms = 0

		reset_canvas()

		begin_rec()
		let i = ui.stack()
		assert(rec_i == 0)
		add_popup(root_popups, layer_base.z_index * z_index_band, rec_i, i, null)
		ui.main()
		reset_spacings()
		ui.end()
		frame_end_check()

		t1 = clock_ms()
		let make_ms = t1 - t0

		t0 = t1

		let a = end_rec()
		layout_rec(a, 0, 0, screen_w, screen_h)

		if (ui.DEBUG) {
			ui.recs_length = 0
			for (let k = 0; k < recs.length; k++)
				ui.recs_length += recs[k].length
		}

		// prev frame's focusables have to be available in layout_rec for
		// focus_inside() to work, and have to be cleared before register_rec
		// which fills it back with this frame's values.
		focusables.length = 0
		focus_group_map.clear()

		register_rec(a, 0)

		assert(!open_focus_groups.length, 'unbalanced focus_group')

		// clear invalid focus id
		if (ui.focused_id && focus_find(ui.focused_id) == null)
			ui.focus(null)

		// focus first
		if (focus_first_id != null) {
			let group_id = focus_first_id
			focus_first_id = null
			if (!resolve_focus_first(group_id))
				warn('focus_first: no focusable in ', group_id)
		}

		if (ui.focused_id != prev_focused_id) // focus changed in build phase
			ui.rebuild('focus')

		t1 = clock_ms()
		frame_graph_push('frame_make_time', make_ms + frame_make_ms)
		frame_graph_push('frame_layout_time', t1 - t0 - frame_make_ms)

		state_gc()

		if (!want_rebuild) {
			t0 = clock_ms()

			cx.clearRect(0, 0, canvas.width, canvas.height)

			drawn_focused_input = null
			drawn_focused_by_key = false

			theme = themes[ui.default_theme]
			draw_frame(recs, root_popups, root_render_state_map)
			theme = null

			sync_dom_focus()
			sync_dom_selection()

			for (let p of ui.pointers)
				if (p != ui.local_pointer)
					draw_pointer(p, 0, 0)

			t1 = clock_ms()
			frame_graph_push('frame_draw_time', t1 - t0)

			ui._frame_drawn = true
			ui.frame_changed()
		}

		reset_canvas()

		// auto release pointer capture on clickup
		if (ui.clickup && ui.captured_id != null)
			release_capture()

		for (let p of ui.pointers)
			reset_pointer_state(p)
		reset_pointer_state(ui)

		key_downs.clear()
		key_ups.clear()
		ui.key_events.length = 0
		clicked_button_id = null

		ui.window_focusing = false

		// updates can run again now that they can't see the same edge state.
		build_no++

		if (!want_rebuild)
			break
		rebuild_count++
		pr('rebuild')
		if (rebuild_count > 1) {
			warn('rebuild loop detected')
			break
		}
	}

	apply_cursor()

	// focusing_id resets once per frame, after the rebuild loop, not once per
	// build pass: resolve_focus_first() runs after register, so the widget's
	// ui.focusable() call for this pass already ran before focus changed. only
	// the next pass's build calls ui.focusable() again and reveals the widget.
	focusing_id = null
}

let raf_id
let raf_t0
function raf_animate(raf_t) {
	raf_id = null
	let raf_dt = raf_t0 != null ? raf_t - raf_t0 : 0
	raf_dt = raf_dt < 32 ? raf_dt : 20
	frame_graph_push('frame_delta_time', raf_dt)
	raf_t0 = raf_t
	let t0 = clock_ms()
	redraw_all()
	let t1 = clock_ms()
	frame_graph_push('frame_time', t1 - t0)
}
let ready
function animate() {
	if (raf_id) return
	if (!ready) return
	raf_id = requestAnimationFrame(raf_animate)
}
ui.animate = animate

//// WIDGETS -----------------------------------------------------------------

/*

	ui.widget(name, {
		measure       : f(a, i, axis)    measure widget on axis (0 for x, 1 for y)
		measure_end   : f(a, i, axis)    measure widget on axis at widget's end() call
		position      : f(a, i, axis, x, w, ct_i)   position widget on axis
		translate     : f(a, i, x, y)     translate widget
		draw          : f(a, i, recs)     draw widget
		draw_end      : f(a, i)           draw widget at widget's end() call
		hit           : f(a, i, recs)     hit-test widget
		is_flex_child : t|f               has fr at a[i+FR] and min_w/h at a[i+2+axis]
										          so it can be a child of a flex container.
	}, is_ct) -> create

	ui.measure(into_id)   measure container and put x,y,w,h in state of into_id.

*/

ui.widget = function(cmd_name, t, is_ct) {
	let _cmd = cmd(cmd_name, is_ct)
	measure       [_cmd] = t.measure
	measure_end   [_cmd] = t.measure_end
	position      [_cmd] = t.position
	translate     [_cmd] = t.translate
	register      [_cmd] = t.register
	draw          [_cmd] = t.draw
	draw_end      [_cmd] = t.draw_end
	hittest       [_cmd] = t.hit
	is_flex_child [_cmd] = t.is_flex_child
	id_slot       [_cmd] = t.ID
	let create = t.create
	if (create) {
		// bind() to avoid `...args` which allocates.
		let bound_create = create.bind(null, _cmd)
		ui[cmd_name] = bound_create
		return bound_create
	} else {
		return _cmd
	}
}

//// BOX WIDGETS -------------------------------------------------------------

/*

A box has min_w, min_h, margin, padding, align, valign, and also `fr`
if it's is_flex_child. a box can also be a container.
it's x,y,w,h are calculated by the layouting system using the above.

CREATE
	ui.box_widget      (cmd_name, t, is_ct)   define a box widget
	ui.box_ct_widget   (cmd_name, t)          define a container box widget

	ui.PX1    = index offset in a for x1 padding; y1 padding at PX1+1
	ui.PX2    = index offset in a for x2 padding; y1 padding at PX2+1
	ui.MX1    = index offset in a for x1 margin; y1 margin at MX1+1
	ui.MX2    = index offset in a for x2 margin; y2 margin at MX2+1
	ui.FR     = index offset in a for fr
	ui.ALIGN  = index offset in a for align

	ui.ct_i   () -> ct_i    get container index in a
	ui.last_i () -> last_i  get the index of the last cmd in a

MEASURE
	ui.add_ct_min_wh (a, axis, w)    declare min width/height

POSITION
	ui.align_x (a, i, axis, sx, sw)
	ui.align_w (a, i, axis, sx, sw)
	ui.inner_x (a, i, axis, ct_x)
	ui.inner_w (a, i, axis, ct_x)

DRAW
	ui.popup_target_rect (a, i)  find a popup's target rect

USER API: MARGINS & PADDINGS

	em  (em) -> x    em units to pixels

	sp025 () -> em( .125)
	sp05  () -> em( .25)
	sp075 () -> em( .375)
	sp    () -> em( .5)
	sp1   () -> em( .5)
	sp2   () -> em( .75)
	sp4   () -> em(1)
	sp8   () -> em(2)

	p[adding]           ([px1], [py1], [px2], [py2])
	p[adding_]l[eft]    (p)
	p[adding_]r[ight]   (p)
	p[adding_]t[op]     (p)
	p[adding_]b[ottom]  (p)
	p[adding_]h[oriz]   (p1, [p2])
	p[adding_]v[ert]    (p1, [p2])

	m[argin]            ([mx1], [my1], [mx2], [my2])
	m[argin_]l[eft]     (m)
	m[argin_]r[ight]    (m)
	m[argin_]t[op]      (m)
	m[argin_]b[ottom]   (m)
	m[argin_]h[oriz]    (m1, [m2])
	m[argin_]v[ert]     (m1, [m2])

*/

const PX1        =  4
const PX2        =  6
const MX1        =  8
const MX2        = 10

const FR         = 12 // all `is_flex_child` widgets: fraction from main-axis size.
const ALIGN      = 13 // vert. align at ALIGN+1
const BOX_CT_NEXT_SIB_I = 15 // all container-boxes: next command after this one's END command.
const BOX_CT_ARGS = 16 // first index after the ui_cmd_box_ct_begin header.
const BOX_ARGS    = 15 // first index after the ui_cmd_box header.

ui.PX1   = PX1
ui.PX2   = PX2
ui.MX1   = MX1
ui.MX2   = MX2
ui.FR    = FR
ui.ALIGN = ALIGN
ui.BOX_CT_ARGS = BOX_CT_ARGS
ui.BOX_ARGS = BOX_ARGS

function spacings(a, i, axis) {
	return (
		a[i+MX1+axis] + a[i+MX2+axis] +
		a[i+PX1+axis] + a[i+PX2+axis]
	)
}

const ALIGN_STRETCH = 0
const ALIGN_START   = 1
const ALIGN_END     = 2
const ALIGN_CENTER  = 3

function parse_align(s) {
	if (isnum(s)) return s
	if (s == 's') return ALIGN_STRETCH
	if (s == 'c') return ALIGN_CENTER
	if (s == 'l') return ALIGN_START
	if (s == 'r') return ALIGN_END
	if (s == '[') return ALIGN_START
	if (s == ']') return ALIGN_END
	if (s == 'stretch') return ALIGN_STRETCH
	if (s == 'center' ) return ALIGN_CENTER
	if (s == 'left'   ) return ALIGN_START
	if (s == 'right'  ) return ALIGN_END
	assert(false, 'invalid align ', s)
}

function parse_valign(s) {
	if (isnum(s)) return s
	if (s == 's') return ALIGN_STRETCH
	if (s == 'c') return ALIGN_CENTER
	if (s == 't') return ALIGN_START
	if (s == 'b') return ALIGN_END
	if (s == '[') return ALIGN_START
	if (s == ']') return ALIGN_END
	if (s == 'stretch') return ALIGN_STRETCH
	if (s == 'center' ) return ALIGN_CENTER
	if (s == 'top'    ) return ALIGN_START
	if (s == 'bottom' ) return ALIGN_END
	assert(false, 'invalid valign ', s)
}

// spacings (margins and paddings), applied to the next box cmd and then they are reset.
let px1, px2, py1, py2
let mx1, mx2, my1, my2

ui.em = em => round((em ?? 1) * font_size_normal)

let em = ui.em
ui.sp025 = () => em( .125)
ui.sp05  = () => em( .25)
ui.sp075 = () => em( .375)
ui.sp1   = () => em( .5)
ui.sp2   = () => em( .75)
ui.sp4   = () => em(1)
ui.sp8   = () => em(2)
ui.sp    = ui.sp1

ui.padding = function(_px1, _py1, _px2, _py2) {
	px1 = _px1 ?? 0
	px2 = _px2 ?? _px1 ?? 0
	py1 = _py1 ?? _px1 ?? 0
	py2 = _py2 ?? _py1 ?? _px1 ?? 0
}
ui.p = ui.padding
ui.padding_left   = function(p) { px1 = p }; ui.pl = ui.padding_left
ui.padding_right  = function(p) { px2 = p }; ui.pr = ui.padding_right
ui.padding_top    = function(p) { py1 = p }; ui.pt = ui.padding_top
ui.padding_bottom = function(p) { py2 = p }; ui.pb = ui.padding_bottom
ui.padding_horiz  = function(p1, p2) { px1 = p1; px2 = p2 ?? p1 }
ui.padding_vert   = function(p1, p2) { py1 = p1; py2 = p2 ?? p1 }
ui.ph = ui.padding_horiz
ui.pv = ui.padding_vert

ui.margin = function(_mx1, _my1, _mx2, _my2) {
	mx1 = _mx1 ?? 0
	mx2 = _mx2 ?? _mx1 ?? 0
	my1 = _my1 ?? _mx1 ?? 0
	my2 = _my2 ?? _my1 ?? _mx1 ?? 0
}
ui.m = ui.margin
ui.margin_left   = function(m) { mx1 = m }; ui.ml = ui.margin_left
ui.margin_right  = function(m) { mx2 = m }; ui.mr = ui.margin_right
ui.margin_top    = function(m) { my1 = m }; ui.mt = ui.margin_top
ui.margin_bottom = function(m) { my2 = m }; ui.mb = ui.margin_bottom
ui.margin_horiz  = function(p1, p2) { mx1 = p1; mx2 = p2 ?? p1 }
ui.margin_vert   = function(p1, p2) { my1 = p1; my2 = p2 ?? p1 }
ui.mh = ui.margin_horiz
ui.mv = ui.margin_vert

function reset_spacings() {
	px1 = 0
	py1 = 0
	px2 = 0
	py2 = 0
	mx1 = 0
	my1 = 0
	mx2 = 0
	my2 = 0
}
reset_spacings()

/// box args

let fr0, align0, valign0, min_w0, min_h0

ui.box_args = function(fr, align, valign, min_w, min_h) {
	if (isobj(fr)) {
		let t = fr
		fr0     = t.fr
		align0  = t.align
		valign0 = t.valign
		min_w0  = t.min_w
		min_h0  = t.min_h
	} else {
		fr0     = fr
		align0  = align
		valign0 = valign
		min_w0  = min_w
		min_h0  = min_h
	}
}

ui.clear_box_args = function() {
	fr0     = null
	align0  = null
	valign0 = null
	min_w0  = null
	min_h0  = null
}

/// box command

// set by ui.scroll_to_view_next_box() to indicate that the next box needs
// to be revealed by its scrollbox(es).
let scroll_to_view_next

function ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h) {
	tui_snap_paddings()

	// see "format of a command recording array" above to understand this.
	let i = ui_cmd_begin(cmd)
	a[n++] = min_w ?? 0 // user min_w in measure phase; x in position phase
	a[n++] = min_h ?? 0 // user min_h in measure phase; y in position phase
	a[n++] = 0 // children's min_w -> min_w in measure phase; w in position phase
	a[n++] = 0 // children's min_h -> min_h in measure phase; h in position phase
	a[n++] = px1; a[n++] = py1; a[n++] = px2; a[n++] = py2
	a[n++] = mx1; a[n++] = my1; a[n++] = mx2; a[n++] = my2
	a[n++] = max(0, fr ?? 1)
	a[n++] = parse_align  (align  ?? 's')
	a[n++] = parse_valign (valign ?? 's')
	return i
}

function ui_cmd_box_end(i) {
	ui_cmd_end(i)
	reset_spacings()
	if (scroll_to_view_next) {
		scroll_to_view_next = false
		let j = ui_cmd_begin(CMD_SCROLL_TO_VIEW)
		a[n++] = i - j // make the requested box index relative
		ui_cmd_end(j)
	}
}

ui.cmd_box = function(cmd, fr, align, valign, min_w, min_h, ...args) {
	let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
	for (let j = 0; j < args.length; j++)
		a[n++] = args[j]
	ui_cmd_box_end(i)
	return i
}

/// box measure phase

function add_ct_min_wh(a, axis, child_min_wh) {
	let ct_i = ct_stack.at(-1)
	if (ct_i == null) // root ct
		return
	let cmd = a[ct_i-1]
	let main_axis = is_main_axis(cmd, axis)
	let ct_min_wh = a[ct_i+2+axis]
	if (main_axis) {
		let gap = a[ct_i+FLEX_GAP]
		a[ct_i+2+axis] = ct_min_wh + child_min_wh + gap
	} else {
		a[ct_i+2+axis] = max(ct_min_wh, child_min_wh)
	}
}
ui.add_ct_min_wh = add_ct_min_wh

function ct_stack_push(a, i) {
	ct_stack.push(i)
}

// calculate a[i+2]=min_w (for axis=0) or a[i+3]=min_h (for axis=1).
// the minimum dimensions include margins and paddings.
function box_measure(a, i, axis) {
	let user_min_wh = a[i+0+axis]
	let min_wh = a[i+2+axis]
	min_wh = max(min_wh, user_min_wh)
	min_wh += spacings(a, i, axis)
	a[i+2+axis] = min_wh
	add_ct_min_wh(a, axis, min_wh)
}

/// box position phase

function align_w(a, i, axis, sw) {
	let align = a[i+ALIGN+axis]
	if (align == ALIGN_STRETCH)
		return sw
	return a[i+2+axis] // min_w
}

function align_x(a, i, axis, sx, sw) {
	let align = a[i+ALIGN+axis]
	if (align == ALIGN_END) {
		let min_w = a[i+2+axis]
		return sx + sw - min_w
	} else if (align == ALIGN_CENTER) {
		let min_w = a[i+2+axis]
		return sx + max(0, round((sw - min_w) / 2))
	} else {
		return sx
	}
}

// outer-box (ct_x, ct_w) -> inner-box (x, w).
function inner_x(a, i, axis, ct_x) {
	return ct_x + a[i+MX1+axis] + a[i+PX1+axis]
}
function inner_w(a, i, axis, ct_w) {
	return ct_w - spacings(a, i, axis)
}

ui.align_x = align_x
ui.align_w = align_w
ui.inner_x = inner_x
ui.inner_w = inner_w

// calculate a[i+0]=x, a[i+2]=w (for axis=0) or a[i+1]=y, a[i+3]=h (for axis=1).
// the resulting box at a[i+0..3] is the inner box which excludes margins and paddings.
// NOTE: scrolling and popup positioning is done in the translation phase.
function box_position(a, i, axis, sx, sw) {
	a[i+0+axis] = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	a[i+2+axis] = inner_w(a, i, axis, align_w(a, i, axis, sw))
}
ui.box_position = box_position

/// box translate phase

function box_translate(a, i, dx, dy) {
	a[i+0] += dx
	a[i+1] += dy
}
ui.box_translate = box_translate

/// box hit phase

function hit_box(a, i) {
	let px1 = a[i+PX1+0]
	let py1 = a[i+PX1+1]
	let px2 = a[i+PX2+0]
	let py2 = a[i+PX2+1]
	let x = a[i+0] - px1
	let y = a[i+1] - py1
	let w = a[i+2] + px1 + px2
	let h = a[i+3] + py1 + py2
	return hit_rect(x, y, w, h)
}
ui.hit_box = hit_box

ui.box_widget = function(cmd_name, t, is_ct) {
	let ID = t.ID
	let box_hit = ID && function box_hit(a, i) {
		let id = a[i+ID]
		if (hit_box(a, i)) {
			set_hit(id)
			return true
		}
	}
	return ui.widget(cmd_name, {
		measure   : box_measure   ,
		position  : box_position  ,
		translate : box_translate ,
		hit       : box_hit,
		is_flex_child: true,
		...t,
	}, is_ct)
}

//// BOX CONTAINER WIDGETS ---------------------------------------------------

function cmd_next_sibling_i(a, i) {
	let cmd = a[i-1]
	if (cmd & 1) // container
		return i+a[i+BOX_CT_NEXT_SIB_I]
	return cmd_next_i(a, i)
}

// NOTE: `ct` is short for container, which must end with ui.end().
function ui_cmd_box_ct_begin(cmd, fr, align, valign, min_w, min_h) {
	let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
	a[n++] = 0 // next_sib_i
	return i
}

function ui_cmd_box_ct_end(i) {
	ui_cmd_box_end(i)
	ct_stack.push(i)
}

ui.cmd_box_ct = function(cmd, fr, align, valign, min_w, min_h, ...args) {
	let i = ui_cmd_box_ct_begin(cmd, fr, align, valign, min_w, min_h)
	for (let j = 0; j < args.length; j++)
		a[n++] = args[j]
	ui_cmd_box_ct_end(i)
	return i
}

ui.box_ct_widget = function(cmd_name, t) {
	let ID = t.ID
	function box_ct_hit(a, i, recs) {
		return hit_ct(a, i, recs, ID != null ? a[i+ID] : null)
	}
	let ret = ui.box_widget(cmd_name, {
		measure   : ct_stack_push    ,
		position  : position_stacked ,
		translate : translate_ct     ,
		hit       : box_ct_hit       ,
		...t,
	}, true)
	let cmd = cmd_name_map[cmd_name]
	ui['end_'+cmd_name] = function() { ui.end(cmd) }
	return ret
}

const CMD_END = cmd('end')

ui.end = function(cmd) {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let i = assert(ct_stack.pop(), 'end command outside container')
	if (cmd && a[i-1] != cmd)
		assert(false, 'closing ', cmd_names[cmd], ' instead of ', C(a, i))
	let end_i = ui_cmd_begin(CMD_END)
	a[n++] = i - end_i // make relative
	ui_cmd_end(end_i)
	let next_i = cmd_next_i(a, end_i)
	a[i+BOX_CT_NEXT_SIB_I] = next_i-i // next_i but relative to the ct cmd at i
}

function ct_measure_end(a, i, axis) {
	let main_axis = is_main_axis(a[i-1], axis)
	let user_min_w = a[i+0+axis]
	let min_w      = a[i+2+axis]
	if (main_axis)
		min_w = max(0, min_w - a[i+FLEX_GAP]) // remove last element's gap
	min_w = max(min_w, user_min_w) + spacings(a, i, axis)
	a[i+2+axis] = min_w
	add_ct_min_wh(a, axis, min_w)
}

measure[CMD_END] = function(a, _, axis) {
	let i = assert(ct_stack.pop(), 'end command outside a container')
	let measure_end_f = measure_end[a[i-1]]
	if (measure_end_f)
		measure_end_f(a, i, axis)
	else
		ct_measure_end(a, i, axis)
}

draw[CMD_END] = function(a, end_i) {
	let i = end_i + a[end_i]
	let draw_end_f = draw_end[a[i-1]]
	if (draw_end_f)
		draw_end_f(a, i)
}

// position phase utils

function position_children_stacked(a, ct_i, axis, sx, sw) {

	let i = cmd_next_i(a, ct_i)
	while (a[i-1] != CMD_END) {

		let cmd = a[i-1]
		let position_f = position[cmd]
		if (position_f) {
			// position item's children recursively.
			position_f(a, i, axis, sx, sw)
		}

		i = cmd_next_sibling_i(a, i)
	}
}

// translate phase utils

function translate_children(a, i, dx, dy) {
	i = cmd_next_i(a, i)
	while (a[i-1] != CMD_END) {
		let cmd = a[i-1]
		let translate_f = translate[cmd]
		if (translate_f)
			translate_f(a, i, dx, dy)
		i = cmd_next_sibling_i(a, i)
	}
}

function translate_ct(a, i, dx, dy) {
	a[i+0] += dx
	a[i+1] += dy
	translate_children(a, i, dx, dy)
}

// hit phase utils

function hit_children(a, i, recs) {

	// hit direct children in reverse z_index.
	let ct_i = i
	let next_sib_i = cmd_next_sibling_i(a, i)
	let end_i = cmd_prev_i(a, next_sib_i)
	i = cmd_prev_i(a, end_i)
	while (i > ct_i) {
		if (a[i-1] == CMD_END)
			i = i+a[i+0] // start_i
		let hit_f = hittest[a[i-1]]
		if (hit_f && !a.nohit_set?.has(i) && hit_f(a, i, recs)) {
			return true
		}
		i = cmd_prev_i(a, i)
	}
}

// id is optional: containers without one still hit their children.
function hit_ct(a, i, recs, id) {
	if (hit_children(a, i, recs)) {
		set_hit(id)
		return true
	}
	if (hit_box(a, i)) {
		set_hit(id)
		hit_template(a, i)
		// an id means that the app hit-tests this box, so it takes the hit.
		// nohit() opts out.
		return !!id
	}
}

//// BOX CONTAINER MEASURE REQUESTS ------------------------------------------

const CMD_MEASURE = cmd('measure')

// measure current container after layouting and put the result in
// ui.state(into_id) keys: x, y, w, h.
ui.measure = function(into_id) {
	let i = ui_cmd_begin(CMD_MEASURE)
	a[n++] = into_id
	a[n++] = ui.ct_i() - i // make ct_i relative
	ui_cmd_end(i)
}

register[CMD_MEASURE] = function(a, i) {
	let ct_i = i+a[i+1]
	let s = ui.state(a[i+0])
	s.x = a[ct_i+0]
	s.y = a[ct_i+1]
	s.w = a[ct_i+2]
	s.h = a[ct_i+3]
}

//// FLEX --------------------------------------------------------------------

const FLEX_GAP = BOX_CT_ARGS+0

function ui_hv(cmd, fr, gap, align, valign, min_w, min_h) {
	let i = ui_cmd_box_ct_begin(cmd, fr, align, valign, min_w, min_h)
	a[n++] = gap ?? 0
	ui_cmd_box_ct_end(i)
	return i
}

const CMD_H = cmd_ct('h')
const CMD_V = cmd_ct('v')

// bind() avoids `...args` which allocates.
ui.h = ui_hv.bind(null, CMD_H)
ui.v = ui_hv.bind(null, CMD_V)
ui.hv = function(hv, ...args) {
	let cmd = assert(hv == 'h' ? CMD_H : hv == 'v' ? CMD_V : 0)
	return ui_hv(cmd, ...args)
}

ui.end_h = function() { ui.end(CMD_H) }
ui.end_v = function() { ui.end(CMD_V) }

function is_main_axis(cmd, axis) {
	return (
		(cmd == CMD_V || cmd == CMD_V_ALIGNED ? 1 : 2) == axis ||
		(cmd == CMD_H ? 0 : 2) == axis
	)
}

measure[CMD_H] = ct_stack_push
measure[CMD_V] = ct_stack_push

function is_last_flex_child(a, i) {
	while (1) {
		i = cmd_next_sibling_i(a, i)
		if (is_flex_child[a[i-1]]) return
		if (a[i-1] == CMD_END) return true
	}
}

function position_flex(a, i, axis, sx, sw) {

	sx = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	sw = inner_w(a, i, axis, align_w(a, i, axis, sw))

	a[i+0+axis] = sx
	a[i+2+axis] = sw

	let ct_i = i
	if (is_main_axis(a[i-1], axis)) {

		let i = ct_i

		let next_i = cmd_next_i(a, i)
		let gap    = a[i+FLEX_GAP]

		// compute total gap and total fr.
		let total_fr = 0
		let gap_w = 0
		let n = 0
		i = next_i
		while (a[i-1] != CMD_END) {
			if (is_flex_child[a[i-1]]) {
				total_fr += a[i+FR]
				n++
			}
			i = cmd_next_sibling_i(a, i)
		}
		gap_w = max(0, (n - 1) * gap)

		if (!total_fr)
			total_fr	= 1

		// compute total overflow width and total free width.
		let total_w = sw - gap_w
		let total_overflow_w = 0
		let total_free_w     = 0
		i = next_i
		while (a[i-1] != CMD_END) {
			if (is_flex_child[a[i-1]]) {

				let min_w = a[i+2+axis]
				let fr    = a[i+FR]

				let flex_w = total_w * fr / total_fr
				let overflow_w = max(0, min_w - flex_w)
				let free_w = max(0, flex_w - min_w)
				total_overflow_w += overflow_w
				total_free_w     += free_w

			}
			i = cmd_next_sibling_i(a, i)
		}

		// distribute the overflow to children which have free space to
		// take it. each child shrinks to take in the percent of the overflow
		// equal to the child's percent of free space.
		i = next_i
		let ct_sx = sx
		let ct_sw = sw
		let exact_x = sx
		while (a[i-1] != CMD_END) {
			if (is_flex_child[a[i-1]]) {

				let min_w = a[i+2+axis]
				let fr    = a[i+FR]

				// compute item's stretched width.
				let flex_w = total_w * fr / total_fr
				let sw
				if (min_w > flex_w) { // overflow
					sw = min_w
					exact_x += min_w
				} else {
					let free_w = flex_w - min_w
					let free_p = free_w / total_free_w
					let shrink_w = total_overflow_w * free_p
					if (shrink_w != shrink_w) // total_free_w == 0
						shrink_w = 0
					exact_x += flex_w - shrink_w
					sw = round(exact_x) - sx
				}

				// the last child ends on the container's edge.
				if (is_last_flex_child(a, i))
					sw = ct_sw - (sx - ct_sx)

				// position item's children recursively.
				let position_f = position[a[i-1]]
				position_f(a, i, axis, sx, sw)

				sx += sw + gap
				exact_x += gap

			} else {

				let position_f = position[a[i-1]]
				if (position_f)
					position_f(a, i, axis, ct_sx, ct_sw)
			}

			i = cmd_next_sibling_i(a, i)
		}

	} else {

		position_children_stacked(a, i, axis, sx, sw)

	}

}
position[CMD_H] = position_flex
position[CMD_V] = position_flex
is_flex_child[CMD_H] = true
is_flex_child[CMD_V] = true

translate[CMD_H] = translate_ct
translate[CMD_V] = translate_ct

function hit_flex(a, i, recs) {
	return hit_ct(a, i, recs)
}
hittest[CMD_H] = hit_flex
hittest[CMD_V] = hit_flex

//// V_ALIGNED ---------------------------------------------------------------

const CMD_V_ALIGNED = cmd_ct('v_aligned')

ui.v_aligned = ui_hv.bind(null, CMD_V_ALIGNED)
ui.end_v_aligned = function() { ui.end(CMD_V_ALIGNED) }

let tabstop_ws = []

function align_tabstops(a, i) {

	let n_cols = 0
	let row_i = cmd_next_i(a, i)
	while (a[row_i-1] != CMD_END) {
		if (a[row_i-1] == CMD_H) {
			let col_i = 0
			let cell_i = cmd_next_i(a, row_i)
			while (a[cell_i-1] != CMD_END) {
				if (is_flex_child[a[cell_i-1]]) {
					let w = a[cell_i+2]
					if (col_i < n_cols) {
						tabstop_ws[col_i] = max(tabstop_ws[col_i], w)
					} else {
						tabstop_ws[col_i] = w
						n_cols = col_i+1
					}
					col_i++
				}
				cell_i = cmd_next_sibling_i(a, cell_i)
			}
		}
		row_i = cmd_next_sibling_i(a, row_i)
	}

	row_i = cmd_next_i(a, i)
	while (a[row_i-1] != CMD_END) {
		if (a[row_i-1] == CMD_H) {
			let col_i = 0
			let row_w = 0
			let cell_i = cmd_next_i(a, row_i)
			while (a[cell_i-1] != CMD_END) {
				if (is_flex_child[a[cell_i-1]]) {
					let w = tabstop_ws[col_i]
					a[cell_i+2] = w
					row_w += w
					col_i++
				}
				cell_i = cmd_next_sibling_i(a, cell_i)
			}
			row_w += max(0, col_i-1) * a[row_i+FLEX_GAP]
			row_w = max(row_w, a[row_i+0]) + spacings(a, row_i, 0)
			a[row_i+2] = row_w
			a[i+2] = max(a[i+2], row_w)
		}
		row_i = cmd_next_sibling_i(a, row_i)
	}

}

measure       [CMD_V_ALIGNED] = ct_stack_push
position      [CMD_V_ALIGNED] = position_flex
translate     [CMD_V_ALIGNED] = translate_ct
hittest       [CMD_V_ALIGNED] = hit_flex
is_flex_child [CMD_V_ALIGNED] = true

measure_end[CMD_V_ALIGNED] = function(a, i, axis) {
	if (axis == 0)
		align_tabstops(a, i)
	ct_measure_end(a, i, axis)
}

//// BOX ---------------------------------------------------------------------

// just an empty box used as an empty place in v_aligned or to reserve space.
ui.box_widget('box', {
	create: function(cmd, fr, min_w, min_h) {
		let i = ui_cmd_box_begin(cmd, fr ?? 0, 's', 's', min_w, min_h)
		ui_cmd_box_end(i)
		return i
	},
})

//// STACK -------------------------------------------------------------------

const STACK_ID = BOX_CT_ARGS+0

const CMD_STACK = cmd_ct('stack')
id_slot[CMD_STACK] = STACK_ID

ui.stack = function(id, fr, align, valign, min_w, min_h) {
	let i = ui_cmd_box_ct_begin(CMD_STACK, fr, align, valign, min_w, min_h)
	a[n++] = id || ''
	ui_cmd_box_ct_end(i)
	return i
}

measure[CMD_STACK] = ct_stack_push

function position_stacked(a, i, axis, sx, sw) {
	let x = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	let w = inner_w(a, i, axis, align_w(a, i, axis, sw))
	a[i+0+axis] = x
	a[i+2+axis] = w
	position_children_stacked(a, i, axis, x, w)
}
position[CMD_STACK] = position_stacked
is_flex_child[CMD_STACK] = true

ui.end_stack = function() { ui.end(CMD_STACK) }

translate[CMD_STACK] = translate_ct

hittest[CMD_STACK] = function(a, i, recs) {
	return hit_ct(a, i, recs, a[i+STACK_ID])
}

//// ASPECT BOX --------------------------------------------------------------

ui.box_ct_widget('aspect_box', {
	create: function(cmd, aspect, fr, align, valign, min_w, min_h) {
		let i = ui_cmd_box_ct_begin(cmd, fr, align, valign, min_w, min_h)
		a[n++] = aspect ?? 1
		ui_cmd_box_ct_end(i)
		return i
	},
	measure: function(a, i, axis) {
		ct_stack_push(a, i)
		let w = a[i+2+axis]
		if (axis) {
			let aspect = a[i+BOX_CT_ARGS+0]
			w = round(a[i+2] / aspect)
		}
		add_ct_min_wh(a, axis, w)
	},
})

//// SCROLLBOX ---------------------------------------------------------------

const SB_OVERFLOW  = BOX_CT_ARGS+0 // overflow x,y
const SB_CW        = BOX_CT_ARGS+2 // content w,h
const SB_ID        = BOX_CT_ARGS+4
const SB_SX        = BOX_CT_ARGS+5 // scroll x,y
const SB_STATE     = BOX_CT_ARGS+7
const SB_SCROLL_ID = BOX_CT_ARGS+8 // x_id,y_id: state ids sync'ed scrollboxes

const SB_OVERFLOW_AUTO     = 0
const SB_OVERFLOW_HIDE     = 1
const SB_OVERFLOW_SCROLL   = 2
const SB_OVERFLOW_CONTAIN  = 3 // expand to fit content, like a stack.
const SB_OVERFLOW_INFINITE = 4 // special mode for the infinite calendar.

function parse_sb_overflow(s) {
	if (s == null   || s == 'auto'    ) return SB_OVERFLOW_AUTO
	if (s === false || s == 'hide'    ) return SB_OVERFLOW_HIDE
	if (s === true  || s == 'scroll'  ) return SB_OVERFLOW_SCROLL
	if (               s == 'contain' ) return SB_OVERFLOW_CONTAIN
	if (               s == 'infinite') return SB_OVERFLOW_INFINITE
	assert(false, 'invalid overflow ', s)
}

const CMD_SCROLLBOX = cmd_ct('scrollbox')
id_slot[CMD_SCROLLBOX] = SB_ID

ui.scrollbox = function(
	id, fr, overflow_x, overflow_y, align, valign,
	min_w, min_h, sx, sy, x_id, y_id
) {

	overflow_x = parse_sb_overflow(overflow_x)
	overflow_y = parse_sb_overflow(overflow_y)

	assert(id, 'id required for scrollbox')

	ui.state(id)
	let xstate = ui.state(x_id ?? id)
	let ystate = ui.state(y_id ?? id)
	if (sx != null) xstate.scroll_x = sx
	if (sy != null) ystate.scroll_y = sy

	let i = ui_cmd_box_ct_begin(CMD_SCROLLBOX, fr, align, valign, min_w, min_h)
	a[n++] = overflow_x
	a[n++] = overflow_y
	a[n++] = 0; a[n++] = 0 // content w, h
	a[n++] = id
	a[n++] = 0; a[n++] = 0 // computed scroll x, y
	a[n++] = 0 // state
	a[n++] = x_id
	a[n++] = y_id
	ui_cmd_box_ct_end(i)

	return i
}
ui.sb = ui.scrollbox

ui.end_scrollbox = function() { ui.end(CMD_SCROLLBOX) }
ui.end_sb = ui.end_scrollbox

measure[CMD_SCROLLBOX] = ct_stack_push

measure_end[CMD_SCROLLBOX] = function(a, i, axis) {
	let user_min_w = a[i+0+axis]
	let co_min_w   = a[i+2+axis] // content min_w
	let overflow = a[i+SB_OVERFLOW+axis]
	let contain = overflow == SB_OVERFLOW_CONTAIN
	let sb_min_w = max(contain ? co_min_w : 0, user_min_w) // scrollbox min_w
	sb_min_w += spacings(a, i, axis)
	a[i+SB_CW+axis] = co_min_w
	a[i+2+axis] = sb_min_w
	add_ct_min_wh(a, axis, sb_min_w)
}

// NOTE: scrolling is done later in the translation phase.
position[CMD_SCROLLBOX] = function(a, i, axis, sx, sw) {
	let x = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	let w = inner_w(a, i, axis, align_w(a, i, axis, sw))
	a[i+0+axis] = x
	a[i+2+axis] = w
	let content_w = a[i+SB_CW+axis]
	position_children_stacked(a, i, axis, x, max(content_w, w))
	// compute scrollbox offsets in position phase, not in translate phase
	// because shared scrollbox offsets in x_id/y_id can be updated by later
	// scrollboxes, and we can't do that translate (can't re-translate).
	if (axis)
		settle_scrollbox(a, i)
}
is_flex_child[CMD_SCROLLBOX] = true

// box scroll-to-view box. from box2d.lua.
function scroll_offsets_to_view_rect(x, y, w, h, pw, ph, sx, sy) {
	let min_sx = -x
	let min_sy = -y
	let max_sx = max(min_sx, -(x + w - pw))
	let max_sy = max(min_sy, -(y + h - ph))
	return [
		-clamp(-sx, min_sx, max_sx),
		-clamp(-sy, min_sy, max_sy)
	]
}

function settle_scrollbox(a, i) {

	let w  = a[i+2]
	let h  = a[i+3]
	let cw = a[i+SB_CW+0]
	let ch = a[i+SB_CW+1]
	let id = a[i+SB_ID]
	let x_id = a[i+SB_SCROLL_ID+0]
	let y_id = a[i+SB_SCROLL_ID+1]
	let xstate = ui.state(x_id ?? id)
	let ystate = ui.state(y_id ?? id)
	let sx = xstate.scroll_x ?? 0
	let sy = ystate.scroll_y ?? 0

	let infinite_x = a[i+SB_OVERFLOW+0] == SB_OVERFLOW_INFINITE
	let infinite_y = a[i+SB_OVERFLOW+1] == SB_OVERFLOW_INFINITE

	if (infinite_x) {
		cw = w * 4
		a[i+SB_CW+0] = cw
	}
	if (infinite_y) {
		ch = h * 4
		a[i+SB_CW+1] = ch
	}

	let sx0 = sx
	let sy0 = sy
	if (!infinite_x) sx = max(0, min(sx, cw - w))
	if (!infinite_y) sy = max(0, min(sy, ch - h))
	if (sx != sx0) xstate.scroll_x = sx
	if (sy != sy0) ystate.scroll_y = sy

	let psx = sx / (cw - w)
	let psy = sy / (ch - h)

	// scroll to view an inner box
	let box = ui.state_of(id, 'scroll_to_view')
	if (box) {
		let [bx, by, bw, bh] = box
		;[sx, sy] = scroll_offsets_to_view_rect(bx, by, bw, bh, w, h, sx, sy)
		xstate.scroll_x = sx
		ystate.scroll_y = sy
		ui.state(id).scroll_to_view = null
	}

	// scroll to view the box asked for by ui.scroll_to_view_next_box().
	// the index range check rejects a request left by a sibling scrollbox.
	let j = scroll_to_view_i // requested box
	if (j > i && j < i + a[i+BOX_CT_NEXT_SIB_I]) {
		let px1 = a[j+PX1+0]
		let py1 = a[j+PX1+1]
		let px2 = a[j+PX2+0]
		let py2 = a[j+PX2+1]
		let bx = a[j+0] - a[i+0] // marked box coords, relative to the contents
		let by = a[j+1] - a[i+1]
		bx -= px1
		by -= py1
		let bw = a[j+2] + px1 + px2
		let bh = a[j+3] + py1 + py2
		;[sx, sy] = scroll_offsets_to_view_rect(
			bx, by, bw, bh, w, h, sx, sy)
		xstate.scroll_x = sx
		ystate.scroll_y = sy
		// mark this scrollbox as scroll-to-view from here on, so that its
		// parent scrollbox if any reveals it in turn.
		scroll_to_view_i = i
	}

	// only setting these for scrollbar_rect().
	a[i+SB_SX+0] = sx
	a[i+SB_SX+1] = sy

	let hit_state = 0
	for (let axis = 0; axis < 2; axis++) {

		let [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis)

		let sbar_id = id+'.scrollbar'+axis
		ui.state(sbar_id)
		ui.keep_focus(sbar_id)

		// wheel scrolling
		if (axis && ui.wheel_dy && hovers(id) && !ui.pressed && (visible || y_id)) {
			sy = sy + ui.wheel_dy
			if (!infinite_y)
				sy = max(0, min(sy, ch - h))
			ystate.scroll_y = sy
		}
		if (!visible)
			continue

		// drag-scrolling
		let cs = captured(sbar_id)
		let hs
		if (cs) {
			if (!axis) {
				if (ui.click) // the hit phase captured it this frame
					cs.psx0 = psx
				let psx0 = cs.psx0
				let dpsx = (ui.mx - ui.mx0) / (w - tw)
				sx = round((psx0 + dpsx) * (cw - w))
				if (!infinite_x)
					sx = max(0, min(sx, cw - w))
				xstate.scroll_x = sx
			} else {
				if (ui.click) // the hit phase captured it this frame
					cs.psy0 = psy
				let psy0 = cs.psy0
				let dpsy = (ui.my - ui.my0) / (h - th)
				sy = round((psy0 + dpsy) * (ch - h))
				if (!infinite_y)
					sy = max(0, min(sy, ch - h))
				ystate.scroll_y = sy
			}
		} else {
			hs = hit(sbar_id)
			if (!hs)
				continue
		}

		// bits 0..1 = horiz state; bits 2..3 = vert. state.
		hit_state |= (cs ? 2 : hs ? 1 : 0) << (2 * axis)
	}
	a[i+SB_STATE] = hit_state

}

translate[CMD_SCROLLBOX] = function(a, i, dx, dy) {

	let x  = a[i+0] + dx
	let y  = a[i+1] + dy
	let w  = a[i+2]
	let h  = a[i+3]
	let cw = a[i+SB_CW+0]
	let ch = a[i+SB_CW+1]
	let id = a[i+SB_ID]
	let x_id = a[i+SB_SCROLL_ID+0] ?? id
	let y_id = a[i+SB_SCROLL_ID+1] ?? id
	let sx = ui.state_of(x_id, 'scroll_x') ?? 0
	let sy = ui.state_of(y_id, 'scroll_y') ?? 0

	let infinite_x = a[i+SB_OVERFLOW+0] == SB_OVERFLOW_INFINITE
	let infinite_y = a[i+SB_OVERFLOW+1] == SB_OVERFLOW_INFINITE

	if (!infinite_x) sx = max(0, min(sx, cw - w))
	if (!infinite_y) sy = max(0, min(sy, ch - h))

	a[i+0] = x
	a[i+1] = y
	a[i+SB_SX+0] = sx
	a[i+SB_SX+1] = sy

	translate_children(a, i, dx - sx, dy - sy)

}

const CMD_SCROLL_TO_VIEW = cmd('scroll_to_view')

// scroll_to_view_next_box() -> reveal the box recorded next, in every
//    scrollbox that contains it, innermost first. call it right before
//    recording the box.
// scroll_to_view_rect(scrollbox_id, x, y, w, h) -> reveal a rect of that
//    scrollbox's contents. the rect is in contents coords.
// a later request replaces an earlier one, so a widget can request an inner
// box after focusable() already requested the widget's own box.
ui.scroll_to_view_next_box = function() {
	scroll_to_view_next = true
}

ui.scroll_to_view_rect = function(scrollbox_id, x, y, w, h) {
	ui.state(scrollbox_id).scroll_to_view = [x, y, w, h]
}

// box to scroll-to-view: set in position phase when
// scroll_to_view_next_box() is called and later read by its scrollbox in the
// same position phase.
let scroll_to_view_i

position[CMD_SCROLL_TO_VIEW] = function(a, i, axis) {
	if (axis)
		scroll_to_view_i = i + a[i+0]
}

draw[CMD_SCROLLBOX] = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]

	cx.save()
	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.clip()
}

ui.scrollbar_thickness = 4
ui.scrollbar_thickness_active = 10

let scrollbar_rect; {
let r = [false, 0, 0, 0, 0]
scrollbar_rect = function(a, i, axis, state) {
	let x  = a[i+0]
	let y  = a[i+1]
	let w  = a[i+2]
	let h  = a[i+3]
	let cw = a[i+SB_CW+0]
	let ch = a[i+SB_CW+1]
	let sx = a[i+SB_SX+0]
	let sy = a[i+SB_SX+1]
	let overflow_x = a[i+SB_OVERFLOW+0]
	let overflow_y = a[i+SB_OVERFLOW+1]
	if (overflow_x == SB_OVERFLOW_INFINITE) sx = (cw - w) / 2
	if (overflow_y == SB_OVERFLOW_INFINITE) sy = (ch - h) / 2
	sx = max(0, min(sx, cw - w))
	sy = max(0, min(sy, ch - h))
	let psx = sx / (cw - w)
	let psy = sy / (ch - h)
	let pw = w / cw
	let ph = h / ch
	let thickness = ui.scrollbar_thickness * dpr
	let thickness_active = state ? ui.scrollbar_thickness_active * dpr : thickness
	let visible, tx, ty, tw, th
	let h_visible = pw < 1 && (
			   overflow_x == SB_OVERFLOW_SCROLL
			|| overflow_x == SB_OVERFLOW_AUTO
			|| overflow_x == SB_OVERFLOW_INFINITE
		)
	let v_visible = ph < 1 && (
			   overflow_y == SB_OVERFLOW_SCROLL
			|| overflow_y == SB_OVERFLOW_AUTO
			|| overflow_y == SB_OVERFLOW_INFINITE
		)
	let both_visible = h_visible && v_visible && 1 || 0
	let bar_min_len = round(2 * font_size_normal)
	if (!axis) {
		visible = h_visible
		if (visible) {
			let bw = w - both_visible * thickness
			tw = max(min(bar_min_len, bw), pw * bw)
			th = thickness_active
			tx = psx * (bw - tw)
			ty = h - th
		}
	} else {
		visible = v_visible
		if (visible) {
			let bh = h - both_visible * thickness
			th = max(min(bar_min_len, bh), ph * bh)
			tw = thickness_active
			ty = psy * (bh - th)
			tx = w - tw
		}
	}
	r[0] = visible
	r[1] = x + tx
	r[2] = y + ty
	r[3] = tw
	r[4] = th
	return r
}
}

draw_end[CMD_SCROLLBOX] = function(a, i) {

	cx.restore()

	for (let axis = 0; axis < 2; axis++) {

		let state = (a[i+SB_STATE] >> (2 * axis)) & 3
		state = state == 2 && 'active' || state && 'hover' || null

		let [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis, state)

		if (!visible)
			continue

		cx.beginPath()
		cx.rect(tx, ty, tw, th)
		cx.fillStyle = color_css('scrollbar', state)
		cx.fill()

	}
}

hittest[CMD_SCROLLBOX] = function(a, i, recs) {
	let id = a[i+SB_ID]

	// fast-test the outer box since we're clipping the contents.
	if (!hit_box(a, i))
		return

	hit_template(a, i)

	// test the scrollbars
	for (let axis = 0; axis < 2; axis++) {
		let [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis, 'hover')
		if (!visible)
			continue
		if (!hit_rect(tx, ty, tw, th))
			continue
		set_hit(id+'.scrollbar'+axis)
		set_hit(id)
		return true
	}

	// test the children
	hit_children(a, i, recs)

	set_hit(id)

	return true
}

//// POPUP -------------------------------------------------------------------

const POPUP_START             = 0
const POPUP_END               = 1
const POPUP_CENTER            = 2
const POPUP_ANCHOR_MASK       = 3
const POPUP_SIDE_LR           = 4
const POPUP_SIDE_TB           = 8
const POPUP_SIDE_INNER        = 16
const POPUP_STRETCH           = 32
const POPUP_SIDE_LEFT         = POPUP_SIDE_LR + POPUP_START
const POPUP_SIDE_RIGHT        = POPUP_SIDE_LR + POPUP_END
const POPUP_SIDE_TOP          = POPUP_SIDE_TB + POPUP_START
const POPUP_SIDE_BOTTOM       = POPUP_SIDE_TB + POPUP_END
const POPUP_SIDE_INNER_LEFT   = POPUP_SIDE_INNER + POPUP_SIDE_LEFT
const POPUP_SIDE_INNER_RIGHT  = POPUP_SIDE_INNER + POPUP_SIDE_RIGHT
const POPUP_SIDE_INNER_TOP    = POPUP_SIDE_INNER + POPUP_SIDE_TOP
const POPUP_SIDE_INNER_BOTTOM = POPUP_SIDE_INNER + POPUP_SIDE_BOTTOM
const POPUP_SIDE_INNER_CENTER =
	POPUP_SIDE_INNER + POPUP_SIDE_LR + POPUP_CENTER

let parsed_stretch = 0
function popup_parse_stretch(s) {
	parsed_stretch = POPUP_STRETCH
	if (s.endsWith('-stretch'))
		return s.slice(0, -8)
	if (s.length > 1 && s.endsWith('s'))
		return s.slice(0, -1)
	parsed_stretch = 0
	return s
}

function popup_parse_side(s) {
	let side = popup_parse_side_name(popup_parse_stretch(s))
	assert(!parsed_stretch || (side & POPUP_SIDE_INNER),
		'stretch on an outer side ', s)
	return side + parsed_stretch
}

function popup_parse_side_name(s) {
	if (s == '['           ) return POPUP_SIDE_LEFT
	if (s == ']'           ) return POPUP_SIDE_RIGHT
	if (s == 'l'           ) return POPUP_SIDE_LEFT
	if (s == 'r'           ) return POPUP_SIDE_RIGHT
	if (s == 't'           ) return POPUP_SIDE_TOP
	if (s == 'b'           ) return POPUP_SIDE_BOTTOM
	if (s == 'ic'          ) return POPUP_SIDE_INNER_CENTER
	if (s == 'il'          ) return POPUP_SIDE_INNER_LEFT
	if (s == 'ir'          ) return POPUP_SIDE_INNER_RIGHT
	if (s == 'it'          ) return POPUP_SIDE_INNER_TOP
	if (s == 'ib'          ) return POPUP_SIDE_INNER_BOTTOM
	if (s == 'left'        ) return POPUP_SIDE_LEFT
	if (s == 'right'       ) return POPUP_SIDE_RIGHT
	if (s == 'top'         ) return POPUP_SIDE_TOP
	if (s == 'bottom'      ) return POPUP_SIDE_BOTTOM
	if (s == 'inner-center') return POPUP_SIDE_INNER_CENTER
	if (s == 'inner-left'  ) return POPUP_SIDE_INNER_LEFT
	if (s == 'inner-right' ) return POPUP_SIDE_INNER_RIGHT
	if (s == 'inner-top'   ) return POPUP_SIDE_INNER_TOP
	if (s == 'inner-bottom') return POPUP_SIDE_INNER_BOTTOM
	assert(false, 'invalid popup side ', s)
}

function popup_parse_align(s) {
	if (s == '[]'     ) s = '[s'
	if (s == 's'      ) s = '[s'
	if (s == 'stretch') s = 'start-stretch'
	return popup_parse_align_name(popup_parse_stretch(s)) + parsed_stretch
}

function popup_parse_align_name(s) {
	if (s == 'c'      ) return POPUP_CENTER
	if (s == '['      ) return POPUP_START
	if (s == ']'      ) return POPUP_END
	if (s == 'center' ) return POPUP_CENTER
	if (s == 'start'  ) return POPUP_START
	if (s == 'end'    ) return POPUP_END
	assert(false, 'invalid align ', s)
}

const POPUP_FIT_CHANGE_SIDE = 1
const POPUP_FIT_CONSTRAIN   = 2
const POPUP_SOLID           = 4

function popup_parse_flags(s) {
	return (
		(s.includes('change_side') ? POPUP_FIT_CHANGE_SIDE : 0) |
		(s.includes('constrain'  ) ? POPUP_FIT_CONSTRAIN   : 0) |
		(s.includes('solid'      ) ? POPUP_SOLID           : 0)
	)
}

const POPUP_ID         = FR      // because fr is not used
const POPUP_SIDE       = ALIGN   // because align is not used
const POPUP_ALIGN      = ALIGN+1 // because valign is not used
const POPUP_LAYER_NAME = BOX_CT_ARGS+0 // establishes the layer band
const POPUP_Z_INDEX    = BOX_CT_ARGS+1 // z_index in its layer band
const POPUP_TARGET_I   = BOX_CT_ARGS+2
const POPUP_FLAGS      = BOX_CT_ARGS+3
const POPUP_SIDE_REAL  = BOX_CT_ARGS+4
const POPUP_OX         = BOX_CT_ARGS+5 // offset x,y from where side+align put it

const CMD_POPUP = cmd_ct('popup')

// ox, oy shift the popup from its final position, in screen direction.
// margins put a gap between the popup and its target.
ui.popup = function(
	id, layer, target, side, align, min_w, min_h, flags, z_index, ox, oy
) {
	layer = layer ? assert(layer_map[layer]) : layer_base
	let target_i = target == 'screen' ? 0
		: !target || target == 'container' ? ui.ct_i()
		: assert(num(target), 'invalid target ', target)
	side  = popup_parse_side  (side  ?? 't')
	align = popup_parse_align (align ?? 'c')
	flags = popup_parse_flags (flags ?? '')

	// the hit phase gives a solid popup the clicks that land on its own box,
	// so a click on its padding must not clear the focus from its contents.
	if (id && (flags & POPUP_SOLID))
		ui.keep_focus(id)

	let i = ui_cmd_box_ct_begin(CMD_POPUP,
		null, // fr -> id
		null, // align -> side
		null, // valign -> align
		min_w, min_h,
	)
	// BOX_CT_ARGS+0
	a[n++] = layer.name; a[n++] = z_index ?? 0
	a[n++] = target_i; a[n++] = flags
	a[n++] = side // side_real
	a[n++] = ox ?? 0; a[n++] = oy ?? 0
	ui_cmd_box_ct_end(i)
	if (target_i)
		a[i+POPUP_TARGET_I] -= i // make relative
	a[i+POPUP_ID   ] = id
	a[i+POPUP_SIDE ] = side
	a[i+POPUP_ALIGN] = align
	return i
}
ui.end_popup = function() { ui.end(CMD_POPUP) }

function set_z_index(a, i, z_index) {
	assert(a[i-1] == CMD_POPUP)
	a[i+POPUP_Z_INDEX] = z_index
}
ui.set_z_index = set_z_index

measure[CMD_POPUP] = ct_stack_push

measure_end[CMD_POPUP] = function(a, i, axis) {
	a[i+2+axis] = max(a[i+2+axis], a[i+0+axis]) // apply own min_w|h
	a[i+2+axis] += spacings(a, i, axis)
	// popups don't affect their target's layout so no add_ct_min_wh() call.
}

let screen_margin = 10

// NOTE: popup positioning is done later in the translation phase.
// NOTE: sw is always 0 because popups have fr=0, so we don't use it.
position[CMD_POPUP] = function(a, i, axis, sx, sw) {

	let target_i = a[i+POPUP_TARGET_I]
	let side     = a[i+POPUP_SIDE]
	let align    = a[i+POPUP_ALIGN]
	if (target_i) target_i += i // make absolute
	let side_axis = (side & POPUP_SIDE_LR) ? 0 : 1
	if ((axis == side_axis ? side : align) & POPUP_STRETCH) {
		if (!target_i) {
			a[i+2+axis] = axis ? screen_h : screen_w
		} else {
			// stretch to the target's border rect, which is the rect that
			// the popup is placed against in the translate phase.
			let ct_w = a[target_i+2+axis]
				+ a[target_i+PX1+axis]
				+ a[target_i+PX2+axis]
			a[i+2+axis] = max(a[i+2+axis], ct_w)
		}
	}

	let w = inner_w(a, i, axis, a[i+2+axis])
	a[i+2+axis] = w

	// a popup's children are positioned from 0 here, so a scroll-to-view
	// request can't cross into the popup: revealing a box inside it means
	// revealing the box it is targeted at, which the popup follows. an
	// untargeted popup is placed against the screen: drop the request.
	let sv_i = scroll_to_view_i // marked box outside this popup
	scroll_to_view_i = null
	position_children_stacked(a, i, axis, 0, w)
	scroll_to_view_i = scroll_to_view_i ? target_i : sv_i
}

{
let tx1, ty1, tx2, ty2

// a popup's target rect is the target's border rect.
function get_popup_target_rect(a, i) {

	let ct_i = a[i+POPUP_TARGET_I]

	if (!ct_i) {

		tx1 = 0
		ty1 = 0
		tx2 = screen_w
		ty2 = screen_h

	} else {

		ct_i += i // make absolute

		let px1 = a[ct_i+PX1+0]
		let py1 = a[ct_i+PX1+1]
		let px2 = a[ct_i+PX2+0]
		let py2 = a[ct_i+PX2+1]

		tx1 = a[ct_i+0] - px1
		ty1 = a[ct_i+1] - py1
		tx2 = a[ct_i+2] + tx1 + px1 + px2
		ty2 = a[ct_i+3] + ty1 + py1 + py2

	}

}

function popup_axis_pos(anchor, is_inner, t1, t2, size) {
	if (anchor == POPUP_START)
		return is_inner ? t1 : t1 - size
	if (anchor == POPUP_END)
		return is_inner ? t2 - size : t2
	return t1 + round((t2 - t1 - size) / 2)
}

let x, y
function position_popup(w, h, side, align) {

	let side_anchor  = side  & POPUP_ANCHOR_MASK
	let align_anchor = align & POPUP_ANCHOR_MASK
	let is_inner = side & POPUP_SIDE_INNER

	if (side & POPUP_SIDE_LR) {
		x = popup_axis_pos(side_anchor, is_inner, tx1, tx2, w)
		y = popup_axis_pos(align_anchor, true, ty1, ty2, h)
	} else {
		x = popup_axis_pos(align_anchor, true, tx1, tx2, w)
		y = popup_axis_pos(side_anchor, is_inner, ty1, ty2, h)
	}

}

translate[CMD_POPUP] = function(a, i) {

	let bw = screen_w
	let bh = screen_h

	get_popup_target_rect(a, i)

	let spx   = spacings(a, i, 0)
	let spy   = spacings(a, i, 1)
	let w     = a[i+2+0] + spx
	let h     = a[i+2+1] + spy
	let side  = a[i+POPUP_SIDE]
	let align = a[i+POPUP_ALIGN]
	let flags = a[i+POPUP_FLAGS]

	position_popup(w, h, side, align)

	if (flags & POPUP_FIT_CHANGE_SIDE) {

		// if popup doesn't fit the screen, first try to change its side
		// or alignment and rebuild, and if that doesn't work, its offset.

		let d = screen_margin
		let out_x1 = x < d
		let out_y1 = y < d
		let out_x2 = x + w > (bw - d)
		let out_y2 = y + h > (bh - d)

		let side0 = side
		let anchor = side & POPUP_ANCHOR_MASK
		let is_inner = side & POPUP_SIDE_INNER
		if (anchor != POPUP_CENTER) {
			let is_start_edge = is_inner
				? anchor == POPUP_END
				: anchor == POPUP_START
			let out = (side & POPUP_SIDE_LR)
				? (is_start_edge ? out_x1 : out_x2)
				: (is_start_edge ? out_y1 : out_y2)
			if (out)
				side ^= 1
		}

		if (side != side0) {
			position_popup(w, h, side, align)
			a[i+POPUP_SIDE_REAL] = side
		}

	}

	// step from the margin rect to the border rect, which is the rect that
	// the user sees and thus the one to keep on screen. the popup's own
	// offset moves it, its margins are the gap left around it.
	x += a[i+POPUP_OX+0] + a[i+MX1+0]
	y += a[i+POPUP_OX+1] + a[i+MX1+1]

	// if nothing else works, adjust the offset to fit the screen.
	if (flags & POPUP_FIT_CONSTRAIN) {
		let d = screen_margin
		let border_w = w - a[i+MX1+0] - a[i+MX2+0]
		let border_h = h - a[i+MX1+1] - a[i+MX2+1]
		let ox1 = min(0, x - d)
		let oy1 = min(0, y - d)
		let ox2 = max(0, x + border_w - (bw - d))
		let oy2 = max(0, y + border_h - (bh - d))
		let cdx = ox1 ? ox1 : ox2 // constrain correction
		let cdy = oy1 ? oy1 : oy2
		x -= cdx
		y -= cdy
		// publish the offset that fits, so that a widget that keeps its
		// popup's offset keeps one that it can actually be placed at.
		let id = a[i+POPUP_ID]
		if (id) {
			ui.state(id).ox = a[i+POPUP_OX+0] - cdx
			ui.state(id).oy = a[i+POPUP_OX+1] - cdy
		}
	}

	x += a[i+PX1+0]
	y += a[i+PX1+1]

	a[i+0] = x
	a[i+1] = y

	translate_children(a, i, x, y)

}

let out = [0, 0, 0, 0]
ui.popup_target_rect = function(a, i) {
	get_popup_target_rect(a, i)
	out[0] = tx1
	out[1] = ty1
	out[2] = tx2
	out[3] = ty2
	return out
}

}

register[CMD_END] = function(a, end_i) {
	let ct_i = end_i+a[end_i]
	if (
		current_popups.popup_rec == a &&
		current_popups.popup_i == ct_i
	)
		current_popups = current_popups.parent_popups
}

register[CMD_POPUP] = function(a, i, rec_i) {
	let layer_name = a[i+POPUP_LAYER_NAME]
	let layer = layer_map[layer_name]
	a[i+POPUP_LAYER_NAME] = 0
	let z_index = a[i+POPUP_Z_INDEX]
	assert(z_index >= 0 && z_index < z_index_band,
		'z_index out of range: ', z_index)
	let inner_popups = layer.modal ? popups_freelist.alloc() : null
	add_popup(layer.root ? root_popups : current_popups,
		layer.z_index * z_index_band + z_index,
		rec_i, i, inner_popups)
	if (inner_popups) {
		// hack: although inner_popus is serialized, its properties are not
		// because it's an array.
		inner_popups.parent_popups = current_popups
		inner_popups.popup_i = i
		inner_popups.popup_rec = a
		current_popups = inner_popups
	}
}

draw[CMD_POPUP] = function(a, i) {
	if (a != current_popup_rec || i != current_popup_ct_i)
		return true
}

hittest[CMD_POPUP] = function(a, i, recs) {
	if (a != current_popup_rec || i != current_popup_ct_i)
		return
	let solid = a[i+POPUP_FLAGS] & POPUP_SOLID
	if (hit_children(a, i, recs)) {
		set_hit(a[i+POPUP_ID])
		return true
	}
	if (solid && hit_box(a, i)) {
		set_hit(a[i+POPUP_ID])
		return true
	}
}

//// TOOLTIP SHAPE -----------------------------------------------------------

function tooltip_tip_cut_center(x1, x2, align, r, d) {
	if (align == POPUP_START)
		return x1+r + d/2
	else if (align == POPUP_END)
		return x2-r - d/2
	else if (align == POPUP_CENTER)
		return x2-r - (x2-x1-2*r)/2
}
function tooltip_path(cx, x1, y1, x2, y2, side, tx, ty, b1x, b1y, b2x, b2y, r, d) {
	cx.beginPath()
	// left side
	cx.moveTo(x1, y2-r)
	if (side == POPUP_SIDE_RIGHT) {
		cx.lineTo(x1, b2y)
		cx.lineTo(tx, ty)
		cx.lineTo(x1, b1y)
	}
	cx.lineTo(x1, y1+r); if (r) cx.arcTo(x1, y1, x1+r, y1, r)
	// top side
	if (side == POPUP_SIDE_BOTTOM) {
		cx.lineTo(b1x, y1)
		cx.lineTo(tx, ty)
		cx.lineTo(b2x, y1)
	}
	cx.lineTo(x2-r, y1); if (r) cx.arcTo(x2, y1, x2, y1+r, r)
	// right side
	if (side	== POPUP_SIDE_LEFT) {
		cx.lineTo(x2, b1y)
		cx.lineTo(tx, ty)
		cx.lineTo(x2, b2y)
	}
	cx.lineTo(x2, y2-r); if (r) cx.arcTo(x2, y2, x2-r, y2, r)
	// bottom side
	if (side == POPUP_SIDE_TOP) {
		cx.lineTo(b2x, y2)
		cx.lineTo(tx, ty)
		cx.lineTo(b1x, y2)
	}
	cx.lineTo(x1+r, y2); if (r) cx.arcTo(x1, y2, x1, y2-r, r)
}

const BB_TOOLTIP_CT_I = 0

const CMD_BB_TOOLTIP = cmd('bb_tooltip')

ui.bb_tooltip = function(
	bg_color, bg_color_state, border_color, border_color_state, border_radius
) {
	let ct_i = ui.ct_i()
	let rel_ct_i = ui.rel_ct_i()
	assert(a[ct_i-1] == CMD_POPUP, 'bb_tooltip container must be a popup')
	let i = ui_cmd_begin(CMD_BB_TOOLTIP)
	a[n++] = rel_ct_i
	a[n++] = bg_color ?? 0
	a[n++] = parse_state(bg_color_state)
	a[n++] = border_color ?? 0
	a[n++] = parse_state(border_color_state)
	a[n++] = round((border_radius ?? 0) * 128)
	ui_cmd_end(i)
	return i
}

draw[CMD_BB_TOOLTIP] = function(a, i) {
	let ct_i = i+a[i+BB_TOOLTIP_CT_I]

	let px1 = a[ct_i+PX1+0]
	let py1 = a[ct_i+PX1+1]
	let px2 = a[ct_i+PX2+0]
	let py2 = a[ct_i+PX2+1]
	let x   = a[ct_i+0] - px1
	let y   = a[ct_i+1] - py1
	let w   = a[ct_i+2] + px1 + px2
	let h   = a[ct_i+3] + py1 + py2

	let bg_color           = a[i+1]
	let bg_color_state     = a[i+2]
	let border_color       = a[i+3]
	let border_color_state = a[i+4]
	let r                  = a[i+5] / 128 // border radius

	let side  = a[ct_i+POPUP_SIDE_REAL] & ~POPUP_STRETCH
	let align = a[ct_i+POPUP_ALIGN] & POPUP_ANCHOR_MASK

	let T = POPUP_SIDE_TOP
	let B = POPUP_SIDE_BOTTOM
	let L = POPUP_SIDE_LEFT
	let R = POPUP_SIDE_RIGHT
	let S = POPUP_START
	let E = POPUP_END

	let m = ui.sp2() // margin away from the target's corners.
	let d = ui.sp2() // tooltip's tip base width.

	// find tooltip tip's tip point.
	let [tx1, ty1, tx2, ty2] = ui.popup_target_rect(a, ct_i)
	let tx, ty
	if (side == T && align == S) {
		tx = tx1 + m
		ty = ty1
	} else if (side == L && align == S) {
		tx = tx1
		ty = ty1 + m
	} else if (side == T && align == E) {
		tx = tx2 - m
		ty = ty1
	} else if (side == R && align == S) {
		tx = tx2
		ty = ty1 + m
	} else if (side == B && align == S) {
		tx = tx1 + m
		ty = ty2
	} else if (side == L && align == E) {
		tx = tx1
		ty = ty2 - m
	} else if (side == B && align == E) {
		tx = tx2 - m
		ty = ty2
	} else if (side == R && align == E) {
		tx = tx2
		ty = ty2 - m
	} else if (align == POPUP_CENTER) {
		if (side & POPUP_SIDE_TB) {
			tx = tx1 + (tx2 - tx1) / 2
			ty = side == T ? ty1 : ty2
		} else {
			ty = ty1 + (ty2 - ty1) / 2
			tx = side == L ? tx1 : tx2
		}
	}

	tx += a[ct_i+POPUP_OX+0]
	ty += a[ct_i+POPUP_OX+1]

	// find tooltip tip's base points.
	let bx, by // tip's center point between its two base points.
	let b1x, b1y
	let b2x, b2y
	let x1 = x
	let y1 = y
	let x2 = x1 + w
	let y2 = y1 + h
	if (side & POPUP_SIDE_LR) {
		bx = side == L ? x2 : x1
		by = clamp(ty, y1+r + d/2, y2-r - d/2)
		b1x = bx
		b2x = bx
		b1y = by - d/2
		b2y = by + d/2
	} else {
		by = side == T ? y2 : y1
		bx = clamp(tx, x1+r + d/2, x2-r - d/2)
		b1y = by
		b2y = by
		b1x = bx - d/2
		b2x = bx + d/2
	}

	// align tooltip tip's tip point to its base' center point.
	if (side & POPUP_SIDE_LR) {
		ty = clamp(by, ty1+d, ty2-d)
	} else {
		tx = clamp(bx, tx1+d, tx2-d)
	}

	// in case `m` was too big...
	tx = clamp(tx, tx1, tx2)
	ty = clamp(ty, ty1, ty2)
	if (side == T)
		ty = max(ty, y2)
	else if (side == B)
		ty = min(ty, y1)
	else if (side == L)
		tx = max(tx, x2)
	else if (side == R)
		tx = min(tx, x1)

	if (bg_color) {
		set_bg_color(bg_color, bg_color_state)
		tooltip_path(cx, x, y, x + w, y + h,
			side, tx, ty, b1x, b1y, b2x, b2y, r, d)
		cx.fill()
	}
	if (cur_shadow)
		reset_shadow()
	if (border_color) {
		cx.strokeStyle = color_css(border_color, border_color_state)
		cx.lineCap = 'square'
		tooltip_path(cx, x + .5, y + .5, x + w - .5, y + h - .5,
			side, tx, ty, b1x, b1y, b2x, b2y, r, d)
		cx.stroke()
		cx.lineCap = 'butt'
	}

}

//// BOX SHADOW --------------------------------------------------------------

ui.shadow_def = function(theme, name, x, y, blur, h, s, L, a, inset) {
	themes[theme].shadow[name] = [
		x, y, blur,
		hsl(h, s, L, a), h, s, L, a, inset
	]
}

//               theme    name        x   y  bl  h  s  L  a
// ---------------------------------------------------------------------------
ui.shadow_def('light', 'tooltip' ,  2,  2,  9, 0, 0, 0, 0x44 / 0xff)
ui.shadow_def('light', 'toolbox' ,  1,  1,  4, 0, 0, 0, 0xaa / 0xff)
ui.shadow_def('light', 'menu'    ,  0,  5, 16, 0, 0, 0, 0x33 / 0xff)
ui.shadow_def('light', 'button'  ,  0,  0,  2, 0, 0, 0, 0x11 / 0xff)
ui.shadow_def('light', 'button-active', 2, 3, 8, 0, 0, 0, 0x44 / 0xff, true)
ui.shadow_def('light', 'thumb'   ,  0,  0,  2, 0, 0, 0, 0xbb / 0xff)
ui.shadow_def('light', 'modal'   ,  2,  5, 10, 0, 0, 0, 0x88 / 0xff)
ui.shadow_def('light', 'picker'  ,  0,  5, 10, 0, 0, 0, 0x22 / 0xff) // large fuzzy shadow

ui.shadow_def('dark', 'tooltip' ,  2,  2,  9, 0, 0, 0, 0x44 / 0xff)
ui.shadow_def('dark', 'toolbox' ,  1,  1,  4, 0, 0, 0, 0xaa / 0xff)
ui.shadow_def('dark', 'menu'    ,  1,  1,  9, 0, 0, 0, 0xff / 0xff)
ui.shadow_def('dark', 'button'  ,  0,  0,  2, 0, 0, 0, 0xff / 0xff)
ui.shadow_def('dark', 'button-active', 1, 3, 8, 0, 0, 0, 0xaa / 0xff, true)
ui.shadow_def('dark', 'thumb'   ,  1,  1,  2, 0, 0, 0, 0xaa / 0xff)
ui.shadow_def('dark', 'modal'   ,  2,  5, 10, 0, 0, 0, 0x88 / 0xff)
ui.shadow_def('dark', 'picker'  ,  0,  2, 15, 0, 0, 0, .8)

const CMD_SHADOW = cmd('shadow')

ui.shadow = function(s) {
	assert(isstr(s))
	let i = ui_cmd_begin(CMD_SHADOW)
	a[n++] = s
	ui_cmd_end(i)
}

const SHADOW_INSET = 8

let cur_shadow

function set_drop_shadow(st) {
	cx.shadowOffsetX = st[0]
	cx.shadowOffsetY = st[1]
	cx.shadowBlur    = st[2]
	cx.shadowColor   = st[3]
}

ui.set_shadow = function(s) {
	let st = assert(theme.shadow[s], 'unknown shadow ', s)
	assert(!st[SHADOW_INSET], 'inset shadow outside bb: ', s)
	set_drop_shadow(st)
	cur_shadow = st
}

draw[CMD_SHADOW] = function(a, i) {
	let s = a[i+0]
	let st = assert(theme.shadow[s], 'unknown shadow ', s)
	if (!st[SHADOW_INSET])
		set_drop_shadow(st)
	cur_shadow = st
}

function draw_inset_shadow(st, x, y, w, h, sides, r) {
	let m = st[2] + max(abs(st[0]), abs(st[1])) + 1
	cx.save()
	bg_path(cx, x, y, x + w, y + h, sides, r)
	cx.clip()
	bg_path(cx, x, y, x + w, y + h, sides, r)
	cx.rect(x - m, y - m, w + 2*m, h + 2*m)
	set_drop_shadow(st)
	cx.fillStyle = '#000'
	cx.fill('evenodd')
	cx.restore()
}

function reset_shadow() {
	cx.shadowBlur    = 0
	cx.shadowOffsetX = 0
	cx.shadowOffsetY = 0
	cur_shadow = null
}

//// BACKGROUND & BORDER -----------------------------------------------------

const BORDER_SIDE_T = 1
const BORDER_SIDE_R = 2
const BORDER_SIDE_B = 4
const BORDER_SIDE_L = 8
const BORDER_SIDE_ALL = 15

function parse_border_sides(s) {
	if (!s) // 0, null, undefined
		return 0
	if (s == true || s == 'all') // true, 1, 'all'
		return BORDER_SIDE_ALL
	let b = (
		(s.includes('l') ? BORDER_SIDE_L : 0) |
		(s.includes('r') ? BORDER_SIDE_R : 0) |
		(s.includes('t') ? BORDER_SIDE_T : 0) |
		(s.includes('b') ? BORDER_SIDE_B : 0)
	)
	if (s.startsWith('-'))
		b = ~b & BORDER_SIDE_ALL
	return b
}

const BB_CT_I = 0

const CMD_BB = cmd('bb') // border-background

let border_dashes = {
	dots   : [1, 1],
	dashes : [2, 6],
}

ui.bb = function(
	bg_color, bg_color_state,
	border_sides, border_color, border_color_state, border_radius, border_dash
) {
	if (border_dash)
		assert(border_dashes[border_dash], 'invalid border dash ', border_dash)
	let i = ui_cmd_begin(CMD_BB)
	a[n++] = ui.ct_i() - i
	a[n++] = bg_color ?? 0
	a[n++] = parse_state(bg_color_state)
	a[n++] = parse_border_sides(border_sides)
	a[n++] = border_color ?? 0
	a[n++] = parse_state(border_color_state)
	a[n++] = round((border_radius ?? 0) * 128)
	a[n++] = border_dash ?? null
	ui_cmd_end(i)
}
ui.bg = function(bg_color, bg_color_state) {
	return ui.bb(bg_color, bg_color_state)
}
ui.border = function(
	border_sides, border_color, border_color_state, border_radius, border_dash
) {
	return ui.bb(null, null, border_sides ?? true, border_color,
		border_color_state, border_radius, border_dash)
}

let border_paths
{
function T  (cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y1); cx.lineTo(x2, y1) }
function R  (cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y1); cx.lineTo(x2, y2) }
function B  (cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y2); cx.lineTo(x1, y2) }
function L  (cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y2); cx.lineTo(x1, y1) }
function TB (cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y1); cx.lineTo(x2, y1); cx.moveTo(x2, y2); cx.lineTo(x1, y2) }
function RL (cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y1); cx.lineTo(x2, y2); cx.moveTo(x1, y2); cx.lineTo(x1, y1) }
function TR (cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y1); cx.lineTo(x2-r, y1); if (r) cx.arcTo(x2, y1, x2, y1+r, r); cx.lineTo(x2, y2) }
function RB (cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y1); cx.lineTo(x2, y2-r); if (r) cx.arcTo(x2, y2, x2-r, y2, r); cx.lineTo(x1, y2) }
function BL (cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y2); cx.lineTo(x1+r, y2); if (r) cx.arcTo(x1, y2, x1, y2-r, r); cx.lineTo(x1, y1) }
function LT (cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y2); cx.lineTo(x1, y1+r); if (r) cx.arcTo(x1, y1, x1+r, y1, r); cx.lineTo(x2, y1) }
function TRB(cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y1); cx.lineTo(x2-r, y1); if (r) cx.arcTo(x2, y1, x2, y1+r, r); cx.lineTo(x2, y2-r); if (r) cx.arcTo(x2, y2, x2-r, y2, r); cx.lineTo(x1, y2) }
function RBL(cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y1); cx.lineTo(x2, y2-r); if (r) cx.arcTo(x2, y2, x2-r, y2, r); cx.lineTo(x1+r, y2); if (r) cx.arcTo(x1, y2, x1, y2-r, r); cx.lineTo(x1, y1) }
function BLT(cx, x1, y1, x2, y2, r) { cx.moveTo(x2, y2); cx.lineTo(x1+r, y2); if (r) cx.arcTo(x1, y2, x1, y2-r, r); cx.lineTo(x1, y1+r); if (r) cx.arcTo(x1, y1, x1+r, y1, r); cx.lineTo(x2, y1) }
function LTR(cx, x1, y1, x2, y2, r) { cx.moveTo(x1, y2); cx.lineTo(x1, y1+r); if (r) cx.arcTo(x1, y1, x1+r, y1, r); cx.lineTo(x2-r, y1); if (r) cx.arcTo(x2, y1, x2, y1+r, r); cx.lineTo(x2, y2) }

border_paths = [noop, T, R, TR, B, TB, RB, TRB, L, LT, RL, LTR, BL, BLT, RBL]
}

let c2d = CanvasRenderingContext2D.prototype
if (!c2d.roundRect) { // Firefox doesn't have it
	c2d.roundRect = function(x1, y1, w, h, r) {
		let x2 = x1 + w
		let y2 = y1 + h
		r = min(r, round(min(w, h) / 2))
		cx.moveTo(x2-r, y1); if (r) cx.arcTo(x2, y1, x2, y1+r, r)
		cx.lineTo(x2, y2-r); if (r) cx.arcTo(x2, y2, x2-r, y2, r)
		cx.lineTo(x1+r, y2); if (r) cx.arcTo(x1, y2, x1, y2-r, r)
		cx.lineTo(x1, y1+r); if (r) cx.arcTo(x1, y1, x1+r, y1, r)
		cx.closePath()
	}
}

function bg_path(cx, x1, y1, x2, y2, sides, r) {
	cx.beginPath()
	if (sides == BORDER_SIDE_ALL) {
		if (!r)
			cx.rect(x1, y1, x2-x1, y2-y1)
		else
			cx.roundRect(x1, y1, x2-x1, y2-y1, r)
	} else {
		r = min(r, round(min(x2-x1, y2-y1) / 2))
		let rlb = (sides & BORDER_SIDE_L) && (sides & BORDER_SIDE_B) && r || 0
		let rlt = (sides & BORDER_SIDE_L) && (sides & BORDER_SIDE_T) && r || 0
		let rrt = (sides & BORDER_SIDE_R) && (sides & BORDER_SIDE_T) && r || 0
		let rrb = (sides & BORDER_SIDE_R) && (sides & BORDER_SIDE_B) && r || 0
		cx.moveTo(x1, y2-rlb);
		cx.lineTo(x1, y1+rlt); if (rlt) cx.arcTo(x1, y1, x1+rlt, y1, rlt);
		cx.lineTo(x2-rrt, y1); if (rrt) cx.arcTo(x2, y1, x2, y1+rrt, rrt);
		cx.lineTo(x2, y2-rrb); if (rrb) cx.arcTo(x2, y2, x2-rrb, y2, rrb);
		cx.lineTo(x1+rlb, y2); if (rlb) cx.arcTo(x1, y2, x1, y2-rlb, rlb);
	}
}

function border_path(cx, x1, y1, x2, y2, sides, r) {
	cx.beginPath()
	if (sides == BORDER_SIDE_ALL)
		if (!r)
			cx.rect(x1, y1, x2-x1, y2-y1)
		else
			cx.roundRect(x1, y1, x2-x1, y2-y1, r)
	else {
		r = min(r, round(min(x2-x1, y2-y1) / 2))
		border_paths[sides](cx, x1, y1, x2, y2, r)
	}
}

draw[CMD_BB] = function(a, i) {
	let ct_i = i+a[i+BB_CT_I]

	let px1 = a[ct_i+PX1+0]
	let py1 = a[ct_i+PX1+1]
	let px2 = a[ct_i+PX2+0]
	let py2 = a[ct_i+PX2+1]

	let x = a[ct_i+0] - px1
	let y = a[ct_i+1] - py1
	let w = a[ct_i+2] + px1 + px2
	let h = a[ct_i+3] + py1 + py2

	let bg_color           = a[i+1]
	let bg_color_state     = a[i+2]
	let border_sides       = a[i+3]
	let border_color       = a[i+4]
	let border_color_state = a[i+5]
	let border_radius      = a[i+6] / 128
	let border_dash        = a[i+7]

	if (bg_color) {
		set_bg_color(bg_color, bg_color_state)
		bg_path(cx, x, y, x + w, y + h, border_sides, border_radius)
		cx.fill()
		if (cur_shadow?.[SHADOW_INSET])
			draw_inset_shadow(cur_shadow, x, y, w, h, border_sides, border_radius)
	}
	if (cur_shadow)
		reset_shadow()
	if (border_sides && border_color) {
		cx.strokeStyle = color_css(border_color, border_color_state)
		cx.lineCap = 'square'
		border_path(cx, x+.5, y+.5, x+w-.5, y+h-.5, border_sides, border_radius)
		if (border_dash)
			cx.setLineDash(border_dashes[border_dash])
		cx.stroke()
		cx.lineCap = 'butt'
		if (border_dash)
			cx.setLineDash(empty_array)
	}
}

hittest[CMD_BB] = function(a, i) {
	let bg_color = a[i+1]
	if (!bg_color)
		return
	let ct_i = i+a[i+BB_CT_I]
	if (hit_box(a, ct_i)) {
		hit_template(a, ct_i)
		return true
	}
}

//// FOCUS RING --------------------------------------------------------------

ui.focus_ring = function(id) {
	if (!ui.focused_by_key)
		return
	if (id && !ui.focused(id))
		return
	ui.m(-2)
	ui.popup('', 'overlay', null, 'ics', 's')
		ui.bb(null, null, 1, 'max')
	ui.end_popup()
}

//// TEXT PROPERTIES ---------------------------------------------------------

/*

DEFINING FONTS

	ui.load_font   (name, url, desc)      load a font
	ui.font_alias  (alias, name)          alias a loaded font

USER API, affects only the next ui.text() call.

	ui.color           (color, [color_state])
	ui.font            (font|alias)
	ui.fs | font_size  (size)
	ui.font_weight     (weight)
	ui.bold            ()
	ui.nobold          ()
	ui.lg | line_gap   (gap)
	ui.xsmall          ()
	ui.small           ()
	ui.smaller         ()
	ui.large           ()
	ui.xlarge          ()

*/

ui.font_size_normal = 12
ui.default_font  = 'Arial'

let text_flags = 0
let text_color, text_color_state
let text_font, text_font_size, text_font_weight, text_line_gap

function text_flags_check() {
	assert(!text_flags, 'text property set with no ui.text() after it')
}

ui.color = function(s, state) {
	text_color = s
	text_color_state = state
	text_flags &= ~(TEXT_COLOR | TEXT_COLOR_STATE)
	if (s && s != 'text')
		text_flags |= TEXT_COLOR
	if (state)
		text_flags |= TEXT_COLOR_STATE
}

// ui.font() looks this up first; a name that's not in here is used as-is.
let font_aliases = obj()

ui.font_alias = function(alias, font) {
	font_aliases[alias] = font
}

ui.font = function(s) {
	s = font_aliases[s] ?? s
	text_font = s
	text_flags &= ~TEXT_FONT
	if (s && s != default_font)
		text_flags |= TEXT_FONT
}

let font_size_normal // set in reset_screen()

ui.font_size = function(x) {
	text_font_size = font_size_normal * x
	text_flags &= ~TEXT_FONT_SIZE
	if (x != null && x != 1)
		text_flags |= TEXT_FONT_SIZE
}
ui.fs = ui.font_size

ui.xsmall  = function() { ui.font_size(.72   ) }
ui.small   = function() { ui.font_size(.8125 ) }
ui.smaller = function() { ui.font_size(.875  ) }
ui.large   = function() { ui.font_size(1.125 ) }
ui.xlarge  = function() { ui.font_size(1.5   ) }

ui.font_weight = function(s) {
	text_font_weight = s
	text_flags &= ~TEXT_FONT_WEIGHT
	if (s && s != 'normal')
		text_flags |= TEXT_FONT_WEIGHT
}
ui.bold   = function() { ui.font_weight('bold') }
ui.nobold = function() { ui.font_weight('normal') }

ui.line_gap = function(s) {
	text_line_gap = s
	text_flags &= ~TEXT_LINE_GAP
	if (s != null && s != 0.5)
		text_flags |= TEXT_LINE_GAP
}
ui.lg = ui.line_gap

let default_font
let default_font_str
let last_font_str

let cur_color, cur_color_state, cur_font, cur_font_size, cur_font_weight
let cur_line_gap

function read_text_args(a, i, flags) {
	let arg_i = i+TEXT_ARGS_I
	cur_color       = flags & TEXT_COLOR       ? a[arg_i++] : 'text'
	cur_color_state = flags & TEXT_COLOR_STATE ? a[arg_i++] : null
	cur_font        = flags & TEXT_FONT        ? a[arg_i++] : default_font
	cur_font_size   = flags & TEXT_FONT_SIZE   ? a[arg_i++] : font_size_normal
	cur_font_weight = flags & TEXT_FONT_WEIGHT ? a[arg_i++] : 'normal'
	cur_line_gap    = flags & TEXT_LINE_GAP    ? a[arg_i++] : 0.5
	return arg_i
}

function set_text_font() {
	let s = cur_font_weight + ' ' + cur_font_size + 'px ' + cur_font
	if (s == last_font_str) return
	last_font_str = s
	cx.font = s
}

function reset_text_font() {
	if (last_font_str == default_font_str) return
	last_font_str = default_font_str
	cx.font = default_font_str
}

//// INPUT STATE -------------------------------------------------------------

/*

	ui.value       (id) -> v               what the input holds right now
	ui.input_value (id) -> v | undefined   interaction value, if interacted thi frame
	ui.set_value   (state, v)

*/

// what the input holds right now, current in any order inside a pass for
// what the user did to it, but not for a value the caller supplies later in
// the pass.
ui.value = function(id) {
	let s = ui.state_of(id)
	if (!s)
		return
	return s.input_value !== undefined ? s.input_value : s.value
}

ui.input_value = function(id) {
	return ui.state_of(id, 'input_value')
}

ui.set_value = function(s, value) {
	if (s.input_value !== undefined)
		value = s.input_value
	else if (value !== s.value)
		s.revert_value = value
	s.value = value
	return value
}

//// TEXT BOX ----------------------------------------------------------------

/*
TEXT BOXES

	ui.text            (id, v, fr, align, valign, max_w, w, h, wrap, field)
	ui.text_editable   (id, v, fr, align, valign, max_w, w, h, field)
	ui.text_lines      (id, v, fr, align, valign, max_w, w, h)
	ui.text_wrapped    (id, v, fr, align, valign, max_w, w, h)
	ui.heading(size, s, [align])
	hi.h1(s, [align])
	ui.h2(s, [align])

TEXT STATE API

	ui.mark_text       (i1, i2, [bg])   put a bg behind [i1,i2) of the next text
	ui.select_text     (id, i, len)     place the caret in an editable text
	ui.text_selection  (id, [from_end], [wanted]) -> [i, len]

TEXT HELPERS

	ui.measure_text (cx, s) -> {w:, asc:, dsc:, {actual|font}BoundingBox{Ascent|Descent|Left|Right}:, }

*/

const TEXT_ASC        = BOX_ARGS+0
const TEXT_DSC        = BOX_ARGS+1
const TEXT_X          = BOX_ARGS+2
const TEXT_W          = BOX_ARGS+3
const TEXT_H          = BOX_ARGS+4
const TEXT_ID         = BOX_ARGS+5
const TEXT_S          = BOX_ARGS+6
const TEXT_FLAGS      = BOX_ARGS+7
const TEXT_ARGS_I     = BOX_ARGS+8

// TEXT_FLAGS BITS
const TEXT_WRAP_LINE      = 2**0
const TEXT_WRAP_WORD      = 2**1
const TEXT_EDITABLE       = 2**2
const TEXT_FOCUSED        = 2**3
const TEXT_FOCUSED_BY_KEY = 2**4
const TEXT_MARKED         = 2**5
const TEXT_READONLY       = 2**6
const TEXT_ALIGN_RIGHT    = 2**7
const TEXT_ALIGN_CENTER   = 2**8
const TEXT_COLOR          = 2**9
const TEXT_COLOR_STATE    = 2**10
const TEXT_FONT           = 2**11
const TEXT_FONT_SIZE      = 2**12
const TEXT_FONT_WEIGHT    = 2**13
const TEXT_LINE_GAP       = 2**14

const TEXT_FONT_FLAGS = TEXT_FONT | TEXT_FONT_SIZE | TEXT_FONT_WEIGHT

const CMD_TEXT = cmd('text')
id_slot[CMD_TEXT] = TEXT_ID

// draw a background behind [i1, i2) of the next text, to show a match or a
// selection. bg defaults to the `search` background style.
let mark_i1, mark_i2, mark_bg
ui.mark_text = function(i1, i2, bg) {
	mark_i1 = i1
	mark_i2 = i2
	mark_bg = bg
	text_flags &= ~TEXT_MARKED
	if (i1 != null && i2 > i1)
		text_flags |= TEXT_MARKED
}

// NOTE: called between frames so hit testing is not availble here!
function editable_text_update(id, s) {
	s.input_value = undefined
}

// max_w : clip text beyond max_w. makes sense when w is not given.
// w, h  : fixate box w/h, clip text beyond it; default is measured text w/h.
// so by default text has dynamic w, and you can first cap it then fixate it.
ui.text = function(
	id, value, fr, align, valign, max_w, w, h, wrap, field
) {
	let text
	if (field) { // editable
		let s = ui.state(id, editable_text_update)
		ui.focusable(id)
		let value0 = s.value
		let field0 = s.field
		s.field = field
		value = ui.set_value(s, repl(value ?? null, '', null))
		if (s.text === undefined || s.input_value === undefined
				&& (value !== value0 || field != field0)) {
			s.text = value == null ? '' : field.to_input(value)
			field.validator?.validate(value)
		}
		text = s.text
	} else {
		text = String(value ?? '')
	}
	wrap = wrap == 'line' ? TEXT_WRAP_LINE : wrap == 'word' ? TEXT_WRAP_WORD : 0
	if (wrap == TEXT_WRAP_LINE) {
		if (text.includes('\n'))
			text = text.split('\n')
	} else if (wrap == TEXT_WRAP_WORD) {
		ui.state(id)
		text = word_wrapper(id, text)
	}
	let box_align = align ?? 'l'
	let text_align = 0
	if (box_align == 'sr' || box_align == 'stretch-right') {
		box_align = 's'
		text_align = TEXT_ALIGN_RIGHT
	} else if (box_align == 'sc' || box_align == 'stretch-center') {
		box_align = 's'
		text_align = TEXT_ALIGN_CENTER
	} else {
		box_align = parse_align(box_align)
		if (box_align == ALIGN_END)
			text_align = TEXT_ALIGN_RIGHT
		else if (box_align == ALIGN_CENTER)
			text_align = TEXT_ALIGN_CENTER
	}
	let i = ui_cmd_box_begin(CMD_TEXT, fr ?? 1, box_align, valign ?? 'c',
		w ?? -1, // -1=auto
		h ?? -1, // -1=auto
	)
	a[n++] = 0 // ascent
	a[n++] = 0 // descent
	a[n++] = 0 // text_x
	a[n++] = max_w ?? -1 // -1=inf
	a[n++] = 0 // text_h
	a[n++] = id
	a[n++] = text
	a[n++] = wrap // flags
		| text_align
		| (field ? TEXT_EDITABLE : 0)
		| (field?.readonly ? TEXT_READONLY : 0)
		| (ui.focused(id) ? TEXT_FOCUSED : 0)
		| (ui.focused(id) && ui.focused_by_key ? TEXT_FOCUSED_BY_KEY : 0)
		| text_flags
	if (text_flags & TEXT_COLOR)
		a[n++] = text_color
	if (text_flags & TEXT_COLOR_STATE)
		a[n++] = text_color_state
	if (text_flags & TEXT_FONT)
		a[n++] = text_font
	if (text_flags & TEXT_FONT_SIZE)
		a[n++] = text_font_size
	if (text_flags & TEXT_FONT_WEIGHT)
		a[n++] = text_font_weight
	if (text_flags & TEXT_LINE_GAP)
		a[n++] = text_line_gap
	if (field)
		a[n++] = field.input_type
	if (text_flags & TEXT_MARKED) {
		a[n++] = mark_i1
		a[n++] = mark_i2
		a[n++] = mark_bg ?? 'search'
	}
	ui_cmd_box_end(i)
	text_flags = 0

	return field ? value : text
}
ui.text_editable = function(
	id, value, fr, align, valign, max_w, w, h, field
) {
	if (!field)
		field = ui.state(id).field ??= ui.create_field()
	return ui.text(id, value, fr, align, valign, max_w, w, h, null, field)
}
ui.text_lines = function(id, s, fr, align, valign, max_w, w, h) {
	return ui.text(id, s, fr, align, valign, max_w, w, h, 'line')
}
ui.text_wrapped = function(id, s, fr, align, valign, max_w, w, h) {
	return ui.text(id, s, fr, align, valign, max_w, w, h, 'word')
}
ui.heading = function(font_size, s, align) {
	ui.font_size(font_size)
	ui.bold()
	ui.color('heading')
	ui.text('', s, 0, align)
}
ui.h1 = (s, align) => ui.heading(2.00, s, align)
ui.h2 = (s, align) => ui.heading(1.75, s, align)

function see(m) {
	let t = {}
	for (let k in m)
		if (typeof(m[k]) != 'function')
			t[k] = m[k]
	return t
}

let measure_text; {
let tm = map()
measure_text = function(cx, s) {
	let fm = tm.get(cx.font)
	if (!fm) { fm = map(); tm.set(cx.font, fm) }
	let m = fm.get(s)
	if (!m) {
		m = cx.measureText(s)
		fm.set(s, m)
		if (m.fontBoundingBoxAscent == null) { // Firefox < 116
			m.fontBoundingBoxAscent  = 1.3 * m.actualBoundingBoxAscent
			m.fontBoundingBoxDescent = 1.3 * m.actualBoundingBoxDescent
		}
	}
	m._build_no = build_no
	return m
}
ui.measure_text = measure_text

runevery(60 * 2, function() {
	let n = 0
	for (let fm of tm.values()) {
		for (let [s, m] of fm) {
			if (build_no - m._build_no > 60 * 60 * 4) {
				fm.delete(s)
				n++
			}
		}
	}
	if (n)
		debug('gc text measure ', n)
})

document.fonts.addEventListener('loadingdone', function(ev) {

	// page was already rendered with missing fonts even though we preloaded all fonts.
	for (let font of ev.target) {
		let suffix = ' '+font.family
		for (let [font_spec, fm] of tm) {
			if (font_spec.endsWith(suffix))
				tm.delete(font_spec)
		}
	}

	// this is needed for when the debugger is open in Chrome and Firefox,
	// whether you preload fonts or not.
	animate()
})

}

function create_word_wrapper() {

	let s
	let words  = [] // [word1,...]
	let widths = [] // [w1,...]
	let lines  = [] // [line1_i,line1_w,...]
	let sp_w // width of a single space character.
	let ww = {lines: lines, words: words, widths: widths}

	ww.set_text = function(s1) {
		s1 = s1.trim()
		if (s1 == s)
			return
		ww.clear()
		s = s1
	}

	// skip spaces, advancing i1 to the first non-space char and i2
	// to first space char after that, or to 1/0 if no space char was found.
	let i1
	function skip_spaces(s) {
		while (1) {
			let i3 = s.indexOf(' ' , i1); if (i3 == i1) { i1++; continue; }
			let i4 = s.indexOf('\n', i1); if (i4 == i1) { i1++; continue; }
			let i5 = s.indexOf('\r', i1); if (i5 == i1) { i1++; continue; }
			let i6 = s.indexOf('\t', i1); if (i6 == i1) { i1++; continue; }
			return min(
				i3 == -1 ? 1/0 : i3,
				i4 == -1 ? 1/0 : i4,
				i5 == -1 ? 1/0 : i5,
				i6 == -1 ? 1/0 : i6,
			)
		}
	}
	let last_font
	ww.measure = function() {
		if (cx.font == last_font)
			return
		last_font = cx.font
		let m = measure_text(cx, ' ')
		sp_w = m.width
		ww.sp_w = sp_w
		ww.asc = m.fontBoundingBoxAscent
		ww.dsc = m.fontBoundingBoxDescent
		if (!s) {
			ww.w = 0
			ww.h = ceil(ww.asc + ww.dsc)
			return
		}
		i1 = 0
		while (i1 < 1/0) {
			let i2 = skip_spaces(s)
			let word = s.substring(i1, i2)
			words.push(word)
			i1 = i2
		}
		ww.min_w = 0
		for (let s of words) {
			let m = measure_text(cx, s)
			widths.push(m.width)
			ww.min_w = max(ww.min_w, m.width)
		}
	}

	let last_ct_w, last_line_gap
	ww.wrap = function(ct_w, gap) {
		if (!s)
			return
		if (ct_w == last_ct_w && gap == last_line_gap)
			return
		last_ct_w = ct_w
		last_line_gap = gap
		lines.length = 0
		let line_w = 0
		let max_line_w = 0
		let line_i = 0
		let sep_w = 0
		for (let i = 0, n = widths.length; i <= n; i++) {
			let w = i < n ? widths[i] : 0
			if (i == n || ceil(line_w + sep_w + w) > ct_w) {
				line_w = ceil(line_w)
				max_line_w = max(max_line_w, line_w)
				lines.push(line_i)
				lines.push(line_w)
				line_w = 0
				sep_w = 0
				line_i = i
			}
			line_w += sep_w + w
			sep_w = sp_w
		}
		let line_count = lines.length / 2
		ww.w = ceil(max_line_w)
		ww.h = line_count * ceil(ww.asc + ww.dsc)
			+ (line_count-1) * round(gap)
	}

	ww.clear = function() {
		s = null
		words .length = 0
		widths.length = 0
		lines .length = 0
		last_font = null
		last_ct_w = null
		last_line_gap = null
	}

	return ww
}

function word_wrapper(id, text) {
	let s = ui.state(id)
	let ww = s.ww
	if (!ww) {
		ww = create_word_wrapper()
		s.ww = ww
	}
	ww.set_text(text)
	return ww
}

measure[CMD_TEXT] = function(a, i, axis) {
	let flags = a[i+TEXT_FLAGS]
	if (!axis) {
		read_text_args(a, i, flags)
		if (flags & TEXT_FONT_FLAGS)
			set_text_font()
		if (flags & TEXT_WRAP_WORD) {
			// word-wrapping is the reason for splitting the layouting algorithm
			// into interlaced per-axis measuring and positioning phases.
			let ww = a[i+TEXT_S]
			ww.measure()
			let w = a[i+0]
			let max_w = a[i+TEXT_W]
			if (w == -1)
				w = ww.min_w
			if (max_w != -1)
				w = min(max_w, w)
			a[i+2] = w // min_w = w
			a[i+TEXT_ASC] = round(ww.asc)
			a[i+TEXT_DSC] = round(ww.dsc)
		} else {
			// measure everything once on the x-axis phase.
			let s = a[i+TEXT_S]
			let asc
			let dsc
			let text_w
			let text_h
			if (isstr(s)) { // single-line
				let m = measure_text(cx, s)
				asc = m.fontBoundingBoxAscent
				dsc = m.fontBoundingBoxDescent
				text_w = ceil(m.width)
				text_h = ceil(asc+dsc)
			} else { // multi-line, pre-wrapped
				text_w = 0
				text_h = 0
				for (let ss of s) {
					let m = measure_text(cx, ss)
					asc = m.fontBoundingBoxAscent
					dsc = m.fontBoundingBoxDescent
					text_w = max(text_w, ceil(m.width))
					text_h += ceil(asc+dsc)
				}
				text_h += (s.length-1) * round(cur_line_gap * cur_font_size)
			}
			let w = a[i+0]
			let h = a[i+1]
			let max_w = a[i+TEXT_W]
			if (h == -1) h = text_h
			if (w == -1) w = text_w
			if (max_w != -1)
				w = min(max_w, w)
			a[i+2] = w // min_w = w
			a[i+3] = h // min_h = h
			a[i+TEXT_ASC] = round(asc)
			a[i+TEXT_DSC] = round(dsc)
			a[i+TEXT_W] = text_w + spacings(a, i, 0)
			a[i+TEXT_H] = text_h + spacings(a, i, 1)
		}
		if (flags & TEXT_FONT_FLAGS)
			reset_text_font()
	} else if (flags & TEXT_WRAP_WORD) {
		let ww = a[i+TEXT_S]
		let h = a[i+1]
		if (h == -1)
			h = ww.h
		a[i+3] = h // min_h = h
		a[i+TEXT_H] = ww.h
	}
	a[i+2+axis] += spacings(a, i, axis)
	let w = a[i+2+axis]
	add_ct_min_wh(a, axis, w)
}

position[CMD_TEXT] = function(a, i, axis, sx, sw) {
	if (!axis) {
		let flags = a[i+TEXT_FLAGS]
		if (flags & TEXT_WRAP_WORD) {
			read_text_args(a, i, flags)
			let ww = a[i+TEXT_S]
			ww.wrap(sw, cur_line_gap * cur_font_size)
			a[i+2] = ww.w
		} else {
			a[i+2] = a[i+TEXT_W] // we're positioning text_w, not w!
		}
		// store the segment we might have to clip the text to.
		a[i+TEXT_X] = sx + a[i+MX1] + a[i+PX1]
		a[i+TEXT_W] = sw - spacings(a, i, 0)
	} else {
		a[i+3] = a[i+TEXT_H] // we're positioning text_h, not h!
	}
	let x = inner_x(a, i, axis, align_x(a, i, axis, sx, sw))
	let w = inner_w(a, i, axis, align_w(a, i, axis, sw))
	a[i+0+axis] = x
	a[i+2+axis] = w
}
is_flex_child[CMD_TEXT] = true

translate[CMD_TEXT] = function(a, i, dx, dy) {
	a[i+0] += dx
	a[i+1] += dy
	a[i+TEXT_X] += dx
}

let prev_drawn_focused_input
let drawn_focused_input
let drawn_focused_by_key

/// selecting text -----------------------------------------------------------

// A selection is (i, len): i is both caret position and selection anchor:
// i >= 0 from the left, i < 0 from the right; -1 is 1 char past the last char.
// len runs from i to the right: 0 = empty selection; 1/0 = select all.

// request to place the caret. takes effect on the next frame.
ui.select_text = function(id, i, len) {
	let s = ui.state(id)
	s.sel_i = i
	s.sel_len = len
	s.sel_pending = true
}

ui.text_selection = function(id, from_end, wanted) {
	if (wanted) {
		// the selection requested by ui.select_text(). un-clamped, so passing
		// it on through a text too short for it doesn't shorten it.
		let s = ui.state(id)
		if (s.sel_i != null)
			return [s.sel_i, s.sel_len]
	}
	// where the caret is now. `from_end` helps decide the direction.
	let s = ui.state(id)
	let n = (s.text ?? '').length
	let a = s.anchor ?? 0 // the end it was made from
	let c = s.caret  ?? 0 // the end it was dragged to
	let i1 = min(a, c)
	let i2 = max(a, c)
	return [(i1 != i2 ? c < a : from_end) ? i1 - n - 1 : i1, i2 - i1]
}

// the user moved the caret or typed: cancel the ui.select_text() request.
function forget_selection(s) {
	s.sel_i = null
	s.sel_len = null
	s.sel_pending = false
}

// ctrl+A means select-all, including on a future text of a different length,
// so make ui.text_selection(wanted) infinite length. the browser selects the
// text itself, and the selectionchange that fires after this must not be taken
// for a user event, so record the pair read_input_sel() will report for it.
function remember_select_all(input) {
	let s = ui.state_of(input._ui_id)
	if (!s) return
	s.sel_i = 0
	s.sel_len = 1/0
	s.sel_pending = false
	input._ui_anchor = 0
	input._ui_caret = input.value.length
}

function apply_select_text(input) {
	let s = ui.state_of(input._ui_id)
	if (!s?.sel_pending)
		return
	s.sel_pending = false
	let n = input.value.length
	let i = s.sel_i
	// -1 is past the last char, so the count from the right is off by one.
	let i1 = clamp(i >= 0 ? i : n + i + 1, 0, n)
	let i2 = clamp(i1 + (s.sel_len ?? 0), i1, n)
	// a negative i counts from the right, which is the end the selection was
	// dragged towards, which is where the caret goes.
	let backward = i >= 0
	// this fires selectionchange event which must not be taken for a user
	// event, so record the pair the way read_input_sel() will report it.
	input._ui_anchor = backward ? i2 : i1
	input._ui_caret  = backward ? i1 : i2
	input.setSelectionRange(i1, i2, backward ? 'backward' : 'forward')
}

/// input DOM elements -------------------------------------------------------

// move the DOM focus to where the frame put it:
// 1) same input focused (do nothing)
// 2) diff input focused by key (focus it, and select all of it by default)
// 3) diff input focused by click (do nothing: the click placed the caret)
// 4) no input focused (focus back the canvas).
function sync_dom_focus() {
	let input = drawn_focused_input
	let input0 = prev_drawn_focused_input
	prev_drawn_focused_input = input
	if (input) {
		if (document.activeElement != input)
			input.focus({preventScroll: true})
		if (input != input0 && drawn_focused_by_key) {
			let id = input._ui_id
			if (!input._ui_ss_ids && !ui.state_of(id, 'sel_pending'))
				ui.select_text(id, 0, 1/0)
		}
	} else if (input != input0 && document.activeElement == input0) {
		canvas.focus()
	}
}

// give the focused input the selection asked for. can be asked for on any
// frame, not only when the focus moves.
function sync_dom_selection() {
	let input = drawn_focused_input
	if (!input || input._ui_ss_ids)
		return
	if (ui.keydown('a') && ui.keypressed('ctrl'))
		remember_select_all(input)
	apply_select_text(input)
}

function input_free(s, id) {
	let input = s.input
	// canvas.focus() below blurs the input: don't report that blur back.
	input.removeEventListener('blur',
		input._ui_ss_ids ? remote_input_blur : input_blur)
	if (input == prev_drawn_focused_input) {
		prev_drawn_focused_input = null
		canvas.focus()
	}
	input.remove()
}

function input_focus(ev) {
	ui.focus(this._ui_id)
	animate()
}

function input_blur(ev) {
	// deactivating the window blurs the input, but focus didn't move.
	if (!document.hasFocus())
		return
	if (ui.focused_id == this._ui_id && !ui.screen.contains(ev.relatedTarget))
		ui.focus(null)
	animate()
}

// anchor = selection start, caret = selection end; equal = no selection.
function read_input_sel(t, input) {
	let backward = input.selectionDirection == 'backward'
	t.anchor = backward ? input.selectionEnd   : input.selectionStart
	t.caret  = backward ? input.selectionStart : input.selectionEnd
}

function set_text_input_value(s, text) {
	s.text = text
	let input_value = repl(text, '', null)
	let validator = s.field.validator
	validator.validate(input_value)
	s.input_value = validator.parse_failed ? input_value : validator.value
}

function input_text_changed() {
	let s = ui.state_of(this._ui_id)
	if (!s) return
	set_text_input_value(s, this.value)
	read_input_sel(s, this)
	forget_selection(s)
	animate()
}

function input_selection_changed() {
	let s = ui.state_of(this._ui_id)
	if (!s) return
	read_input_sel(s, this)
	// setSelectionRange() fires selectionchange, so we need to suppress
	// forget_selection() then.
	if (s.anchor != this._ui_anchor || s.caret != this._ui_caret)
		forget_selection(s)
	animate()
}

function remote_input_focus() {
	// focus the shared screen that shows this input so that keys start being
	// forwarded and the frame's focused flag is honored. clicking the input is
	// what focuses the screen; the screen doesn't have to be focused first.
	ui.focus(this._ui_ss_ids[0])
	remote_input_send(this, {input: this._ui_id, event: 'focus'})
	animate()
}

function remote_input_blur(ev) {
	// deactivating the window blurs the input, but focus didn't move.
	if (!document.hasFocus())
		return
	if (ui.focused_id == this._ui_ss_ids[0]
			&& !ui.screen.contains(ev.relatedTarget))
		ui.focus(null)
	animate()
}

// numbers each edit sent out; frames echo the last one applied.
let edit_n = 0

function remote_input_send_edit(input, t) {
	t.input = input._ui_id
	t.event = 'input'
	t.value = input.value
	t.n = input._ui_n = ++edit_n
	remote_input_send(input, t)
}

function remote_input_text_changed() {
	let t = {}
	read_input_sel(t, this)
	remote_input_send_edit(this, t)
}

function remote_input_selection_changed() {
	let t = {}
	read_input_sel(t, this)
	// setting a selection fires this too, reporting the positions it just
	// set: that one moved nothing, so there is nothing to send.
	if (t.anchor == this._ui_anchor && t.caret == this._ui_caret)
		return
	remote_input_send_edit(this, t)
}

function document_selection_changed() {
	let input = document.activeElement
	if (!input?._ui_id)
		return
	if (input._ui_ss_ids)
		remote_input_selection_changed.call(input)
	else
		input_selection_changed.call(input)
}

document.addEventListener('selectionchange', document_selection_changed)

// send on the outermost screen's connection; the other ids are the route.
function remote_input_send(input, t) {
	let ids = input._ui_ss_ids
	if (ids.length > 1)
		t.ss_ids = ids.slice(1)
	ui.state_of(ids[0], 'con').send(json(t))
}

ui.process_shared_screen_input = function(p, t) {
	if (t.ss_ids?.length) {
		// clicking a remote input never reaches a canvas, so focus and blur
		// must apply to every screen on the route, not just to the input.
		let id = t.ss_ids.shift()
		if (t.event == 'focus') {
			ui.focus(id)
			animate()
		}
		ui.state_of(id, 'con').send(json(t))
	} else if (t.event == 'pointer_state') {
		assign(p, t)
		p.activate()
		animate()
	} else if (t.event == 'key_state') {
		p.key_state.clear()
		for (let key of t.keys)
			p.key_state.add(key)
		animate()
	} else if (t.event == 'key') {
		apply_key_event(p, t.key_event)
	} else if (t.event == 'focus') {
		ui.focus(t.input)
		animate()
	} else if (t.event == 'input') {
		let s = ui.state_of(t.input)
		if (!s) return
		set_text_input_value(s, t.value)
		s.anchor = t.anchor
		s.caret = t.caret
		applied_edit_n = t.n
		animate()
	} else {
		assert(false, 'invalid shared screen input event')
	}
}

// a remote input is wired to send edits instead of applying them. keys need
// no wiring: the document listeners catch them wherever they land.
function input_create(id, input_type) {
	let s = ui.render_state(id)
	let input = s.input
	if (!input) {
		let remote = ss_ids.length > 0
		input = document.createElement('input')
		input._ui_id = id
		input._ui_n = 0
		if (remote)
			input._ui_ss_ids = [...ss_ids]
		if (input_type)
			input.setAttribute('type', input_type)
		input.classList.add('ui-input')
		input.addEventListener('focus', remote ? remote_input_focus : input_focus)
		input.addEventListener('blur' , remote ? remote_input_blur  : input_blur )
		input.addEventListener('input', remote
			? remote_input_text_changed : input_text_changed)
		screen.appendChild(input)
		s.input = input
		s.free = input_free
	}
	return input
}

/// text drawing and hit-testing ---------------------------------------------

draw[CMD_TEXT] = function(a, i) {

	let x          = a[i+0]
	let y          = a[i+1]
	let w          = a[i+2]
	let s          = a[i+TEXT_S]
	let asc        = a[i+TEXT_ASC]
	let dsc        = a[i+TEXT_DSC]
	let sx         = a[i+TEXT_X]
	let sw         = a[i+TEXT_W]
	let id         = a[i+TEXT_ID]
	let flags      = a[i+TEXT_FLAGS]
	let editable = flags & TEXT_EDITABLE
	let readonly = !!(flags & TEXT_READONLY)
	let focused  = flags & TEXT_FOCUSED
	let by_key   = flags & TEXT_FOCUSED_BY_KEY
	if (ss_ids.length)
		focused = focused && ss_focused

	let arg_i = read_text_args(a, i, flags)
	let input_type = editable ? a[arg_i++] : null
	let col = color_css(cur_color, cur_color_state)

	if (editable) {
		let input = input_create(id, input_type)
		if (input.readOnly != readonly)
			input.readOnly = readonly

		let css_align = flags & TEXT_ALIGN_RIGHT ? 'right'
			: flags & TEXT_ALIGN_CENTER ? 'center' : 'left'
		let px1 = a[i+PX1+0]
		let px2 = a[i+PX2+0]
		let py1 = a[i+PX1+1]
		let py2 = a[i+PX2+1]
		let css_x   = (sx - px1) / dpr
		let css_y   = (y  - py1) / dpr
		let css_w   = (sw + px1 + px2) / dpr
		let css_h   = (a[i+3] + py1 + py2) / dpr
		let css_lh  = a[i+3] / dpr
		let css_px1 = px1 / dpr
		let css_px2 = px2 / dpr
		let css_py1 = py1 / dpr
		let css_py2 = py2 / dpr
		let css_font_size = cur_font_size / dpr
		let css_opacity = focused ? '1' : '0'
		if (
			document.activeElement != input ||
			(ss_frame?.n ?? 0) >= input._ui_n
		) {
			if (input.value != s) {
				input.value = s
				let backward = input.selectionDirection == 'backward'
				input._ui_anchor = backward ? input.selectionEnd : input.selectionStart
				input._ui_caret  = backward ? input.selectionStart : input.selectionEnd
			}
			let anchor = ss_frame?.anchor
			let caret  = ss_frame?.caret
			if (
				focused && anchor != null
				&& (anchor != input._ui_anchor || caret != input._ui_caret)
			) {
				input.setSelectionRange(min(anchor, caret), max(anchor, caret),
					anchor > caret ? 'backward' : 'forward')
				input._ui_anchor = anchor
				input._ui_caret = caret
			}
		}
		if (  input._ui_font        != cur_font
			|| input._ui_font_weight != cur_font_weight
			|| input._ui_font_size   != css_font_size
		) {
			input.style.fontFamily = cur_font
			input.style.fontWeight = cur_font_weight
			input.style.fontSize   = css_font_size+'px'
			input._ui_font        = cur_font
			input._ui_font_weight = cur_font_weight
			input._ui_font_size   = css_font_size
		}
		if (  input._ui_x != css_x
			|| input._ui_y != css_y
			|| input._ui_w != css_w
			|| input._ui_h != css_h
			|| input._ui_px1 != css_px1
			|| input._ui_px2 != css_px2
			|| input._ui_py1 != css_py1
			|| input._ui_py2 != css_py2
		) {
			input.style.left          = css_x+'px'
			input.style.top           = css_y+'px'
			input.style.width         = css_w+'px'
			input.style.height        = css_h+'px'
			input.style.lineHeight    = css_lh+'px'
			input.style.paddingLeft   = css_px1+'px'
			input.style.paddingRight  = css_px2+'px'
			input.style.paddingTop    = css_py1+'px'
			input.style.paddingBottom = css_py2+'px'
			input._ui_x = css_x
			input._ui_y = css_y
			input._ui_w = css_w
			input._ui_h = css_h
			input._ui_px1 = css_px1
			input._ui_px2 = css_px2
			input._ui_py1 = css_py1
			input._ui_py2 = css_py2
		}
		if (input.style.textAlign != css_align)
			input.style.textAlign = css_align
		if (input.style.opacity != css_opacity)
			input.style.opacity = css_opacity

		if (focused) {
			drawn_focused_input = input
			drawn_focused_by_key = by_key
			if (input._ui_color != col) {
				input.style.color = col
				input._ui_color = col
			}
			return
		}
	}

	if (flags & TEXT_FONT_FLAGS)
		set_text_font()

	let clip = w > sw

	if (clip) {
		let h = a[i+3]
		cx.save()
		cx.beginPath()
		cx.rect(sx, y, sw, h)
		cx.clip()
	}

	let anchor_x
	if (flags & TEXT_ALIGN_RIGHT) {
		cx.textAlign = 'right'
		anchor_x = sx + sw
	} else if (flags & TEXT_ALIGN_CENTER) {
		cx.textAlign = 'center'
		anchor_x = sx + sw / 2
	} else {
		cx.textAlign = 'left'
		anchor_x = x
	}

	if (isstr(s)) {

		cx.fillStyle = col
		cx.fillText(s, anchor_x, y + asc)

		// the background covers the text drawn under it, so the marked part
		// can be redrawn on it without the two antialiased edges blending.
		if (flags & TEXT_MARKED) {
			let i1 = a[arg_i+0]
			let i2 = a[arg_i+1]
			let mark_s = s.slice(i1, i2)
			let text_x
			if (flags & TEXT_ALIGN_RIGHT)
				text_x = anchor_x - measure_text(cx, s).width
			else if (flags & TEXT_ALIGN_CENTER)
				text_x = anchor_x - measure_text(cx, s).width / 2
			else
				text_x = anchor_x
			let mark_x = text_x + measure_text(cx, s.slice(0, i1)).width
			let bg = color_hsl(a[arg_i+2])
			cx.fillStyle = bg[0]
			cx.fillRect(mark_x, y, measure_text(cx, mark_s).width, asc + dsc)
			cx.fillStyle = color_css('text', null, bg_is_dark(bg) ? 'dark' : 'light')
			cx.textAlign = 'left'
			cx.fillText(mark_s, mark_x, y + asc)
		}

	} else if (flags & TEXT_WRAP_LINE) {

		cx.fillStyle = col

		for (let ss of s) {
			cx.fillText(ss, anchor_x, y + asc)
			y += asc + dsc + round(cur_line_gap * cur_font_size)
		}

	} else if (flags & TEXT_WRAP_WORD) {

		cx.fillStyle = col
		cx.textAlign = 'left'

		let x0 = x
		let ww = s

		for (let k = 0, n = ww.lines.length; k < n; k += 2) {

			let i1     = ww.lines[k]
			let line_w = ww.lines[k+1]
			let i2     = ww.lines[k+2] ?? ww.words.length

			let x
			if (flags & TEXT_ALIGN_RIGHT)
				x = x0 + w - line_w
			else if (flags & TEXT_ALIGN_CENTER)
				x = x0 + round((w - line_w) / 2)
			else
				x = x0

			for (let i = i1; i < i2; i++) {
				let s1 = ww.words [i]
				let w1 = ww.widths[i]
				cx.fillText(s1, x, y + asc)
				x += w1 + ww.sp_w
			}

			y += asc + dsc + round(cur_line_gap * cur_font_size)
		}
	}

	if (clip)
		cx.restore()

	if (flags & TEXT_FONT_FLAGS)
		reset_text_font()

}

hittest[CMD_TEXT] = function(a, i) {
	if (hit_box(a, i)) {
		if (a[i+TEXT_FLAGS] & TEXT_EDITABLE)
			ui.set_cursor('text')
		set_hit(a[i+TEXT_ID])
		hit_template(a, i)
		return true
	}
}

//// ICONS -------------------------------------------------------------------

// text is a codepoint, or the icon's name for a font that ligates names:
// material icons ligates, tabler and font awesome don't.
let icons = obj() // {name -> [font, text]}

ui.icon_def = function(name, font, text) {
	icons[name] = [font, text]
}

ui.icon = function(id, name, fr, align, valign, max_w, w, h) {
	let [font, text] = assert(icons[name], 'unknown icon ', name)
	ui.font(font)
	ui.text(id, text, fr, align, valign, max_w, w, h)
}

//// FRAME -------------------------------------------------------------------

// A frame sits inside a scrollbox. You give it its dimensions so that the
// scrollbox knows how to scroll it, but you don't build its content there.
// Instead, you pass it a callback and you build the content in the callback.
// The engine calls your callback when it can tell you the frame viewport so
// that you can build only the content that is visible and skip building the
// content that is not in the frame. The grid and the code edit widgets use
// frames to scroll long content at constant speed.

const FRAME_ON_MEASURE = BOX_ARGS+0
const FRAME_ON_BUILD   = BOX_ARGS+1
const FRAME_CT_I       = BOX_ARGS+2
const FRAME_REC_I      = BOX_ARGS+3
const FRAME_ARGS_I     = BOX_ARGS+4

ui.FRAME_ARGS_I = FRAME_ARGS_I

let frame_make_ms = 0

let frame = {}

frame.create = function(
	cmd, on_measure, on_build, fr, align, valign, min_w, min_h, ...args
) {

	let ct_i = ui.ct_i()
	let rel_ct_i = ui.rel_ct_i()
	assert(a[ct_i-1] == CMD_SCROLLBOX, 'frame is not inside a scrollbox')

	return ui.cmd_box(cmd, fr, align, valign, min_w, min_h,
		on_measure, on_build,
		rel_ct_i,
		null, // rec_i, unset (0 is the main record)
		...args
	)

}

frame.measure = function(a, i, axis) {
	let on_measure = a[i+FRAME_ON_MEASURE]
	let min_w = on_measure(axis)
	if (min_w != null)
		add_ct_min_wh(a, axis, min_w)
	box_measure(a, i, axis)
}

frame.translate = function(a, i, dx, dy) {

	assert(a[i+FRAME_REC_I] == null, 'frame re-entered')

	a[i+0] += dx
	a[i+1] += dy

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]

	let ct_i = i+a[i+FRAME_CT_I]
	let cx = a[ct_i+0]
	let cy = a[ct_i+1]
	let cw = a[ct_i+2]
	let ch = a[ct_i+3]

	let on_build = a[i+FRAME_ON_BUILD]
	let t0 = clock_ms()
	let a0 = begin_rec()
		a[i+FRAME_REC_I] = rec_i
		ui.stack()
			on_build(a, i, x, y, w, h, cx, cy, cw, ch)
			reset_spacings()
			ui.end_stack()
		frame_end_check()
	let a1 = end_rec(a0)
	// pr(json(a1).length)
	frame_make_ms += clock_ms() - t0

	layout_rec(a1, x, y, w, h)

	// callbacks are not serializable so we have to clean them up from the rec.
	a[i+FRAME_ON_MEASURE] = null
	a[i+FRAME_ON_BUILD] = null

}

frame.register = function(a, i) {
	let rec_i = a[i+FRAME_REC_I]
	register_rec(recs[rec_i], rec_i)
}

frame.draw = function(a, i, recs) {
	let rec_i = a[i+FRAME_REC_I]
	let a1 = recs[rec_i]
	draw_cmd(a1, 2, recs)
}

frame.hit = function(a, i, recs) {
	let rec_i = a[i+FRAME_REC_I]
	let a1 = recs[rec_i]
	let hit_f = hittest[a1[1]]
	return hit_f && !a.nohit_set?.has(i) && hit_f(a1, 2, recs)
}

ui.box_widget('frame', frame)

//// FRAME SERIALIZATION -----------------------------------------------------

/// frame packing

// id of this machine, sent with every frame; ss.draw() checks it for cycles.
let screen_id = floor(random() * 1e15)

// number of the last remote edit applied; sent back with every frame.
let applied_edit_n = 0

let tenc = new TextEncoder()
async function pack_frame_json() {

	let t0 = clock_ms()

	let s = json({
		v: ui.VERSION,
		id: screen_id,
		w: screen_w,
		h: screen_h,
		mx: ui.local_pointer.mx,
		my: ui.local_pointer.my,
		n: applied_edit_n,
		// not ui.state(): it would run the widget's update callback here.
		anchor: state_map.get(ui.focused_id)?.anchor,
		caret: state_map.get(ui.focused_id)?.caret,
		recs: recs,
		popups: root_popups,
	})
	let b = tenc.encode(s)

	let cs = new CompressionStream('gzip')
	let writer = cs.writable.getWriter()
	writer.write(b)
	writer.close()
	let cb = await new Response(cs.readable).arrayBuffer()

	let t1 = clock_ms()

	frame_graph_push('frame_bandwidth'  , (60 * cb.byteLength * 8) / (1024 * 1024)) // Mbps @ 60fps
	frame_graph_push('frame_compression', (cb.byteLength / b.byteLength) * 100)
	frame_graph_push('frame_pack_time'  , t1 - t0)

	return cb
}
let pack_frame = pack_frame_json
ui.pack_frame = pack_frame

/// frame unpacking

async function decompress_frame(cb) {
	let dcs = new DecompressionStream('gzip')
	let writer = dcs.writable.getWriter()
	writer.write(cb)
	writer.close()
	return await new Response(dcs.readable).arrayBuffer()
}

let tdec = new TextDecoder()
async function unpack_frame_json(ab) {
	let t = json_arg(tdec.decode(ab))
	assert(t.v == ui.VERSION, 'wrong version ', t.v)
	return t
}

async function unpack_frame(cb) {

	let t0 = clock_ms()

	let ab = await decompress_frame(cb)
	let t = await unpack_frame_json(ab)

	let t1 = clock_ms()

	frame_graph_push('frame_unpack_time', t1 - t0)

	return t
}

//// SHARED SCREEN -----------------------------------------------------------

/*
	ui.shared_screen   (id, answer_con, fr, align, valign, min_w, min_h)
	ui.process_shared_screen_input (p, t)
	ui.pack_frame      () -> s     pack current frame for sending over the network
	ui.frame_changed   = noop      hook this for sending frames out
*/

let SS_ID    = BOX_ARGS+0
let SS_FRAME = BOX_ARGS+1
let SS_STATE = BOX_ARGS+2

let SS_FOCUSED = 1

let ss = {}

ss.ID = SS_ID

function ss_send_pointer(s, mx, my) {
	let p = s.sent_pointer
	let inside   = mx != null
	let pressed  = inside && ui.pressed
	let click    = inside && ui.click
	let clickup  = inside && ui.clickup
	let dblclick = inside && ui.dblclick
	let wheel_dy = inside ? ui.wheel_dy : 0
	let trackpad = inside && ui.trackpad
	if (
		mx       == p.mx       &&
		my       == p.my       &&
		pressed  == p.pressed  &&
		click    == p.click    &&
		clickup  == p.clickup  &&
		dblclick == p.dblclick &&
		wheel_dy == p.wheel_dy &&
		trackpad == p.trackpad
	)
		return
	p.mx       = mx
	p.my       = my
	p.pressed  = pressed
	p.click    = click
	p.clickup  = clickup
	p.dblclick = dblclick
	p.wheel_dy = wheel_dy
	p.trackpad = trackpad
	s.con.send(json(p))
}

function ss_free(s) {
	ss_send_pointer(s, null, null)
	if (s.sent_keys?.size)
		s.con.send(json({event: 'key_state', keys: []}))
}

ss.create = function(cmd, id, answer_con, fr, align, valign, min_w, min_h) {

	ui.state(id)
	ui.focusable(id)
	ui.capture_tab(id)
	ui.measure(id)
	let s = ui.state(id)
	if (s.con != answer_con) {
		if (s.con)
			ss_free(s)
		s.con = answer_con
		s.sent_keys = null
		// sent as-is, so it carries the event tag along with the state.
		s.sent_pointer = {event: 'pointer_state'}
		s.free = ss_free
		answer_con.recv = async function(cb) {
			answer_con.frame = await unpack_frame(cb)
			ui.animate()
		}
	}

	let hs = captured(id) || hit(id)
	let keys = ui.focused(id) ? ui.pointer.key_state : empty_set
	if (!s.sent_keys || !set_equals(s.sent_keys, keys)) {
		s.sent_keys = set(keys)
		answer_con.send(json({event: 'key_state', keys: [...keys]}))
	}
	if (ui.focused(id)) {
		for (let ev of ui.key_events)
			answer_con.send(json({event: 'key', key_event: ev}))
		ui.capture_keys()
	}
	let mx = answer_con.frame && hs && ui.mx != null ? ui.mx - s.x : null
	let my = answer_con.frame && hs && ui.my != null ? ui.my - s.y : null
	ss_send_pointer(s, mx, my)

	let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
	a[n++] = id
	a[n++] = answer_con.frame
	// The renderer needs this to decide if nested DOM inputs can be active.
	a[n++] = ui.focused(id) ? SS_FOCUSED : 0
	ui_cmd_box_end(i)
	return i

}

ss.measure = function(a, i, axis) {
	let t = a[i+SS_FRAME]
	a[i+2+axis] = max(a[i+2+axis], a[i+0+axis])
	a[i+2+axis] += spacings(a, i, axis) + ((axis ? t?.h : t?.w) ?? 0)
	let min_w = a[i+2+axis]
	add_ct_min_wh(a, axis, min_w)
}

ss.hit = function(a, i) {
	if (!a[i+SS_FRAME])
		return
	let id = a[i+SS_ID]
	if (hit_rect(a[i+0], a[i+1], a[i+2], a[i+3])) {
		set_hit(id)
		return true
	}
}

let ss_ids = [] // attached to remote DOM inputs for routing through nested shared screens.
let ss_frame // frame to draw, null for this machine's own; see draw[CMD_TEXT].
let ss_screen_ids = [screen_id] // screens to draw. a repeat means a cycle.
// A remote input is active only if every shared screen containing it is focused.
let ss_focused = true
ss.draw = function(a, i) {
	let t = a[i+SS_FRAME]
	if (!t) return
	let id = a[i+SS_ID]
	if (ss_screen_ids.includes(t.id)) {
		let err = 'shared screen cycle'
		let m = measure_text(cx, err)
		let asc = m.actualBoundingBoxAscent
		let dsc = m.actualBoundingBoxDescent
		cx.fillStyle = color_css('button-danger')
		cx.textAlign = 'center'
		cx.fillText(err, a[i+0] + a[i+2] / 2, a[i+1] + (a[i+3] + asc - dsc) / 2)
		return
	}
	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let ss_focused0 = ss_focused
	let ss_frame0 = ss_frame
	ss_ids.push(id)
	ss_screen_ids.push(t.id)
	ss_frame = t
	ss_focused = ss_focused0 && (a[i+SS_STATE] & SS_FOCUSED)
	// the frame can be bigger than the box the layout gave us, and only what's
	// inside the box is hit-tested by ss.hit.
	cx.save()
	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.clip()
	cx.translate(x, y)
	let s = ui.render_state(id)
	if (!s.render_state_map) {
		s.render_state_map = create_render_state_map()
		s.free = function(s) {
			for (let [id, s1] of s.render_state_map)
				if (s1.free)
					s1.free(s1, id)
		}
	}
	draw_frame(t.recs, t.popups, s.render_state_map)
	draw_pointer(t, 0, 0)
	cx.restore()
	ss_ids.pop()
	ss_screen_ids.pop()
	ss_frame = ss_frame0
	ss_focused = ss_focused0

}

ui.box_widget('shared_screen', ss)

//// DRAG_POINT --------------------------------------------------------------

{
let ARGS  = 2+2+8+1
let COLOR = ARGS+0
let ID    = ARGS+1
let out = [0, 0, null]
ui.widget('drag_point', {
	ID: ID,
	create: function(cmd, id, x, y, color) {
		color ??= 'red'
		ui.state(id)
		ui.state_init(id, 'x', x)
		ui.state_init(id, 'y', y)
		x = ui.state_of(id, 'x')
		y = ui.state_of(id, 'y')
		let cs = ui.drag(id)
		if (cs) {
			if (cs.dragging) {
				x += cs.dx
				y += cs.dy
			}
			if (cs.drop) {
				ui.state(id).x = x
				ui.state(id).y = y
			}
		}

		// NOTE: we're making it a zero-sized box because it's freely movable.
		let i = ui_cmd_begin(cmd)
		a[n++] = x
		a[n++] = y
		a[n++] = 0; a[n++] = 0 // w, h
		a[n++] = 0; a[n++] = 0; a[n++] = 0; a[n++] = 0 // p
		a[n++] = 0; a[n++] = 0; a[n++] = 0; a[n++] = 0 // m
		a[n++] = 0 // fr
		a[n++] = color
		a[n++] = id
		ui_cmd_end(i)
		out[0] = x
		out[1] = y
		out[2] = i
		return out
	},
	position: function(a, i, axis, sx, sw) {
		a[i+0+axis] += sx
	},
	translate: function(a, i, dx, dy) {
		a[i+0] += dx
		a[i+1] += dy
	},
	draw: function(a, i) {
		let r = 5
		let x     = a[i+0]
		let y     = a[i+1]
		let color = a[i+COLOR]
		cx.fillStyle = color
		cx.beginPath()
		cx.rect(x-r, y-r, 2*r, 2*r)
		cx.fill()
	},
	hit: function(a, i) {
		let r = 5
		let x  = a[i+0]
		let y  = a[i+1]
		let id = a[i+ID]
		if (hit_rect(x-r, y-r, 2*r, 2*r)) {
			set_hit(id)
			return true
		}
	},
})
}

//// BUTTON ------------------------------------------------------------------

// NOTE: the button is activated only if the mouse button was released while
// over the button, and only if it was pressed while over the button, even
// though the mouse _is_ captured.

ui.button_stack = function(id, fr, align, valign, min_w, min_h) {
	ui.focusable(id)
	ui.keep_focus(id)
	ui.stack(id, fr, align ?? 's', valign ?? 'c', min_w, min_h ?? ui.em(1.5))
	ui.focus_ring(id)
}

function button_update(id, s) {
	let cs = captured(id)
	let hs = hit(id)
	let state
	if (clicked_button_id == id) {
		state = 'click'
	} else if (ui.focused(id) && (ui.keydown('enter') || ui.keydown(' '))) {
		if (ui.keydown('enter'))
			ui.capture_keys()
		state = 'active'
	} else if (ui.focused(id) && (ui.keyup('enter') || ui.keyup(' '))) {
		if (ui.keyup('enter'))
			ui.capture_keys()
		state = 'click'
	} else {
		state = cs && hs ? ui.clickup ? 'click' : 'active'
			: hs ? 'hover' : ui.focused(id) ? 'focused' : null
	}
	s.state = state
	if (state == 'click')
		ui.rebuild('click')
}

ui.button_bb = function(style, state) {
	state = repl(state, 'click', 'hover')
	style = style ?? 'button-bg'
	if (!style) // means no border
		return
	ui.shadow(state == 'active' ? 'button-active' : 'button')
	let radius = ui.sp05()
	let bg_state = repl(state, 'focused', null)
	ui.bb(style, bg_state, 1, 'intense', null, radius)
}

ui.button_text = function(s, state, w, h) {
	state = repl(state, 'click', 'hover')
	h ??= ui.em(2.2) // force h
	ui.bold()
	ui.color('button-text', state)
	ui.text('', s, 0, 'c', 'c', null, w, h)
}

ui.button_icon = function(font, icon, state, w, h) {
	state = repl(state, 'click', 'hover')
	ui.font(font)
	ui.font_size(1.5)
	ui.color('text', state)
	ui.text('', icon)
}

ui.end_button_stack = function(state) {
	ui.end_stack()
	return state == 'click'
}

// s is the label, or null for an icon-only button.
ui.icon_button = function(
	id, icon, s, fr, align, valign, min_w, min_h, style
) {
	min_w ??= ui.em(1.5) // force w
	min_h ??= ui.em(1.5) // force h
	ui.button_stack(id, fr, align, valign, min_w, min_h)
	let state = ui.state(id, button_update).state
	ui.button_bb(style, state)
	let [icon_font, icon_text] = assert(icons[icon], 'unknown icon ', icon)
	if (s == null) {
		ui.button_icon(icon_font, icon_text, state)
	} else {
		ui.p(ui.sp1(), 0)
		ui.h(0, ui.sp1(), 'c')
			ui.button_icon(icon_font, icon_text, state)
			ui.button_text(s, state)
		ui.end_h()
	}
	let clicked = ui.end_button_stack(state)
	return clicked
}

ui.bare_icon_button = function(id, icon, s, fr, align, valign, min_w, min_h) {
	return ui.icon_button(id, icon, s, fr, align, valign, min_w, min_h, '')
}

ui.button = function(id, s, fr, align, valign, min_w, min_h, style) {
	ui.button_stack(id, fr, align ?? 'l', valign ?? 'c', min_w, min_h)
	let state = ui.state(id, button_update).state
	ui.button_bb(style, state)
	ui.p(ui.sp2(), 0)
	ui.button_text(s, state)
	return ui.end_button_stack(state)
}

ui.primary_button = function(id, s, fr, align, valign, min_w, min_h) {
	return ui.button(id, s, fr, align, valign, min_w, min_h, 'button-primary')
}
ui.primary_icon_button = function(id, icon, s, fr, align, valign, min_w, min_h) {
	return ui.icon_button(id, icon, s, fr, align, valign, min_w, min_h, 'button-primary')
}

ui.btn = ui.button
ui.pri_btn = ui.primary_button

//// HIT EDGE ----------------------------------------------------------------

// a hit edge is a hit area stretched around a vert/horiz edge.
function hit_v_edge(id, hit_dx) {
	let hit_distance = ui.sp1()
	// hack: the native ew-resize cursor icon reads visually left-skewed,
	// so shift the hit area right without moving the rendered line.
	hit_dx ??= 0
	ui.popup(id, null, null, 'il', 's', hit_distance, null, 'solid',
		null, -hit_distance / 2 + hit_dx, null)
		ui.ml(-hit_dx)
		ui.stack('', 1, 's', 's')
}
function end_hit_v_edge() {
		ui.end_stack()
	ui.end_popup()
}

function hit_h_edge(id, hit_dx) {
	let hit_distance = ui.sp1()
	hit_dx ??= 0
	ui.popup(id, null, null, 'it', 's', null, hit_distance, 'solid',
		null, null, -hit_distance / 2 + hit_dx)
		ui.mt(-hit_dx)
		ui.stack('', 1, 's', 's')
}
function end_hit_h_edge() {
		ui.end_stack()
	ui.end_popup()
}

//// SPLIT -------------------------------------------------------------------

let split_stack = []

function split_stack_check() {
	assert(!split_stack.length, 'split not closed')
}

function split(hv, id, size, unit, fixed_side,
	split_fr, gap, align, valign, min_w, min_h,
) {

	let splitter_w = 1

	fixed_side ??= 1
	assert(fixed_side == 1 || fixed_side == 2)

	let horiz = hv == 'h'
	let W = horiz ? 'w' : 'h' // measured/main-axis size prop
	let cs = ui.drag_or_hit(id)
	let s = ui.state(id)
	let measured_wh = (cs?.dragging ? cs[W] : null) ?? s[W]
	let max_size = (measured_wh ?? 1/0) - splitter_w
	assert(!unit || unit == 'px' || unit == 'fr')
	let fixed = unit == 'px'
	let snap_px = fixed ? 50 * dpr : 50
	if (fixed && measured_wh == null)
		ui.rebuild('measure') // needed or `collapsed` may start out wrong and stay wrong.
	size = s.size ?? size
	let side_fr  = fixed ? 0 : (size ?? 0.5) // fr/px of the fixed_side pane
	let side_min = fixed ? (size ?? 0) * dpr : 0
	if (cs?.dragging) {
		if (cs.drag)
			cs[W] = s[W]
		let size_px = fixed ? side_min : round(side_fr * max_size)
		if (fixed && side_min == 1/0)
			size_px = max_size
		let delta = horiz ? cs.dx : cs.dy
		size_px += fixed_side == 2 ? -delta : delta // side 2 shrinks as the splitter moves toward it
		if (size_px < snap_px)
			size_px = 0
		else if (size_px > max_size - snap_px)
			size_px = max_size
		size_px = min(size_px, max_size)
		if (fixed)
			side_min = size_px
		else
			side_fr = size_px / max_size
		if (cs.drop)
			s.size = fixed
				? side_min != 0 && side_min == max_size ? 1/0 : side_min / dpr
				: side_fr
	}

	ui[hv](split_fr, gap, align, valign, min_w, min_h)

	if (cs)
		ui.set_cursor(horiz ? 'ew-resize' : 'ns-resize')
	ui.measure(id)

	let collapsed = fixed
		? side_min == 0 || side_min == 1/0 || side_min == max_size
		: side_fr == 0 || side_fr == 1

	let other_fr = fixed ? 1 : 1 - side_fr
	if (fixed && side_min == 1/0) {
		side_fr = 1
		side_min = 0
		other_fr = 0
	}

	let [fr1, min1, fr2, min2] = fixed_side == 1
		? [side_fr, side_min, other_fr, 0]
		: [other_fr, 0, side_fr, side_min]

	split_stack.push(hv, id, collapsed, fr2, min2)

	ui.sb(id+'.scrollbox1', fr1, null, null, null, null,
		horiz ? min1 : null, horiz ? null : min1)

	return size
}

// bias split edge hit area towards the right/bottom for two reasons:
// 1) the left/top side usually contains a scrollbar and the split hit area
// is on top so it interferes with that scrollbar.
// 2) the <-> cursor icon is anchored wrong (at least in Chrome).
let split_edge_hit_bias = 4

ui.splitter = function() {

	ui.end_sb()

	let n = split_stack.length
	let hv        = split_stack[n-5]
	let id        = split_stack[n-4]
	let collapsed = split_stack[n-3]
	let fr2       = split_stack[n-2]
	let min2      = split_stack[n-1]
	let horiz = hv == 'h'
	let st = hit(id) ? 'hover' : null

	if (hv == 'h') {
		ui.stack('', 0, 'l', 's', 1, 0)
			ui.border('l', 'intense', st)
			hit_v_edge(id, split_edge_hit_bias)
			if (collapsed) {
				ui.stack('', 1, 'c', 'c', 5, 2*ui.sp8())
					ui.border('lr', 'intense', st)
				ui.end_stack()
			}
			end_hit_v_edge()
		ui.end_stack()
	} else {
		ui.stack('', 0, 's', 't', 0, 1)
			ui.border('t', 'intense', st)
			hit_h_edge(id, split_edge_hit_bias)
				if (collapsed) {
					ui.stack('', 1, 'c', 'c', 2*ui.sp8(), 4)
						ui.border('tb', 'intense', st)
					ui.end_stack()
				}
			end_hit_h_edge()
		ui.end_stack()
	}

	ui.sb(id+'.scrollbox2', fr2, null, null, null, null,
		horiz ? min2 : null, horiz ? null : min2)
}

function end_split(hv) {

	ui.end_sb()

	if (hv == 'h')
		ui.end_h()
	else
		ui.end_v()
	split_stack.length -= 5

}

ui.hsplit = function(...args) { return split('h', ...args) }
ui.vsplit = function(...args) { return split('v', ...args) }

ui.end_hsplit = function() { end_split('h') }
ui.end_vsplit = function() { end_split('v') }

//// SECTION -----------------------------------------------------------------

ui.begin_section = function(id, title) {
	let s = ui.state(id)
	if (ui.clicked(id))
		s.open = !s.open
	ui.v()
		ui.stack(id)
			ui.h()
				ui.icon('', 'chevron')
				ui.text('', title)
			ui.end_h()
		ui.end_stack()
	return s.open
}

ui.end_section = function() {
	ui.end_v()
}

//// MENU --------------------------------------------------------------------

ui.icon_def('caret_right', 'tabler', '\ueb5f')

ui.menu = function(id, items, side, align) {

		let open_items = ui.state_of(id, 'open_items')
		if (!open_items) {
			open_items = []
			ui.state(id).open_items = open_items
		}

		function menu(level, items, side, align) {
			let radius = 0 // ui.sp()
			ui.popup(id, 'open', null, side, align, null, null, 'constrain change_side')
			ui.shadow('menu')
			ui.bb('bg1', null, 1, 'light', null, radius)
			ui.p(1)
			ui.v()
			let i = 0
			for (let item of items) {
				let first = i == 0
				let last = i == items.length-1
				let item_id = id+'.item.'+item.id
				let hover = hit(item_id)
				if (hover) {
					array_resize(open_items, level)
					if (item.items?.length)
						open_items[level] = item.id
				}
				let open = open_items[level] == item.id
				ui.stack(item_id)
					ui.pl(ui.em(3))
					ui.pr(ui.em(1))
					ui.pt(ui.sp2())
					ui.pb(ui.sp2() + (first ? 1 : 0))
					ui.bb(
						hover || open ? 'item' : 'bg1',
						hover || open ? 'focused item-selected item-focused' : null,
						first ? 'ltr' : last ? 'lbr' : '', null, null, radius)
					ui.border(last ? '' : 'b', 'light')
					ui.h(1, ui.sp2())
						ui.text('', item.label, 1)
						if (item.items?.length) {
							ui.pl(ui.sp2())
							ui.stack('', 0)
								ui.color('label')
								ui.icon('', 'caret_right')
							ui.end_stack()
							if (hover || open_items[level] == item.id) {
								ui.m(-ui.sp(), -1)
								menu(level + 1, item.items, 'r', '[')
							}
						}
					ui.end_h()
				ui.end_stack()
				i++
			}
			ui.end_v()
			ui.end_popup()
		}
		menu(0, items, side, align)
}

//// LIST --------------------------------------------------------------------

ui.valid_list_index = function(i, items) {
	return items.length ? clamp(i, 0, items.length-1) : null
}

function list_update(id, s) {
	s.input_value = undefined
	let items  = s.items
	let fi0 = s.value
	let fi = fi0
	let d = ui.focused(id) && (
			ui.keydown('arrowdown') &&  1 ||
			ui.keydown('arrowup'  ) && -1
		) || 0
	let fi_changed = d && 'key'
	if (d)
		fi = ui.valid_list_index(
			fi != null ? fi + d : d >= 0 ? 0 : items.length-1, items)
	let i = 0
	for (let item of items) {
		let item_id = id+'.'+i
		if (clicked(item_id)) {
			ui.focus(id)
			fi = i
			fi_changed = 'click'
		}
		i++
	}
	if (fi_changed)
		s.input_value = fi
	s.focused_item_changed = fi0 !== fi ? fi_changed : false
	let has_enter = fi != null && ui.focused(id) && ui.keydown('enter')
	s.picked = fi_changed == 'click' || !!has_enter
	if (has_enter)
		ui.capture_keys()
}
function hvlist(hv, id, items, focused_i,
	fr, align, valign,
	item_align, item_valign, item_fr,
	max_w, min_w,
	item_pad_l, item_pad_r, item_pad_y, item_h
) {
	let s = ui.state(id)
	s.items = items
	ui.state(id, list_update)
	focused_i = ui.set_value(s, focused_i)
	ui.focusable(id)
	let fi = focused_i
	let list_focused = ui.focused(id)
	// reveal the focused item on tab-focusing the list and on arrow keys.
	// a clicked item is excepted to avoid shifting it under the mouse pointer.
	let reveal_fi = ui.focusing(id) || s.focused_item_changed == 'key'
	let i = 0
	hv = hv || 'v'
	assert(hv == 'v' || hv == 'h')
	ui.hv(hv, fr, 0, align  ?? hv == 'v' ? 's' : '[', '[', min_w)
	for (let item of items) {
		let item_id = id+'.'+i
		ui.p(item_pad_l ?? ui.sp(), item_pad_y ?? ui.sp05(),
			item_pad_r ?? item_pad_l ?? ui.sp())
		if (fi == i && reveal_fi)
			ui.scroll_to_view_next_box()
		ui.stack(item_id, 0, 's', 's', null, item_h)
			let item_focused = fi == i
			ui.bb(
				item_focused ? 'item' : 'bg',
				item_focused
					? list_focused
						? 'item-focused item-selected focused'
						: 'item-focused item-selected'
					: null
	)
			ui.color('text', hit(item_id) ? 'hover' : null)
			ui.text('', item, item_fr,
				item_align  ?? (hv == 'v' ? 'l' : 'c'),
				item_valign ?? 'c',
				max_w)
			if (item_focused)
				ui.focus_ring(id)
		ui.end_stack()
		i++
	}
	ui.end()
	return focused_i
}
ui.hvlist = hvlist
ui.vlist = hvlist.bind(null, 'v')
ui.hlist = hvlist.bind(null, 'h')
ui.list = ui.vlist

//// LABEL -------------------------------------------------------------------

// a label is a clickable text that focuses an input.
ui.label = function(for_id, s, fr, align, valign) {
	let id = for_id+'.label'
	ui.color('text', hit(id) ? 'hover' : null)
	ui.text(id, s, fr, align ?? 'l', valign ?? 'c')
}

//// INPUT -------------------------------------------------------------------

ui.input_min_w_em = 10
ui.input_max_w_em = 12
ui.input_max_popup_w_em = 24
ui.em_input           = () => ui.em(ui.input_min_w_em)
ui.em_input_max       = () => ui.em(ui.input_max_w_em)
ui.em_input_max_popup = () => ui.em(ui.input_max_popup_w_em)

ui.input = function(id, value, fr, w, text_align, field, no_box) {
	if (clicked(id+'.label')) {
		ui.focus(id)
		ui.select_text(id, 0, 1/0)
	}
	let focused = ui.focused(id)
	if (!no_box) {
		ui.stack('', fr, 's', 's')
		ui.bb('input', focused ? 'focused' : null,
			1, 'intense', focused ? 'hover' : null)
		ui.p(ui.sp())
		ui.color('text', focused ? 'focused' : null)
	}
	value = ui.text_editable(id, value, no_box ? fr : 1,
		text_align ?? 's', 'c', null, w ?? ui.em_input(), null, field)
	if (!no_box)
		ui.end_stack()
	return value
}

//// NUM_SLIDER --------------------------------------------------------------

function num_slider_update(id, s) {

	s.input_value = undefined

	let input_id = id+'.input'
	let field = s.field
	let from = field.slider_min ?? field.min ?? 0
	let to = field.slider_max ?? field.max ?? 1
	let p_min = slider_p(field.min ?? from, from, to)
	let p_max = slider_p(field.max ?? to, from, to)

	if (clicked(id+'.label'))
		ui.focus(id)
	let focused = ui.focused(s.editing ? input_id : id)
	if (focused && (ui.keydown('f2') || ui.keydown('enter') || ui.dblclicked(id))) {
		s.editing = !s.editing
		if (s.editing) {
			ui.select_text(input_id, 0, 1/0)
			ui.focus(input_id)
		} else {
			ui.focus(id)
		}
		ui.capture_keys()
	} else if (s.editing && focused && ui.keydown('escape')) {
		s.editing = false
		ui.focus(id)
		ui.capture_keys()
	} else if (s.editing && !focused) {
		s.editing = false
	}

	let value = ui.input_value(input_id)
	if (value !== undefined)
		s.input_value = value

	if (!s.editing) {
		let cs = ui.drag(id+'.handle')
		let d = focused &&
			(ui.keydown('arrowright') && 1 ||
				ui.keydown('arrowleft') && -1)
		if (cs) {
			if (cs.drag) {
				let p = clamp(slider_p(s.value, from, to), p_min, p_max)
				cs.x0 = lerp(p, 0, 1, 0, s.w)
				ui.focus(id)
			}
			let p = clamp((cs.x0 + cs.dx) / s.w, p_min, p_max)
			s.input_value = lerp(p, 0, 1, from, to)
		} else if (d) {
			let p = clamp(slider_p(s.value, from, to)
				+ d * (ui.keypressed('shift') ? .01 : .1), p_min, p_max)
			s.input_value = lerp(p, 0, 1, from, to)
		} else if (focused && ui.keydown('delete')) {
			s.input_value = null
		}
		if (hit(id+'.handle') || cs)
			ui.set_cursor('ew-resize')
	}
}
ui.num_slider = function(
	id, value, field_or_min, max, decimals
) {
	let s = ui.state(id)
	let field
	if (isobj(field_or_min)) {
		field = field_or_min
	} else {
		field = s.field ??= ui.create_field({
			type: 'number',
			min: field_or_min ?? 0,
			max: max ?? 1,
			decimals: decimals ?? 2,
		})
	}
	s.field = field
	let from = field.slider_min ?? field.min ?? 0
	let to = field.slider_max ?? field.max ?? 1
	s = ui.state(id, num_slider_update)
	value = ui.set_value(s, value)

	let p_min = slider_p(field.min ?? from, from, to)
	let p_max = slider_p(field.max ?? to, from, to)
	let p = clamp(slider_p(value, from, to), p_min, p_max)
	let input_id = id+'.input'
	let focused = ui.focused(s.editing ? input_id : id)
	if (!s.editing)
		ui.focusable(id)

	let fr = fr0 ?? 1
	let align = align0 ?? 's'
	let valign = valign0 ?? 'c'
	let min_w = min_w0 ?? ui.em_input()
	ui.clear_box_args()

	let text = field.to_text(value)

	ui.stack(id, fr, align, valign, min_w)
		ui.bb(
			'input', focused ? 'focused' : null,
			1, 'intense', focused ? 'hover' : null)
		ui.p(1)
		ui.h(0, 0, 's', 's')
			ui.stack('', p_min, 's', 's')
			ui.end_stack()
			ui.stack('', p - p_min, 's', 's')
				ui.bb('bg3')
			ui.end_stack()
			ui.stack('', 1 - p, 's', 's')
				if (!s.editing) {
					hit_v_edge(id+'.handle')
					end_hit_v_edge()
				}
			ui.end_stack()
		ui.end_h()
		ui.p(ui.sp())
		ui.color('text', focused ? 'focused' : null)
		if (s.editing)
			ui.text_editable(input_id, value, 1, 'r', 'c', null, 0, null,
				field)
		else
			ui.text('', text, 1, 'r', 'c', null, 0)
		ui.measure(id)
	ui.end_stack()

	return value
}

//// SLIDER ------------------------------------------------------------------

function compute_step_and_range(wanted_n, min, max, scale_base, scales, decimals) {
	scale_base = scale_base || 10
	scales = scales || [1, 2, 2.5, 5]
	let d = max - min
	let min_scale_exp = floor((d ? logbase(d, scale_base) : 0) - 2)
	let max_scale_exp = floor((d ? logbase(d, scale_base) : 0) + 2)
	let n0, step
	let step_multiple = decimals != null ? 10**(-decimals) : null
	for (let scale_exp = min_scale_exp; scale_exp <= max_scale_exp; scale_exp++) {
		for (let scale of scales) {
			let step1 = scale_base ** scale_exp * scale
			let n = d / step1
			if (n0 == null || abs(n - wanted_n) < n0) {
				if (step_multiple == null || floor(step1 / step_multiple) == step1 / step_multiple) {
					n0 = n
					step = step1
				}
			}
		}
	}
	min = ceil  (min / step) * step
	max = floor (max / step) * step
	return [step, min, max]
}

let SLIDER_ID         = BOX_ARGS+0
let SLIDER_FROM       = BOX_ARGS+1
let SLIDER_TO         = BOX_ARGS+2
let SLIDER_DECIMALS   = BOX_ARGS+3
let SLIDER_P          = BOX_ARGS+4 // progress
let SLIDER_MARKERS    = BOX_ARGS+5
let SLIDER_SCALE_BASE = BOX_ARGS+6
let SLIDER_SCALES     = BOX_ARGS+7
let SLIDER_STATE      = BOX_ARGS+8

let SLIDER_HOVER          = 1
let SLIDER_FOCUSED        = 2
let SLIDER_FOCUSED_BY_KEY = 4

ui.slider_mark_w_em = 2
ui.slider_thumb_r_em = .6
ui.slider_shaft_h_em = 0.2

let slider = {ID: SLIDER_ID}

function slider_p(value, from, to) {
	return isnum(value) ? clamp(lerp(value, from, to, 0, 1), 0, 1) : .5
}

function slider_update(id, s) {

	s.input_value = undefined

	if (clicked(id+'.label'))
		ui.focus(id)

	let from = s.from
	let to = s.to
	let track_x = (s.x ?? 0) + s.pad_x
	let track_w = (s.w ?? 0) - 2*s.pad_x

	let cs = captured(id)
	let focused = ui.focused(id)
	let d = focused &&
		(ui.keydown('arrowright') && 1 || ui.keydown('arrowleft') && -1)

	if (cs) {
		let p = clamp((ui.mx - track_x) / track_w, 0, 1)
		s.input_value = lerp(p, 0, 1, from, to)
	} else if (d) {
		let p = slider_p(s.value, from, to)
			+ d * (ui.keypressed('shift') ? .01 : .1)
		s.input_value = lerp(clamp(p, 0, 1), 0, 1, from, to)
	} else if (focused && ui.keydown('delete')) {
		s.input_value = null
	}
}
slider.create = function(
	cmd, id, value, from, to, decimals, markers, scale_base, scales
) {

	let s = ui.state(id)
	ui.focusable(id)

	markers = (markers ?? 1) ? 1 : 0
	from ??= 0
	to ??= 1
	decimals ??= 2

	let fr = fr0 ?? 1
	let align = align0 ?? 's'
	let valign = valign0 ?? 'c'
	let min_w = min_w0 ?? ui.em_input()
	let min_h = min_h0 ?? ui.em((markers ? 2.8 : 1.2))
	ui.clear_box_args()

	let pad_x = markers ? ui.sp8() : ui.sp2()

	s.from = from
	s.to = to
	s.pad_x = pad_x
	ui.state(id, slider_update)
	value = ui.set_value(s, value)

	let p = slider_p(value, from, to)
	let hs = hit(id)
	let cs = captured(id)
	let focused = ui.focused(id)

	ui.stack()

		ui.p(pad_x, ui.sp05())
		let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
		a[n++] = id
		a[n++] = from
		a[n++] = to
		a[n++] = decimals
		a[n++] = round(p * 32767)
		a[n++] = markers
		a[n++] = scale_base ?? 10
		a[n++] = scales ?? 0
		a[n++] = (hs ? SLIDER_HOVER : 0)
			| (focused ? SLIDER_FOCUSED : 0)
			| (focused && ui.focused_by_key ? SLIDER_FOCUSED_BY_KEY : 0)
		ui_cmd_box_end(i)

		ui.measure(id)

	ui.end_stack()

	if (!markers && (hs || cs) && isnum(value)) {
		ui.m(ui.sp2())
		ui.p(ui.sp2(), ui.sp())
		let track_w = (s.w ?? 0) - 2*pad_x
		let ox = round((p - .5) * track_w)
		ui.popup(id+'.popup', 'tooltip', i,
				't', 'c', 0, 0, 'change_side constrain', null, ox)
			ui.bb_tooltip('info', null, 'light', null, ui.sp05())
			ui.text('', dec(value, decimals))
		ui.end_popup()
	}

	return value
}

slider.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]

	let p       = a[i+SLIDER_P] / 32767
	let markers = a[i+SLIDER_MARKERS]
	let state   = a[i+SLIDER_STATE]
	let hs      = state & SLIDER_HOVER
	let focused = state & SLIDER_FOCUSED
	let by_key  = state & SLIDER_FOCUSED_BY_KEY

	let shaft_h = round(ui.em(ui.slider_shaft_h_em))
	let r = round(shaft_h / 2) // shaft corner radius
	let thumb_r = ui.em(ui.slider_thumb_r_em)
	let margin_x = 0

	y += h - r - thumb_r
	x += margin_x
	w -= 2 * margin_x

	let thumb_cx = x + p * w
	let thumb_cy = y + r

	// draw shaft
	bg_path(cx, x - r, y, x + w + r, y + 2*r, BORDER_SIDE_ALL, 1000)
	cx.fillStyle = color_css('bg2', hs ? 'hover' : null)
	cx.fill()

	bg_path(cx, x - r, y, thumb_cx, y + 2*r, BORDER_SIDE_ALL, 1000)
	cx.fillStyle = color_css('link', hs ? 'hover' : null)
	cx.fill()

	bg_path(cx, x + .5 - r, y + .5, x + w - .5 + r, y + 2*r - .5, BORDER_SIDE_ALL, 1000)
	cx.strokeStyle = color_css('light')
	cx.stroke()

	// draw focus ring under thumb
	if (focused) {
		let hsl_color = color_hsl('item', 'item-focused item-selected focused')
		cx.fillStyle = hsl_adjust(hsl_color, 1, 1, 1, .5)
		cx.beginPath()
		cx.arc(thumb_cx, thumb_cy, thumb_r * 2, 0, 2 * PI)
		cx.fill()
		if (by_key) {
			cx.beginPath()
			cx.arc(thumb_cx, thumb_cy, thumb_r * 2 - 2, 0, 2 * PI)
			cx.strokeStyle = ui.color_css('max')
			cx.stroke()
		}
	}

	// draw thumb
	cx.fillStyle = color_css('link', hs ? 'hover' : null)
	ui.set_shadow('button')
	cx.beginPath()
	cx.arc(thumb_cx, thumb_cy, thumb_r, 0, 2 * PI)
	cx.fill()
	reset_shadow()

	if (markers) {

		let from       = a[i+SLIDER_FROM]
		let to         = a[i+SLIDER_TO]
		let scale_base = a[i+SLIDER_SCALE_BASE]
		let scales     = a[i+SLIDER_SCALES]
		let decimals   = a[i+SLIDER_DECIMALS]

		let max_n = floor(w / ui.em(ui.slider_mark_w_em))
		let [step, min, max] = compute_step_and_range(
			max_n, from, to, scale_base, scales, decimals)

		let hsl_color = color_hsl('label')
		cx.textAlign = 'center'
		let m = measure_text(cx, ' ')
		let asc = m.fontBoundingBoxAscent
		let dsc = m.fontBoundingBoxDescent
		let x0 = x

		let v = lerp(p, 0, 1, from, to)
		let vx = round(x0 + lerp(v, from, to, 0, w)) + .5

		for (let v = min; v <= max; v += step) {
			let x = round(x0 + lerp(v, from, to, 0, w)) + .5

			// shadow markers that are too close to the current value.
			let alpha = clamp(abs(vx - x) / ui.em(3) - .7, 0, 1)

			let c = hsl_adjust(hsl_color, 1, 1, 1, alpha)
			cx.fillStyle  = c
			cx.strokeStyle = c

			cx.beginPath()
			cx.moveTo(x, round(y - ui.em(1.0)) + .5)
			cx.lineTo(x, round(y - ui.em(0.6)) + .5)
			cx.stroke()

			let s = dec(v, decimals)
			cx.fillText(s, x, y - ui.em(1.2)) //  - asc - dsc)
		}

		// show a marker for the current value
		{
			let x = vx
			cx.fillStyle   = color_css('text')
			cx.strokeStyle = color_css('text')

			cx.beginPath()
			cx.moveTo(x, round(y - ui.em(1.0)) + .5)
			cx.lineTo(x, round(y - ui.em(0.6)) + .5)
			cx.stroke()

			let s = dec(v, decimals)
			cx.fillText(s, x, y - ui.em(1.2)) //  - asc - dsc)
		}

	}

}

ui.box_widget('slider', slider)

//// TOGGLE ------------------------------------------------------------------

ui.color_def('*', 'toggle'      , '*', 'bg2')
ui.color_def('*', 'toggle-thumb', 'normal', 'text', 'active')
ui.color_def('light', 'toggle', 'item-selected'      , 'link', 'normal')
ui.color_def('light', 'toggle', 'hover item-selected', 'link', 'hover' )
ui.color_def('dark' , 'toggle', 'item-selected'      , 'link', 'normal')
ui.color_def('dark' , 'toggle', 'hover item-selected', 'link', 'hover' )

let TOGGLE_ID    = BOX_ARGS+0
let TOGGLE_STATE = BOX_ARGS+1

let TOGGLE_ON      = 1
let TOGGLE_HOVER   = 2
let TOGGLE_FOCUSED = 4

ui.capture_keydown(' ')

// pill shape shared by toggle's own body and its larger focus ring.
function toggle_path(cx, x, y, w, h) {
	cx.beginPath()
	cx.roundRect(x, y, w, h, 1000)
}

let toggle = {}

function toggle_update(id, s) {
	s.input_value = undefined
	if (clicked(id+'.label'))
		ui.focus(id)
	let hs = hit(id) || hit(id+'.label')
	let focused = ui.focused(id)
	if ((hs && ui.click) || (focused && ui.keydown(' ')))
		s.input_value = !s.value
	else if (focused && ui.keydown('delete'))
		s.input_value = null
}

function toggle_create(cmd, id, on, fr, align, valign, min_w, min_h) {
	let s = ui.state(id, toggle_update)
	ui.focusable(id)
	on = ui.set_value(s, on)
	let hs = hit(id) || hit(id+'.label')
	let focused = ui.focused(id)
	let i = ui_cmd_box_begin(cmd, fr ?? 0, align ?? 'c', valign ?? 'c',
		min_w, min_h)
	a[n++] = id
	a[n++] = (on ? TOGGLE_ON : 0) | (hs ? TOGGLE_HOVER : 0) |
		(focused && ui.focused_by_key ? TOGGLE_FOCUSED : 0)
	ui_cmd_box_end(i)
	return on
}

toggle.create = function(cmd, id, on, fr, align, valign, min_w) {
	return toggle_create(cmd, id, on, fr, align, valign,
		min_w ?? ui.em(2.25), ui.em(1.25))
}
toggle.ID = TOGGLE_ID

toggle.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let flags = a[i+TOGGLE_STATE]
	let on = flags & TOGGLE_ON
	let hs = flags & TOGGLE_HOVER
	let focused = flags & TOGGLE_FOCUSED

	let prev_theme = theme

	// focus ring
	if (focused) {
		let m = 3
		toggle_path(cx, x - m, y - m, w + 2*m, h + 2*m)
		cx.strokeStyle = color_css('max', null)
		cx.lineWidth = 1
		cx.stroke()
	}

	// button
	toggle_path(cx, x, y, w, h)
	let state =
		(on ? STATE_ITEM_SELECTED : 0) |
		(hs ? STATE_HOVER         : 0)
	set_bg_color('toggle', state)
	cx.fill()

	// thumb
	cx.beginPath()
	let cx1 = on ? x + w - h / 2 : x + h / 2
	let cy1 = y + h / 2
	cx.arc(cx1, cy1, h * .35, 0, 2 * PI)
	cx.closePath()
	ui.set_shadow('button')
	cx.fillStyle = color_css('toggle-thumb', hs ? 'hover' : null)
	cx.fill()
	reset_shadow()

	theme = prev_theme
}

ui.box_widget('toggle', toggle)

//// CHECKBOX ----------------------------------------------------------------

let checkbox = {...toggle}

checkbox.create = function(cmd, id, on, fr, align, valign, min_w) {
	return toggle_create(cmd, id, on, fr ?? 0, align, valign,
		min_w ?? ui.em(1.5), ui.em(1.5))
}

checkbox.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let flags = a[i+TOGGLE_STATE]
	let on = flags & TOGGLE_ON
	let hs = flags & TOGGLE_HOVER
	let focused = flags & TOGGLE_FOCUSED

	let state =
		(on ? STATE_ITEM_SELECTED : 0) |
		(hs ? STATE_HOVER         : 0)

	// focus ring
	if (focused) {
		let m = 3
		cx.beginPath()
		cx.roundRect(x - m, y - m, w + 2*m, h + 2*m, 2 + m * dpr)
		cx.strokeStyle = color_css('max', null)
		cx.lineWidth = 1
		cx.stroke()
	}

	let prev_theme = theme

	// check box
	cx.beginPath()
	cx.roundRect(x, y, w, h, 2 * dpr)
	set_bg_color('toggle', state)
	cx.fill()

	// check mark
	if (on) {
		cx.beginPath()
		cx.save()
		cx.translate(x, y)
		cx.translate(0.5, 0.5)
		cx.scale(dpr, dpr)
		cx.moveTo( 3,  8)
		cx.lineTo( 7, 15)
		cx.lineTo(18,  4)
		cx.strokeStyle = color_css('toggle-thumb', hs ? 'hover' : null)
		cx.lineWidth = 1.5
		cx.lineCap = 'round'
		cx.lineJoin = 'round'
		cx.stroke()
		cx.restore()
	}

	theme = prev_theme

}

ui.box_widget('checkbox', checkbox)

//// RADIO -------------------------------------------------------------------

let radio = {...checkbox}

let RADIO_GROUP_ID = BOX_ARGS+2

function radio_group_update(id, s) { s.input_value = undefined }
ui.begin_radio_group = function(group_id) {
	ui.state(group_id, radio_group_update)
}
ui.end_radio_group = function(group_id, sel_val) {
	let s = ui.state(group_id)
	return ui.set_value(s, sel_val)
}

radio.create = function(cmd,
	id, group_id, own_val,
	fr, align, valign, min_w, min_h
) {
	ui.state(id)
	ui.state(group_id)
	ui.focusable(id)
	let sel_val = ui.value(group_id)
	let label_hit = hit(id+'.label') && ui.click
	if (label_hit)
		ui.focus(id)
	let dot_hit = hit(group_id) && ui.click
	let focused = ui.focused(id)
	let clicked_id = label_hit ? id : (dot_hit && hit(group_id, 'id'))
	if (!clicked_id && focused && ui.keydown(' ')) {
		clicked_id = id
		ui.rebuild('radio_pick')
	}
	let clicked = !!clicked_id
	let selected = clicked ? clicked_id == id : own_val === sel_val
	let hs = hit(id) || hit(id+'.label')
	let del = focused && ui.keydown('delete')
	if (del)
		ui.rebuild('radio_pick')
	let i = ui_cmd_box_begin(cmd, fr ?? 0, align ?? 'c', valign ?? 'c',
		min_w ?? ui.em(1.5),
		min_h ?? ui.em(1.5))
	a[n++] = id
	a[n++] = (selected ? TOGGLE_ON : 0) | (hs ? TOGGLE_HOVER : 0) |
		(focused && ui.focused_by_key ? TOGGLE_FOCUSED : 0)
	a[n++] = group_id
	ui_cmd_box_end(i)
	if (clicked && clicked_id == id)
		ui.state(group_id).input_value = own_val
	else if (del)
		ui.state(group_id).input_value = null
}

radio.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let flags = a[i+TOGGLE_STATE]
	let on = flags & TOGGLE_ON
	let hs = flags & TOGGLE_HOVER
	let focused = flags & TOGGLE_FOCUSED

	let cx1 = x + w / 2
	let cy1 = y + h / 2

	// focus ring

	if (focused) {
		cx.beginPath()
		cx.arc(cx1, cy1, h * .5 + 3, 0, 2 * PI)
		cx.strokeStyle = color_css('max', null)
		cx.lineWidth = 1
		cx.stroke()
	}

	let prev_theme = theme

	// button
	cx.beginPath()
	cx.arc(cx1, cy1, h * .5, 0, 2 * PI)
	set_bg_color('toggle', on ? 'item-selected' : hs ? 'hover' : null)
	cx.fill()

	// bullet
	cx.beginPath()
	cx.arc(cx1, cy1, h * (on ? .15 : 0), 0, 2 * PI)
	cx.closePath()
	ui.set_shadow('button')
	cx.fillStyle = color_css('toggle-thumb', hs ? 'hover' : null)
	cx.fill()
	reset_shadow()

	theme = prev_theme
}

radio.hit = function(a, i) {
	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let id = a[i+TOGGLE_ID]
	let group_id = a[i+RADIO_GROUP_ID]
	if (hit_rect(x, y, w, h)) {
		set_hit(group_id).id = id
		set_hit(id)
		return true
	}
}

ui.box_widget('radio', radio)

//// DROPDOWN ----------------------------------------------------------------

/*
	let open = ui.dropdown(id, [update], [want_open])
		... the value ...
	ui.dropdown_picker(id, [side], [align])
		if (open)
			... the picker, under id+'.picker' ...
	ui.end_dropdown(id)

	while the picker is up, tab cycles inside the dropdown: its box and its
	picker, so put whatever the control is made of inside the box.

	opening focuses the picker. closing focuses nothing: the caller that
	wants the focus back calls ui.focus() when the picker is closed and
	ui.focus_inside(id+'.picker') still says the focus is in it.

*/

function set_dropdown_open(id, s, open, picked) {
	if (!!s.open == !!open)
		return
	s.open = open
	if (open) {
		s.opened = true
		ui.focus_first(id+'.picker')
	} else {
		s.closed = true
		s.picked = !!picked
	}
}

ui.set_dropdown_open = function(id, open) {
	let s = ui.state_of(id)
	assert(s, 'set_dropdown_open(): dropdown not built: ', id)
	set_dropdown_open(id, s, open)
}

ui.dropdown_open = function(id) {
	return !!ui.state_of(id, 'open')
}

ui.dropdown_opened = function(id) {
	return !!ui.state_of(id, 'opened')
}

ui.dropdown_closed = function(id) {
	return !!ui.state_of(id, 'closed')
}

ui.dropdown_picked = function(id) {
	return !!ui.state_of(id, 'picked')
}

// sets ui.state(id).opened, .closed and .picked in the pass in which the
// dropdown opened or closed. responds to ui.set_dropdown_open() and to a
// click on the picker's id+'.pick' and id+'.cancel' buttons. sets
// ui.state(id).open.
ui.dropdown_update = function(id, s) {

	let picker_id = id+'.picker'
	let popup_id = id+'.popup'
	let pick_button_id = id+'.pick'
	let cancel_button_id = id+'.cancel'
	let open = s.open

	s.opened = false
	s.closed = false
	s.picked = false

	if (clicked(id+'.label'))
		ui.focus(id)

	let click = clicked(id)
	// id is the dropbox or the grid cell
	let picked = ui.dropdown_picked(picker_id)
		|| ui.state_of(pick_button_id, 'state') == 'click'
	let cancel = ui.state_of(cancel_button_id, 'state') == 'click'

	let enter = ui.focused(id) && ui.keydown('enter')
	let f2 = open && ui.keydown('f2') && ui.focus_inside(picker_id)

	let toggle = click || enter || cancel || f2
	let escape = open && ui.keydown('escape') && ui.focus_inside(picker_id)
	let click_outside = open && ui.click && !hovers(popup_id)

	if (picked || escape || click_outside) {
		open = false
		if (escape)
			ui.capture_keys()
	} else if (toggle) {
		open = !open
		if (enter || f2)
			ui.capture_keys()
	}

	set_dropdown_open(id, s, open, picked)
}

// opened by ui.set_dropdown_open().
ui.dropdown = function(id, update, want_open) {

	let s = ui.state(id, update)
	if (!s.update)
		ui.state(id, ui.dropdown_update)
	s.open ??= false
	if (want_open)
		set_dropdown_open(id, s, true)
	let open = s.open

	ui.v()

		ui.focus_group(open, null, id)
		ui.stack(id)

	return open
}

ui.dropdown_picker = function(id, side, align) {
	ui.end_stack()
	if (ui.state_of(id, 'open')) {
		ui.popup(id+'.popup', 'open', null, side ?? 'it', align ?? 's',
			0, 0, 'constrain change_side solid')
		ui.shadow('picker')
		ui.bb('input') // background only: end_dropdown() draws the border
		ui.focus_group(false, null, id+'.picker')
		ui.stack()
	}
}

ui.end_dropdown = function(id) {
	if (ui.state_of(id, 'open')) {
		ui.end_stack()
		ui.end_focus_group()
		// last, so that the picker's item backgrounds don't paint over it.
		ui.bb(null, null, 1, 'intense')
		ui.end_popup()
	}
	ui.end_focus_group()
	ui.end_v()
}

//// LIST_DROPDOWN -----------------------------------------------------------

const chevron_points = [0.5, 4.5, 7, 11, 13.5, 4.5]

function draw_value_row(items, item_i, row_id, pad, chevron_w, max_w, w) {
	ui.stack(row_id ?? '', 0)
		ui.p(pad)
		ui.h(0, pad)
			let s = item_i != null ? items[item_i] : ''
			ui.text('', s, 1, 'l', 'c',
				max_w ?? ui.em_input_max(),
				w == -1 ? w : (w ?? ui.em_input()) - chevron_w,
			)
			ui.stack('', 0, null, null, chevron_w)
				ui.polyline('', chevron_points, false, null, null, 'label')
			ui.end_stack()
		ui.end_h()
	ui.end_stack()
}

function list_dropdown_update(id, s) {

	s.input_value = undefined

	let picker_id = id+'.picker'
	let items = s.items

	ui.dropdown_update(id, s)

	if (clicked(id+'.value'))
		set_dropdown_open(id, s, !s.open, true)

	if (s.opened)
		s.revert_value = s.value
	else if (s.closed)
		s.input_value = s.picked ? ui.value(picker_id) : s.revert_value

	let picker_i = ui.input_value(picker_id)
	if (picker_i !== undefined)
		s.input_value = picker_i

	if (ui.keydown('delete') && (ui.focused(id) || ui.focus_inside(id)))
		s.input_value = null

	// arrow keys move the selection with the list closed.
	if (!s.open && ui.focused(id)) {
		let d = ui.keydown('arrowup') && -1 || ui.keydown('arrowdown') && 1 || 0
		if (d) {
			let i = s.value
			s.input_value = ui.valid_list_index(
				i != null ? i + d : d >= 0 ? 0 : items.length-1, items)
		}
	}
}

ui.list_dropdown = function(id, items, sel_i, fr, max_w, w) {

	let picker_id = id+'.picker'
	let value_id = id+'.value'

	let pad = ui.sp()
	let chevron_w = ui.em(1)

	ui.stack('', fr, 's', 's')

	ui.focusable(id)
	let s = ui.state(id)
	s.items = items
	let open = ui.dropdown(id, list_dropdown_update)
	sel_i = ui.set_value(s, sel_i)

	if (!open && ui.focus_inside(picker_id))
		ui.focus(id)

		if (!open)
			ui.bb('input', ui.focused(id) ? 'focused' : null,
				1, 'intense', ui.focused(id) ? 'hover' : null)
		draw_value_row(items, sel_i, null, pad, chevron_w,
			max_w ?? ui.em_input_max(),
			w)

	ui.dropdown_picker(id)

		if (open) {
			ui.v()
				draw_value_row(items, sel_i, value_id, pad, chevron_w, max_w)
				ui.scrollbox(picker_id+'.sb', 1, 'contain', 'auto', 's', 's')
					ui.list(picker_id, items, sel_i, 0, 's', 's', 'l', 'c', 0,
						max_w ?? ui.em_input_max_popup(),
						null,
						pad, pad * 2 + chevron_w, pad)
				ui.end_scrollbox()
				ui.resizer(id+'.resizer', null, ui.em(16), 'y')
			ui.end_v()
		}

	ui.end_dropdown(id)

	ui.end_stack()

	return sel_i
}

// dropdowns have fixed w by default that aligns with inputs.
// these inline dropdowns have dynamic width for use inline inside text.
ui.list_dropdown_inline = function(id, items, sel_i, fr, max_w) {
	return ui.list_dropdown(id, items, sel_i, fr, max_w, -1)
}

//// CALENDAR ----------------------------------------------------------------

function on_calendar_frame(a, i, x, y, w, h, vx, vy, view_w, view_h) {

	let id     = a[i+FRAME_ARGS_I+0]
	let ranges = a[i+FRAME_ARGS_I+1]

	let cell_w = snap(ui.em(2.5), 2)
	let cell_h = snap(ui.em(2.5), 2)

	let now = time()
	let start_week = week(now)

	// break down scroll offset into start week and relative scroll offset.
	let sy = vy - y
	let sy_weeks_f = sy / cell_h
	let sy_weeks = floor(sy_weeks_f)
	let rel_sy = floor((sy_weeks_f - sy_weeks) * cell_h)
	let week0 = week(start_week, sy_weeks)

	let today = day(now)

	// align UTC-today to local-today.
	let today_local = day(now, 0, true)
	if (month_day_of(today_local, true) != month_day_of(today))
		today = day(today, today_local < today ? -1 : 1)

	let sel_day = ui.value(id)
	let hit_day = ui.hovers(id) && num(ui.hit_match(id+'.day.'))

	let calendar_focused = ui.focused(id)

	ui.mt(sy - rel_sy)
	ui.v(0)
	let d_days = -7
	let visible_weeks = floor(view_h / cell_h)
	for (let week_i = -1; week_i <= visible_weeks; week_i++) {
		ui.h(0)
		for (let weekday = 0; weekday < 7; weekday++) {
			let d = day(week0, d_days)
			let n = floor(1 + days(d - month(d)))
			let m = month_of(d)

			ui.stack(id+'.day.'+d, 0, 'l', 't', cell_w, cell_h)

				if (d == sel_day) {

					ui.bb('item', calendar_focused
						? 'item-focused item-selected focused'
						: 'item-focused item-selected'
					)

					if (calendar_focused)
						ui.focus_ring()

				} else if (m % 2) {
					ui.bb('alt')
				}
				//ui.bb('bg2', null, 'ltb', 'intense', null, 1/0)
				ui.pr(ui.em(0.65))
				ui.color('text', d == hit_day ? 'active' : null)
				ui.text('', n+'', 0, 'r', 'c')
				if (n == 1) {
					ui.mt(ui.em(1.5))
					ui.xsmall()
					ui.color('marker')
					let s = month_name(d).toUpperCase()
					ui.text('', s, 0, 'c', 'c')
				} else if (n == 2 && m == 1) {
					ui.mt(ui.em(1.5))
					ui.xsmall()
					ui.color('marker')
					let s = ' ' + year_of(d)
					ui.text('', s, 0, 'c', 'c')
				}
				if (d == today) {
					ui.mb(ui.em(1.5))
					ui.xsmall()
					ui.color('marker')
					let s = S('today', 'today').toUpperCase()
					ui.text('', s, 0, 'c', 'c')
				}
			ui.end_stack()

			d_days++
		}
		ui.end_h()
	}
	ui.end_v()
}

function calendar_update(id, s) {

	s.input_value = undefined

	let ranges = s.ranges
	let h = s.h ?? 0

	let sel_day = s.value

	if (s.year0 != null) { // the lists have drawn
		let yi = ui.input_value(id+'.year' )
		let mi = ui.input_value(id+'.month')
		if (yi !== undefined || mi !== undefined) {
			let d = sel_day ?? day(time())
			let y = s.year0 + (yi ?? year_of(d) - s.year0)
			let m = (mi ?? month_of(d) - 1) + 1
			let last_month_day = month_day_of(month(time(y, m, 1), 1) - 1)
			sel_day = time(y, m, min(month_day_of(d), last_month_day))
			s.input_value = sel_day
		}
	}

	let hit_day = num(ui.hit_match(id+'.day.'))
	let clicked_day
	if (hit_day) {
		let cs = ui.drag(id+'.day.'+hit_day)
		// the press sets the day and the release fires the pick, so that an
		// editor built around the calendar reads the new day on a frame
		// where its dropdown is still open.
		if (cs) {
			if (cs.drag) {
				ui.focus(id)
				sel_day = hit_day
				s.input_value = sel_day
			}
			if (cs.drop)
				clicked_day = true
		}
	}

	if (ui.focused(id) && ui.keys_down()) {
		let mode = 'day'
		let focused_range
		let ctrl  = ui.keypressed('ctrl')
		let shift = ui.keypressed('shift')
		if (mode == 'ranges' && ui.keydown('delete')) {
			if (focused_range) {
				if (!e.can_remove_range(focused_range))
					return
				remove_value(ranges, focused_range)
				focused_range = null
				ranges_changed(ev)
				sort_ranges()
				return false
			}
		}

		if (ui.keydown('delete')) {
			sel_day = null
			s.input_value = null
			ui.capture_keys()
		} else if (ctrl && (ui.keydown('arrowup') || ui.keydown('arrowdown'))) {
			let sy = s.scroll_y ?? 0
			s.scroll_y = sy + (ui.keydown('arrowup') ? -1 : 1) * h / 2
			ui.capture_keys()
		} else if (ui.keydown('pageup') || ui.keydown('pagedown')) {
			let sy = s.scroll_y ?? 0
			s.scroll_y = sy + (ui.keydown('pageup') ? -1 : 1) * h
			ui.capture_keys()
		} else if (!ctrl && (
				ui.keydown('arrowdown') || ui.keydown('arrowup') ||
				ui.keydown('arrowleft') || ui.keydown('arrowright')
			)
		) {
			let ddays = (ui.keydown('arrowup') || ui.keydown('arrowdown') ? 7 : 1)
				* ((ui.keydown('arrowdown') || ui.keydown('arrowright') ? 1 : -1))

			if (mode == 'day') {
				sel_day = day(sel_day ?? time(), ddays)
				s.input_value = sel_day
				ui.capture_keys()
			} else if (focused_range && e.can_change_range(focused_range)) {
				let r = focused_range
				let min_range = e.min_range - 24 * 3600
				let max_range = e.max_range - 24 * 3600
				let d0 = r[0]
				let d1 = r[1]
				let days = d1 - d0
				if (!shift) { // move
					d0 = day(d0, ddays)
					d1 = d0 + days
				} else { // resize
					d1 = day(d1, ddays)
				}
				days = clamp(d1 - d0, min_range, max_range)
				r[0] = d0
				r[1] = d0 + days
				ranges_changed(ev)
				sort_ranges()
				e.scroll_to_view_range(r[0], r[1], 0)
				return false
			}
		}

		if (0 && ui.keydown('tab')) {
			if (e.focus_next_range(shift)) {
				ui.capture_keys()
				return false // prevent tabbing out on internal focusing
			}
			e.focus_range(null)
		}
	}

	let picked_by_key = sel_day != null && ui.focused(id) && ui.keydown('enter')
	let picked = clicked_day || picked_by_key
	s.picked = !!picked
	if (picked && picked_by_key)
		ui.capture_keys()
}

let months = []
for (let i = 0; i < 12; i ++)
	months[i] = month_name(time(2000, i+1, 1))

ui.calendar = function(id, sel_day, ranges, fr, align, valign, min_w, min_h) {

	ui.focusable(id)
	let s = ui.state(id)
	s.ranges = ranges
	let day0 = s.value
	ui.state(id, calendar_update)
	sel_day = ui.set_value(s, sel_day)

	let h = s.h ?? 0
	let cell_w = snap(ui.em(2.5), 2)
	let cell_h = snap(ui.em(2.5), 2)
	let cells_w = cell_w * 7

	if (day0 !== sel_day && sel_day != null) {
		let weeks_from_this_week = days(week(sel_day) - week(time())) / 7
		ui.scroll_to_view_rect(id, 0,
			(weeks_from_this_week + 1) * cell_h,
			cells_w, cell_h)
	}

	ui.h(fr)

		let shown_day = sel_day ?? day(time())
		let shown_year = year_of(shown_day)
		let this_year = year_of(time())
		let year0 = (shown_year >= this_year - 6 && shown_year <= this_year + 5)
			? this_year - 6 : shown_year - 6
		if (s.year0 != year0) {
			let years = s.years ?? []
			for (let i = 0; i < 12; i++)
				years[i] = (year0 + i)+''
			s.years = years
			s.year0 = year0
		}
		ui.list(id+'.year', s.years, shown_year - year0,
			0, null, null, null, null, null, null, ui.em(6))
		ui.list(id+'.month', months, month_of(shown_day) - 1,
			0, null, null, null, null, null, null, ui.em(6))

		ui.v(0, 0, align, valign, min_w, min_h ?? cell_h * 6)

			let now = time()
			let week0 = week(now)

			// week days header
			ui.h(0)
			ui.bb('bg1', null, 'b', 'intense')
			for (let weekday = 0; weekday < 7; weekday++) {
				let s = weekday_name(day(week0, weekday), 'short', lang()).slice(0, 1).toUpperCase()
				ui.stack('', 0, null, null, cell_w, cell_h)
					ui.pr(em(1))
					ui.text('', s, 0, 'r', 'c')
				ui.end_stack()
			}
			ui.end_h()

			// days in virtual scrollbox
			ui.scrollbox(id, 1, null, 'infinite')
			ui.measure(id)
				ui.bb('bg0')
				ui.frame(noop, on_calendar_frame, 1, null, null, 0, 0,
					id, ranges,
			)
			ui.end_scrollbox()

		ui.end_v()

	ui.end_h()

	return sel_day
}

//// DATE INPUT --------------------------------------------------------------

function date_input_update(id, s) {

	s.input_value = undefined

	let picker_id = id+'.picker'
	let input_id = id+'.input'

	ui.dropdown_update(id, s)

	if (ui.focused(input_id) && (ui.keydown('f2') || ui.keydown('enter'))) {
		ui.set_dropdown_open(id, !ui.dropdown_open(id))
		ui.capture_keys()
	} else if (ui.focused(input_id) && ui.keydown('escape')
		&& ui.dropdown_open(id)) {
		ui.set_dropdown_open(id, false)
		ui.capture_keys()
	}

	if (ui.dropdown_opened(id))
		s.revert_value = s.value
	else if (ui.dropdown_closed(id))
		s.input_value = ui.dropdown_picked(id)
			? ui.value(picker_id) : s.revert_value

	let value = ui.input_value(input_id)
	if (value !== undefined)
		s.input_value = value

	let d = ui.input_value(picker_id)
	if (d !== undefined)
		s.input_value = d
}

ui.date_input = function(id, v, field, fr, align, valign, min_w) {

	let picker_id = id+'.picker'
	let input_id = id+'.input'

	let s = ui.state(id)
	field ??= s.field ??= ui.create_field({type: 'date'})
	ui.state(id, date_input_update)

	if (clicked(id+'.label')) {
		ui.focus(input_id)
		ui.select_text(input_id, 0, 1/0)
	}

	let focused = ui.focused(input_id)
	let open = ui.dropdown(id)
	if (!open && ui.focus_inside(picker_id))
		ui.focus(input_id)

	let opened = ui.dropdown_opened(id)
	if (ui.dropdown_picked(id)) {
		ui.focus(input_id)
		ui.select_text(input_id, 0, 1/0)
	}

	let value = ui.set_value(s, v)

	let input_align = parse_align(align ?? 'r')
	input_align = input_align == ALIGN_END ? 'sr'
		: input_align == ALIGN_CENTER ? 'sc' : 's'

		ui.stack(input_id, fr, 's', 's')
			ui.bb('input', focused ? 'focused' : null,
				1, 'intense', focused ? 'hover' : null)
			ui.h(0, 0, 's', 's', min_w ?? ui.em_input())
				ui.p(ui.sp(), ui.sp(), 0, ui.sp())
				ui.icon(id, 'calendar', 0, 'l', 'c')
				ui.p(ui.sp05(), ui.sp(), ui.sp(), ui.sp())
				ui.color('text', focused ? 'focused' : null)
				ui.text_editable(input_id, value, 1,
					input_align, valign ?? 'c', null, null, null, field)
			ui.end_h()
		ui.end_stack()

	ui.dropdown_picker(id, 'b', 'cs')

		if (open) {
			let sel_day = isnum(value) ? day(value) : null
			if (opened) {
				let day0 = sel_day ?? day(time())
				ui.state(picker_id).scroll_y =
					days(week(day0) - week(time())) / 7
					* snap(ui.em(2.5), 2)
			}
			ui.calendar(picker_id, sel_day, null)
			ui.resizer(id+'.resizer', null, null, 'y')
		}

	ui.end_dropdown(id)

	return value
}

//// IMAGE -------------------------------------------------------------------

function create_image(src, data) { // called from async callback!
	let image = new Image()
	image.src = data
	image.onload = function() {
		let s = ui.state_of(src)
		if (!s) return
		s.image = image
		s.data = data
		s.loading = false
		animate() // rebuild() won't work as we're not in ui.main() here!
	}
}

let img = {}

img.create = function(cmd, src, fr, align, valign, max_min_h, min_w, min_h) {

	// TODO: check expire time and refetch on a timer.
	// TODO: check etag and refetch on a timer.
	let s = ui.state(src)
	let data = s.data
	if (!data && !s.loading) {
		s.loading = true
		if (src.startsWith('data:')) {
			create_image(src, src)
		} else {
			get(src, function(blob) {
				let reader = new FileReader()
				reader.onloadend = function() {
					create_image(src, reader.result)
				}
				reader.readAsDataURL(blob)
			}, null, {response_type: 'blob'})
		}
	}

	let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
	a[n++] = src
	a[n++] = max_min_h ?? 0 // -1=inf
	a[n++] = data ?? ''
	ui_cmd_box_end(i)

	return i

}

img.measure = function(a, i, axis) {
	if (!axis) return // can't impose a width (min_w still works)

	let sw        = a[i+2]
	let src       = a[i+BOX_ARGS+0]
	let max_min_h = a[i+BOX_ARGS+1]

	let image = ui.state_of(src, 'image')
	if (!image?.complete) return
	let iw = image.width
	let ih = image.height
	if (!iw || !ih) return

	let max_h = (ih / iw) * sw // max h for max w that fits
	let min_h = min(max_h, repl(max_min_h, -1, 1/0))
	let user_min_h = a[i+0+1]
	a[i+0+1] = max(user_min_h, min_h)
	box_measure(a, i, axis)
}

img.position = function(a, i, axis, sx, sw) {
	if (!axis) {
		// can't compute x,w until we know min_h, so assume align is stretch.
		a[i+0+0] = inner_x(a, i, 0, sx)
		a[i+2+0] = inner_w(a, i, 0, sw)
	} else {
		let sy = sx
		let sh = sw
		sx            = a[i+0+0]
		sw            = a[i+2+0]
		let min_h     = a[i+0+1]
		let src       = a[i+BOX_ARGS+0]
		let max_min_h = a[i+BOX_ARGS+1]

		let image = ui.state_of(src, 'image')
		if (!image?.complete) return
		let iw = image.width
		let ih = image.height
		if (!iw || !ih) return

		// fit image into the available space preserving aspect ratio.
		if (iw / ih > sw / sh) {
			a[i+2+0] = sw
			a[i+2+1] = sw * ih / iw
		} else {
			a[i+2+0] = sh * iw / ih
			a[i+2+1] = sh
		}

		// NOTE: 'stretch' align doesn't make sense with fitted images.
		a[i+0+0] = inner_x(a, i, 0, align_x(a, i, 0, sx, sw))
		a[i+2+0] = inner_w(a, i, 0, align_w(a, i, 0, sw))
		a[i+0+1] = inner_x(a, i, 1, align_x(a, i, 1, sy, sh))
		a[i+2+1] = inner_w(a, i, 1, align_w(a, i, 1, sh))
	}
}

img.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]

	let src  = a[i+BOX_ARGS+0]
	let data = a[i+BOX_ARGS+2]

	let image = ui.local_state(src, 'image')
	if (!image) { // frame came from another machine: decode the bytes here
		let s = ui.render_state(src)
		image = s.image
		if (data && !image) { // have data but no image (remote image)
			image = new Image()
			image.onload = function() {
				animate()
			}
			image.src = data
			s.image = image
		}
	}
	if (!image?.complete) return
	if (!w || !h) return

	cx.drawImage(image, x, y, w, h)
}

ui.box_widget('img', img)

//// IMAGE_DATA --------------------------------------------------------------

ui.image_data = function(id, key, w, h) {
	let s = ui.render_state(id)
	let idata = s[key]
	if (!idata
		|| s[key+'.w'] != w
		|| s[key+'.h'] != h
	) {
		idata = cx.createImageData(w, h)
		s[key] = idata
		s[key+'.w'] = w
		s[key+'.h'] = h
	}
	return idata
}

//// COLOR PICKER ------------------------------------------------------------

const GRADIENT_SLIDER_ID      = BOX_ARGS+0
const GRADIENT_SLIDER_HUE     = BOX_ARGS+1
const GRADIENT_SLIDER_SAT     = BOX_ARGS+2
const GRADIENT_SLIDER_HIT_P   = BOX_ARGS+3
const GRADIENT_SLIDER_VALUE_P = BOX_ARGS+4

const COLOR_HEX_RE = /^#[0-9a-f]{6}$/i

function make_gradient_draw_fn(draw_pixel) {
	return function(idata, hue, sat) {
		if (idata.ready && idata.hue == hue && idata.sat == sat)
			return
		let data = idata.data
		let w = idata.width
		let h = idata.height
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				let fraction = lerp(x, 0, w-1, 0, 1)
				draw_pixel(data, (y * w + x) * 4, fraction, hue, sat)
			}
		}
		idata.ready = true
		idata.hue = hue
		idata.sat = sat
	}
}
function draw_hue_pixel(data, pixel_i, fraction) {
	hsl_to_rgb_out(data, pixel_i, fraction * 360, 1, .5)
}
function draw_sat_pixel(data, pixel_i, fraction, hue) {
	hsl_to_rgb_out(data, pixel_i, hue, fraction, .5)
}
function draw_lum_pixel(data, pixel_i, fraction, hue, sat) {
	hsl_to_rgb_out(data, pixel_i, hue, sat, fraction)
}
let draw_hue_gradient = make_gradient_draw_fn(draw_hue_pixel)
let draw_sat_gradient = make_gradient_draw_fn(draw_sat_pixel)
let draw_lum_gradient = make_gradient_draw_fn(draw_lum_pixel)

function draw_gradient_cursor(x, y, w, h, p, alpha) {
	if (p == null)
		return
	let cursor_x = round(x + p * (w-1)) + .5
	let cursor_w = ui.sp05()
	let cursor_h = ui.sp05()
	cx.fillStyle = ui.alpha_adjust(ui.color_hsl('text'), alpha)
	cx.beginPath()
	cx.moveTo(cursor_x, y)
	cx.lineTo(cursor_x-cursor_w, y-cursor_h)
	cx.lineTo(cursor_x+cursor_w, y-cursor_h)
	cx.closePath()
	cx.moveTo(cursor_x, y+h+1)
	cx.lineTo(cursor_x-cursor_w, y+h+cursor_h+1)
	cx.lineTo(cursor_x+cursor_w, y+h+cursor_h+1)
	cx.closePath()
	cx.fill()
}

function gradient_slider(draw_gradient, name, max_value, key_step,
	shift_key_step, display_decimals
) {

	function slider_p(value) {
		return isnum(value) ? clamp(value / max_value, 0, 1) : .5
	}

	function slider_value(p) {
		return lerp(clamp(p, 0, 1), 0, 1, 0, max_value)
	}

	function is_slider_value(value) {
		return isnum(value) && value >= 0 && value <= max_value
	}

	function update(id, s) {

		s.input_value = undefined
		if (ui.clicked(id+'.label'))
			ui.focus(id)

		let cs = ui.drag(id, 'x')
		if (cs) {
			if (cs.drag)
				ui.focus(id)
			if (cs.dragging)
				s.input_value = slider_value(
					cs.p + cs.dx / (cs.w-1))
		}

		if (ui.focused(id)) {
			let step = ui.keydown('arrowright') && 1
				|| ui.keydown('arrowleft') && -1
			if (step) {
				let value = is_slider_value(s.value)
					? s.value : s.valid_value ?? max_value / 2
				let d = ui.keypressed('shift') ? shift_key_step : key_step
				s.input_value = slider_value((value + d * step) / max_value)
			} else if (ui.keydown('delete')) {
				s.input_value = null
			}
		}

		let text = ui.input_value(id+'.input')
		if (text !== undefined)
			s.input_value = text == null ? null : num(text) ?? text
	}

	ui.box_widget(name, {

		ID: GRADIENT_SLIDER_ID,

		create: function(cmd, id, value, hue, sat, fr, align, valign,
			min_w, min_h
		) {
			let s = ui.state(id, update)
			let prev_value = s.value
			value = ui.set_value(s, value)
			if (is_slider_value(value))
				s.valid_value = value

			let input_id = id+'.input'
			let box_text = ui.value(input_id)
			let has_box_input = ui.input_value(input_id) !== undefined
			let text = box_text
			if ((!has_box_input && value !== prev_value) || text === undefined)
				text = value == null || !isnum(value)
					? value : dec(value, display_decimals)

			let hit_p = ui.hit(id, 'p')
			let value_p = slider_p(
				is_slider_value(value) ? value : s.valid_value)

			ui.h(fr ?? 0, ui.sp1(), align, valign,
				min_w, min_h ?? ui.em(1.5))
				ui.focus_group(false, null, id)
					ui.focusable(id)
					ui.stack()
						let i = ui_cmd_box_begin(cmd, null, null, null, ui.em(6), 0)
						a[n++] = id
						a[n++] = hue
						a[n++] = sat
						a[n++] = hit_p
						a[n++] = value_p
						ui_cmd_box_end(i)
						if (ui.focused(id))
							ui.focus_ring()
					ui.end_stack()
					ui.input(input_id, text, 0, ui.em(3), 'sr')
				ui.end_focus_group()
			ui.end_h()
			return value
		},

		draw: function(a, i) {
			let id      = a[i+GRADIENT_SLIDER_ID]
			let hue     = a[i+GRADIENT_SLIDER_HUE]
			let sat     = a[i+GRADIENT_SLIDER_SAT]
			let hit_p   = a[i+GRADIENT_SLIDER_HIT_P]
			let value_p = a[i+GRADIENT_SLIDER_VALUE_P]

			let x = a[i+0]
			let y = a[i+1]
			let w = a[i+2]
			let h = a[i+3]

			let idata = ui.image_data(id, name, w, h)
			draw_gradient(idata, hue, sat)
			cx.putImageData(idata, x, y)

			draw_gradient_cursor(x, y, w, h, value_p, 1)
		},

		hit: function(a, i) {
			let id = a[i+GRADIENT_SLIDER_ID]
			let x = a[i+0]
			let y = a[i+1]
			let w = a[i+2]
			let h = a[i+3]
			let hs = ui.hit_rect(x, y, w, h) && ui.set_hit(id)
			if (hs) {
				hs.p = clamp(lerp(ui.mx-x, 0, w-1, 0, 1), 0, 1)
				hs.w = w
				return true
			}
		},

	})
}
gradient_slider(draw_hue_gradient, 'hue_slider', 360, 30, 1, 0)
gradient_slider(draw_sat_gradient, 'sat_slider', 1, .1, .01, 2)
gradient_slider(draw_lum_gradient, 'lum_slider', 1, .1, .01, 2)

function is_color_component(value, max_value) {
	return isnum(value) && value >= 0 && value <= max_value
}

function get_color_component_value(id, value, want_reset) {
	if (want_reset)
		return value
	let v = ui.value(id)
	return v !== undefined ? v : value
}

function color_picker_update(id, s) {
	s.input_value = undefined

	let hue_s = ui.state_of(id+'.hue')
	let sat_s = ui.state_of(id+'.sat')
	let lum_s = ui.state_of(id+'.lum')
	let hue = hue_s?.input_value
	let sat = sat_s?.input_value
	let lum = lum_s?.input_value
	if (hue !== undefined || sat !== undefined || lum !== undefined) {
		let input_hue = hue !== undefined ? hue : hue_s?.valid_value
		let input_sat = sat !== undefined ? sat : sat_s?.valid_value
		let input_lum = lum !== undefined ? lum : lum_s?.valid_value
		if (is_color_component(input_hue, 360)
			&& is_color_component(input_sat, 1)
			&& is_color_component(input_lum, 1)
		) {
			s.input_value = hsl_to_rgb_hex(input_hue, input_sat, input_lum)
		} else {
			s.input_value = s.value
		}
	}

	let text = ui.input_value(id+'.hex')
	if (text !== undefined)
		s.input_value = text
}

ui.color_picker = function(id, hex) {
	let hue_id = id+'.hue'
	let sat_id = id+'.sat'
	let lum_id = id+'.lum'
	let hex_id = id+'.hex'
	let s = ui.state(id, color_picker_update)
	let prev_hex = s.value
	let has_input_value = s.input_value !== undefined
	let value = ui.set_value(s, hex)
	let has_caller_value_change = !has_input_value && value !== prev_hex

	let hue_s = ui.state_of(hue_id)
	let sat_s = ui.state_of(sat_id)
	let lum_s = ui.state_of(lum_id)
	let hex_input_value = ui.input_value(hex_id)
	let want_reset = !hue_s || has_caller_value_change
		|| hex_input_value !== undefined && COLOR_HEX_RE.test(hex_input_value)
	let hue = hue_s?.valid_value
	let sat = sat_s?.valid_value
	let lum = lum_s?.valid_value
	if (want_reset)
		[hue, sat, lum] = hex_to_hsl(
			COLOR_HEX_RE.test(value) ? value : '#808080')
	let hue_value = get_color_component_value(hue_id, hue, want_reset)
	let sat_value = get_color_component_value(sat_id, sat, want_reset)
	let lum_value = get_color_component_value(lum_id, lum, want_reset)
	let gradient_hue = is_color_component(hue_value, 360)
		? hue_value : hue
	let gradient_sat = is_color_component(sat_value, 1)
		? sat_value : sat

	let box_text = ui.value(hex_id)
	let has_box_input = hex_input_value !== undefined
	let text = box_text
	if ((!has_box_input && value !== prev_hex) || text === undefined)
		text = value

	ui.v_aligned(1, ui.sp2())
		ui.h(0, ui.sp1(), 's', 'c')
			ui.label(hue_id, 'Hue', 0)
			ui.hue_slider(hue_id, hue_value, null, null, 1)
		ui.end_h()
		ui.h(0, ui.sp1(), 's', 'c')
			ui.label(sat_id, 'Saturation', 0)
			ui.sat_slider(sat_id, sat_value, gradient_hue, null, 1)
		ui.end_h()
		ui.h(0, ui.sp1(), 's', 'c')
			ui.label(lum_id, 'Luminosity', 0)
			ui.lum_slider(lum_id, lum_value,
				gradient_hue, gradient_sat, 1)
		ui.end_h()
		ui.h(0, ui.sp1(), 's', 'c')
			ui.label(hex_id, 'HEX', 0)
			ui.input(hex_id, text, 1)
		ui.end_h()
	ui.end_v_aligned()

	return value
}

function color_input_update(id, s) {
	s.input_value = undefined
	ui.dropdown_update(id, s)

	let picker_id = id+'.picker'
	if (ui.dropdown_opened(id)) {
		s.revert_value = s.value
	} else if (ui.dropdown_closed(id)) {
		s.input_value = ui.dropdown_picked(id)
			? ui.value(picker_id) : s.revert_value
	} else {
		let picker_value = ui.input_value(picker_id)
		if (picker_value !== undefined)
			s.input_value = picker_value
	}

	if (ui.focused(id) && ui.keydown('delete'))
		s.input_value = null
}
ui.color_input = function(id, value, fr, min_w) {
	let picker_id = id+'.picker'
	let s = ui.state(id, color_input_update)

	ui.stack('', fr, 's', 's', min_w ?? ui.em_input(), ui.em(1.5))

	ui.focusable(id)
	let open = ui.dropdown(id)
	if (!open && ui.focus_inside(picker_id))
		ui.focus(id)

	value = ui.set_value(s, value)

		ui.bb('input', ui.focused(id) ? 'focused' : null,
			1, 'intense', ui.focused(id) ? 'hover' : null)
		ui.m(ui.sp(), ui.sp())
		ui.stack('', 1, 's', 'c', null, ui.em(1))
			if (COLOR_HEX_RE.test(value))
				ui.bb(':'+value)
		ui.end_stack()

	ui.dropdown_picker(id, 'b')

		if (open) {
			ui.p(ui.sp2())
			ui.v(0, ui.sp1())
				ui.color_picker(picker_id, value)
				ui.h(0, ui.sp05(), 'r')
					ui.default_button(id+'.pick')
					ui.primary_button(id+'.pick', S('pick', 'Pick'), 0)
					ui.button(id+'.cancel', S('cancel', 'Cancel'), 0)
				ui.end_h()
			ui.end_v()
			ui.resizer(id+'.resizer', ui.em(22), null, 'x')
		}

	ui.end_dropdown(id)

	ui.end_stack()

	return value
}

//// POLYLINE ----------------------------------------------------------------

function set_points(cx, x0, y0, a, pi1, pi2, closed, offset) {
	cx.beginPath()
	let x = a[pi1+0] + offset
	let y = a[pi1+1] + offset
	cx.moveTo(x0 + x, y0 + y)
	for (let i = pi1 + 2; i < pi2; i += 2) {
		let x = a[i+0] + offset
		let y = a[i+1] + offset
		cx.lineTo(x0 + x, y0 + y)
	}
	if (closed)
		cx.closePath()
}

let POLYLINE_STROKE_COLOR       = 5
let POLYLINE_STROKE_COLOR_STATE = 6
let POLYLINE_LINE_WIDTH         = 7
let POLYLINE_POINTS             = 8

ui.widget('polyline', {
	create: function(cmd,
			id, points, closed,
			fill_color, fill_color_state,
			stroke_color, stroke_color_state,
			line_width,
	) {
		if (isstr(points))
			points = points.split(/\s+/).map(num)
		assert(points.length % 2 == 0, 'invalid point array')
		if (!points.length)
			return
		let i = ui_cmd_begin(cmd)
		a[n++] = id
		a[n++] = ui.ct_i() - i
		a[n++] = (closed ?? 0) ? 1 : 0
		a[n++] = fill_color   ?? 0
		a[n++] = parse_state(fill_color_state  )
		a[n++] = stroke_color ?? 0
		a[n++] = parse_state(stroke_color_state)
		a[n++] = line_width ?? 1
		for (let j = 0; j < points.length; j++)
			a[n++] = points[j]
		ui_cmd_end(i)
		return i
	},
	measure: function(a, i, axis) {
		if (!axis) {
			let stroke_color = a[i+POLYLINE_STROKE_COLOR]
			let line_width   = a[i+POLYLINE_LINE_WIDTH]
			let pi1 = i+POLYLINE_POINTS
			let pi2 = cmd_arg_end_i(a, i)
			let x1 =  1/0
			let y1 =  1/0
			let x2 = -1/0
			let y2 = -1/0
			for (let i = pi1; i < pi2; i += 2) {
				let x = a[i+0]
				let y = a[i+1]
				x1 = min(x1, x)
				y1 = min(y1, y)
				x2 = max(x2, x)
				y2 = max(y2, y)
			}
			if (stroke_color) {
				let hlw = line_width / 2
				x1 -= hlw
				y1 -= hlw
				x2 += hlw
				y2 += hlw
			}
			add_ct_min_wh(a, 0, (x2-x1) * dpr)
			add_ct_min_wh(a, 1, (y2-y1) * dpr)
		}
	},
	draw: function(a, i) {
		let pi1 = i+POLYLINE_POINTS
		let pi2 = cmd_arg_end_i(a, i)
		let ct_i = i+a[i+1]
		let x0 = a[ct_i+0]
		let y0 = a[ct_i+1]
		let closed             = a[i+2]
		let fill_color         = a[i+3]
		let fill_color_state   = a[i+4]
		let stroke_color       = a[i+POLYLINE_STROKE_COLOR]
		let stroke_color_state = a[i+POLYLINE_STROKE_COLOR_STATE]
		let line_width         = a[i+POLYLINE_LINE_WIDTH]
		cx.save()
		cx.translate(x0, y0)
		cx.scale(dpr, dpr)
		if (fill_color) {
			set_points(cx, 0, 0, a, pi1, pi2, closed, 0)
			cx.fillStyle = color_css(fill_color, fill_color_state)
			cx.fill()
		}
		if (stroke_color) {
			set_points(cx, 0, 0, a, pi1, pi2, closed, line_width / 2)
			cx.strokeStyle = color_css(stroke_color, stroke_color_state)
			cx.lineWidth = line_width
			cx.stroke()
			cx.lineWidth = 1
		}
		cx.restore()
	},
	hit: function(a, i) {
		let id = a[i+0]
		if (!id)
			return
		let ct_i = i+a[i+1]
		let x0 = a[ct_i+0]
		let y0 = a[ct_i+1]
		let closed = a[i+2]
		let pi1 = i+POLYLINE_POINTS
		let pi2 = cmd_arg_end_i(a, i)
		set_points(cx, x0, y0, a, pi1, pi2, closed)
		if (cx.isPointInPath(ui.mx, ui.my)) {
			set_hit(id)
			return true
		}
	},
})

//// BG_DOTS -----------------------------------------------------------------

// background animation with randomly connected dots.

{
let dot_density = 1 // per 100px^2 surface
let max_distance = 320 // between two dots

function point_distance(p1, p2) {
	let dx = abs(p1.x - p2.x)
	let dy = abs(p1.y - p2.y)
	return Math.sqrt(dx**2 + dy**2)
}

function random(min, max) {
	return Math.random() * (max - min) + min
}

function coinflip(a, b) {
	return Math.random() > 0.5 ? a : b
}

ui.widget('bg_dots', {

	create: function(cmd, id, speed) {
		assert(id, 'id required')
		let i = ui_cmd_begin(cmd)
		a[n++] = id
		a[n++] = ui.ct_i() - i
		a[n++] = round((speed ?? 1) * 1024)
		ui_cmd_end(i)
		return i
	},

	draw: function(a, i) {

		let id    = a[i+0]
		let ct_i  = i+a[i+1]
		let speed = a[i+2] / 1024

		let x = a[ct_i+0]
		let y = a[ct_i+1]
		let w = a[ct_i+2]
		let h = a[ct_i+3]

		let dot_num = round(w * h / 10000 * dot_density)

		if (!dot_num)
			return

		let s = ui.render_state(id)
		let dots = s.dots
		if (!dots) {
			dots = []
			s.dots = dots

			dots.mouse_dot = {}
			dots.push(dots.mouse_dot)
		}

		for (let i = dots.length; i < dot_num+1; i++) {
			let t = {}
			let d = max_distance
			t.x  = random(-d, w+d)
			t.y  = random(-d, h+d)
			t.vx = random(0.1, 1) * coinflip(1, -1)
			t.vy = random(0.1, 1) * coinflip(1, -1)
			dots.push(t)
		}
		dots.length = dot_num+1

		dots.mouse_dot.x = (ui.mx ?? -1000) - x
		dots.mouse_dot.y = (ui.my ?? -1000) - y

		cx.save()

		cx.translate(x, y)

		cx.beginPath()
		cx.rect(0, 0, w, h)
		cx.clip()

		cx.fillStyle = hsl_adjust(color_hsl('label'), 1, 1, 0.5, 1)
		for (let t of dots) {
			if (t != dots.mouse_dot) {
				cx.beginPath()
				cx.arc(t.x, t.y, 2, 0, Math.PI*2, true)
				cx.closePath()
				cx.fill()
			}
		}

		let c = color_hsl('label')
		cx.lineWidth = 0.8
		for (let i = 0; i < dots.length; i++) {
			for (let j = i+1; j < dots.length; j++) {
				let t1 = dots[i]
				let t2 = dots[j]
				let dp = point_distance(t1, t2) / max_distance
				if (dp < 1) {
					let alpha = (1 - dp) / 2
					cx.strokeStyle = hsl_adjust(c, 1, 1, 0.5, alpha)
					cx.beginPath()
					cx.moveTo(t1.x, t1.y)
					cx.lineTo(t2.x, t2.y)
					cx.stroke()
				}
			}
		}
		cx.lineWidth = 1

		if (speed)
			for (let t of dots) {
				if (t != dots.mouse_dot) {
					t.x += t.vx * speed
					t.y += t.vy * speed
					let d = max_distance
					if (!(t.x > -d && t.x < w+d && t.y > -d && t.y < h+d)) { // dead
						if (coinflip(0, 1)) {
							t.x = random  (-d, w+d)
							t.y = coinflip(-d, h+d)
						} else {
							t.x = coinflip(-d, w+d)
							t.y = random  (-d, h+d)
						}
						t.vx = random(0.1, 1) * (t.x > w / 2 ? -1 : 1)
						t.vy = random(0.1, 1) * (t.y > h / 2 ? -1 : 1)
					}
				}
			}

		cx.restore()

		ui.animate()
	},

})
}

//// FRAME GRAPHS ------------------------------------------------------------

ui.frame_graphs = {}
function frame_graph(name, color, unit, decimals, min, max, duration) {
	let n = 60 * (duration ?? 2)
	let va = []
	let mf = 10**decimals
	let g = {i: 0, n: n, color: color, unit: unit, min: min, max: max, decimals: decimals, mf: mf,
		values: va}
	for (let i = 0; i < n; i++)
		va[i] = min
	g.push = function(v) {
		va[g.i] = round(v * mf)
		g.i = (g.i + 1) % n
	}
	ui.frame_graphs[name] = g
}
function frame_graph_push(name, v) {
	ui.frame_graphs[name].push(v)
}
ui.frame_graph_push = frame_graph_push

frame_graph('frame_delta_time' , '#666', 'ms'  , 1, 0,  2/60 * 1000)
frame_graph('frame_time'       , '#fff', 'ms'  , 1, 0,  2/60 * 1000)
frame_graph('frame_make_time'  , '#0f0', 'ms'  , 1, 0,  2/60 * 1000)
frame_graph('frame_layout_time', '#00f', 'ms'  , 1, 0,  2/60 * 1000)
frame_graph('frame_draw_time'  , '#f00', 'ms'  , 1, 0,  2/60 * 1000)
frame_graph('frame_hit_time'   , '#f0f', 'ms'  , 1, 0,  2/60 * 1000)
frame_graph('frame_bandwidth'  , '', 'Mbps', 1, 0,     5) // 3Mbps=3G; 5Mbps=720p@60fps
frame_graph('frame_compression', '', '%'   , 0, 0,   100)
frame_graph('frame_pack_time'  , '', 'ms'  , 1, 0,    10)
frame_graph('frame_unpack_time', '', 'ms'  , 1, 0,    10)

let overlapped_frame_graphs = []
for (let name in ui.frame_graphs) {
	let g = ui.frame_graphs[name]
	if (g.color)
		overlapped_frame_graphs.push(g)
}

function draw_graph(x0, y0, w, h, g, with_agg) {

	cx.save()

	let min =  1/0
	let max = -1/0
	let sum = 0
	let avg = 0

	cx.beginPath()
	cx.rect(x0, y0, w, h)
	cx.clip()

	cx.beginPath()
	let step = Math.max(1, round((g.n / w) * 2))
	let i0 = step - g.i % step
	let n = 0
	for (let i = 0; i < g.n; i += step) {
		let v = g.values[(g.i+i0+i) % g.n] / g.mf
		min = Math.min(min, v)
		max = Math.max(max, v)
		sum += v
		n++
		let x = x0 + lerp(i0+i, 0, g.n, 0, w + step)
		let y = y0 + lerp(v, g.min, g.max, h, 0)
		if (!i)
			cx.moveTo(x, y)
		else
			cx.lineTo(x, y)
	}
	avg = sum / n
	cx.strokeStyle = g.color ?? color_css('link')
	cx.stroke()

	if (with_agg) {

		cx.fillStyle = color_css('label')
		let y1 = y0 + ui.em()
		let x1 = x0 + ui.sp()
		cx.font = 'normal ' + (font_size_normal * .75) + 'px ' + default_font
		cx.textAlign = 'left'
		let y = y1
		let x = x1
		cx.fillText('min', x, y); y += ui.em()
		cx.fillText('max', x, y); y += ui.em()
		cx.fillText('avg', x, y)
		y = y1
		x = x1 + ui.em(6)
		let d = g.decimals
		cx.textAlign = 'right'
		cx.fillText(dec(min, d)+g.unit, x, y); y += ui.em()
		cx.fillText(dec(max, d)+g.unit, x, y); y += ui.em()
		cx.fillText(dec(avg, d)+g.unit, x, y)

	}

	cx.restore()

}

ui.box_widget('frame_graph_overlapped', {
	create: function(cmd, fr, align, valign, min_w, min_h) {
		let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
		a[n++] = overlapped_frame_graphs
		ui_cmd_box_end(i)
		//ui.animate()
	},
	draw: function(a, i) {
		let x0 = a[i+0]
		let y0 = a[i+1]
		let w  = a[i+2]
		let h  = a[i+3]
		let graphs = a[i+BOX_ARGS+0]
		for (let g of graphs)
			draw_graph(x0, y0, w, h, g, false)
	},
})

ui.box_widget('frame_graph', {
	create: function(cmd, name, fr, align, valign, min_w, min_h) {
		let i = ui_cmd_box_begin(cmd, fr, align, valign, min_w, min_h)
		a[n++] = name
		a[n++] = ui.frame_graphs[name]
		ui_cmd_box_end(i)
		//ui.animate()
	},
	draw: function(a, i) {
		let x0 = a[i+0]
		let y0 = a[i+1]
		let w  = a[i+2]
		let h  = a[i+3]
		let g    = a[i+BOX_ARGS+1]
		if (!g) return
		draw_graph(x0, y0, w, h, g, true)
	},
})

//// LIVE_MOVE_MIXIN ---------------------------------------------------------

// live-move list element pattern.

// implements:
//   move_element_start(move_i, move_n, i1, i2[, x1, x2])
//   move_element_update(elem_x)
//   move_element_update_dx(elem_dx)
//   move_element_stop() -> over_i
// uses:
//   movable_element_size(elem_i) -> w
//   set_movable_element_pos(i, x, moving)
//
ui.live_move_mixin = function(e) {

	e = e || {}

	let move_i1, move_i2, i1, i2, i1x, i2x, offsetx
	let move_x0, move_x, over_i, over_p, over_x
	let sizes

	e.move_element_start = function(move_i, move_n, _i1, _i2, _i1x, _i2x, _offsetx) {
		move_n = move_n ?? 1
		move_i1 = move_i
		move_i2 = move_i + move_n
		move_x = null
		over_i = null
		over_x = null
		i1  = _i1
		i2  = _i2
		i1x = _i1x
		i2x = _i2x
		offsetx = _offsetx || 0
		sizes = []
		for (let i = i1; i < i2; i++)
			sizes[i] = e.movable_element_size(i)
		if (i1x == null) {
			i1x = 0
			for (let i = 0; i < i1; i++)
				i1x += e.movable_element_size(i)
			i2x = i1x
			for (let i = i1; i < i2; i++) {
				if (i < move_i1 || i >= move_i2)
					i2x += sizes[i]
			}
		}
		move_x0 = 0
		for (let i = i1; i < move_i; i++)
			move_x0 += sizes[i]
		e.x0 = move_x0
		e.move_element_update_dx(0)
	}

	e.move_element_stop = function() {
		set_moving_element_pos(over_x, false)
		return over_i
	}

	function hit_test(elem_x) {
		let x = i1x
		let x0 = i1x
		let last_over_i = over_i
		let new_over_i, new_over_p
		for (let i = i1; i < i2; i++) {
			if (i < move_i1 || i >= move_i2) { // skip moving elements
				let w = sizes[i]
				let x1 = x + w / 2
				if (elem_x < x1) {
					new_over_i = i
					new_over_p = lerp(elem_x, x0, x1, 0, 1)
					over_i = new_over_i
					over_p = new_over_p
					return new_over_i != last_over_i
				}
				x += w
				x0 = x1
			}
		}
		new_over_i = i2
		let x1 = i2x
		new_over_p = lerp(elem_x, x0, x1, 0, 1)
		over_i = new_over_i
		over_p = new_over_p
		return new_over_i != last_over_i
	}

 	// `[i1..i2)` index generator with `[move_i1..move_i2)` elements moved.
	function each_index(f) {
		if (over_i < move_i1) { // moving upwards
			for (let i = i1     ; i < over_i ; i++) f(i)
			for (let i = move_i1; i < move_i2; i++) f(i, true)
			for (let i = over_i ; i < move_i1; i++) f(i)
			for (let i = move_i2; i < i2     ; i++) f(i)
		} else {
			for (let i = i1     ; i < move_i1; i++) f(i)
			for (let i = move_i2; i < over_i ; i++) f(i)
			for (let i = move_i1; i < move_i2; i++) f(i, true)
			for (let i = over_i ; i <  i2    ; i++) f(i)
		}
	}

	function set_moving_element_pos(x, moving, vi) {
		for (let i = move_i1; i < move_i2; i++) {
			e.set_movable_element_pos(i, x != null ? offsetx + x : null, moving, vi)
			x += sizes[i]
			if (vi != null)
				vi++
		}
	}

	e.move_element_update = function(elem_x) {
		elem_x = elem_x != null ? clamp(elem_x, i1x, i2x) : null
		if (elem_x == move_x)
			return
		move_x = elem_x
		e.move_x = move_x
		if (hit_test(move_x ?? 1/0)) { // first time always hits because over_i is null
			e.over_i = over_i
			e.over_p = over_p
			let x = i1x
			over_x = null
			let vi = 0 // visual index
			let mx = move_x
			each_index(function(i, moving) {
				if (moving) {
					over_x = over_x ?? x
					e.set_movable_element_pos(i, mx != null ? offsetx + mx : null, true, vi)
					if (mx != null)
						mx += sizes[i]
				} else {
					e.set_movable_element_pos(i, offsetx + x, false, vi)
				}
				x += sizes[i]
				vi++
			})
		} else {
			set_moving_element_pos(move_x, true)
		}
	}

	e.move_element_update_dx = function(elem_dx) {
		e.move_element_update(move_x0 + elem_dx)
	}

	return e
}

ui.debug_pane = function() {

	ui.v(0, 0, 's', 's', 200)
		ui.border('l', 'intense')

		ui.stack('', 0)
			ui.bb('bg2')
			ui.p(ui.sp())
			ui.text('', 'PROFILE', 0, 'l')
		ui.end_stack()
		ui.frame_graph_overlapped(.5)

		ui.stack('', 0)
			ui.bb('bg2')
			ui.p(ui.sp())
			ui.text('', 'ID STATES', 0, 'l')
		ui.end_stack()
		ui.scrollbox('demo_id_states_sb')
			ui.v(0, 0, 's', '[')
				for (let [id, s] of state_map) {
					ui.p(ui.sp(), ui.sp05())
					ui.color('link')
					ui.text('', id, 0, 'l')
					for (let [k, v] of entries(s)) {
						if (v === undefined)
							continue
						if (k == 'build_no')
							continue
						ui.ml(ui.sp2())
						ui.h(0, ui.sp())
							let s = isobject(v) || isfunc(v) ? '<'+(typeof v)+'>' : str(v)
							ui.text('', k, 1, 'l', 'c', 1/0, 0)
							if (isobject(v) || isfunc(v))
								ui.color('label')
							ui.text('', s, 1, 'l', 'c', 1/0, 0)
						ui.end_h()
					}
				}
			ui.end_v()
		ui.end_scrollbox()

		ui.border(1, 'light')
		ui.stack('', 0)
			ui.bb('bg2')
			ui.p(ui.sp())
			ui.text('', 'HIT STATES', 0, 'l')
		ui.end_stack()
		ui.scrollbox('demo_hit_states_sb', .5)
			ui.v(0, 0, 's', '[')
				for (let [id, s] of hit_state_map) {
					ui.p(ui.sp(), ui.sp05())
					ui.color('link')
					ui.text('', isstr(id) ? id : typeof id, 0, 'l')
					for (let [k, v] of entries(s)) {
						ui.ml(ui.sp2())
						ui.h(0, ui.sp())
							let s = isobject(v) || isfunc(v) ? '<'+(typeof v)+'>' : str(v)
							ui.text('', k, 1, 'l', 'c', 1/0, 0)
							if (isobject(v) || isfunc(v))
								ui.color('label')
							ui.text('', s, 1, 'l', 'c', 1/0, 0)
						ui.end_h()
					}
				}
			ui.end_v()
		ui.end_scrollbox()

		ui.stack('', 0)
			ui.bb('bg2')
			ui.color(ui.captured_id ? 'text' : 'label')
			ui.p(ui.sp())
			ui.text('', ui.captured_id ? 'CAP '+ui.captured_id : 'CAPTURED', 0, 'l', 'c', 1/0, 0)
		ui.end_stack()
		ui.scrollbox('demo_captured_state_sb', .5)
			ui.v(0, 0, 's', '[')
				if (ui.captured_id)
					for (let [k, v] of entries(captured(ui.captured_id))) {
						ui.ml(ui.sp2())
						ui.h(1, ui.sp())
							let s = isobject(v) || isfunc(v) ? '<'+(typeof v)+'>' : str(v)
							ui.text('', k, 1, 'l', 'c', 1/0, 0)
							if (isobject(v) || isfunc(v))
								ui.color('label')
							ui.text('', s, 1, 'l', 'c', 1/0, 0)
						ui.end_h()
					}
			ui.end_v()
		ui.end_scrollbox()

		ui.stack('', 0)
			ui.bb('bg2')
			ui.color(ui.captured_id ? 'text' : 'label')
			ui.p(ui.sp())
			ui.text('', ui.focused_id ? 'FOCUSED '+ui.focused_id : 'FOCUSED', 0, 'l', 'c', 1/0, 0)
		ui.end_stack()

	ui.end_v()
}

//// TABS --------------------------------------------------------------------

// given a list of elements with an ID key, an optional "order list" and an
// optional "hidden" list, return the list of visible elements in specified
// order with hidden ones skipped and with new ones that are not in the order
// list or hidden added at the end.
function visible_element_list(all, ID, INDEX, order, hidden) {
	let hidden_ids = words(hidden) ?? empty_array
	let visible_ids = words(order) ?? all.map(e => e[ID])
	let id_map = {}
	for (let e of all) {
		if (hidden_ids.includes(e[ID])) // hidden
			continue
		if (id_map[e[ID]]) // duplicate
			continue
		id_map[e[ID]] = e
	}
	let visible = []
	for (let id of visible_ids) {
		let e = id_map[id]
		if (!e) // hidden or invalid, skip
			continue
		// mark id as processed to skip duplicates and be left with new elements.
		id_map[id] = null
		visible.push(e)
	}
	// add new elements not present in the order list at the end, in natural order.
	// TODO: support "before" and "after" hits for more control on placement.
	for (let e of all)
		if (id_map[e[ID]])
			visible.push(e)
	let by_id = {}
	let i = 0
	for (let e of visible) {
		e[INDEX] = i++
		by_id[e[ID]] = e
	}
	visible['by_'+ID] = by_id
	return visible
}

// TODO: tabs_side  auto_focus

ui.icon_def('plus', 'tabler', '\ueb0b')

ui.tabs = function(id, all_tabs, selected_tab, tabs_order, hidden_tabs) {

	let s = ui.state(id)
	selected_tab = s.value ?? selected_tab
	tabs_order   = s.tabs_order   ?? tabs_order
	hidden_tabs  = s.hidden_tabs  ?? hidden_tabs

	let tabs = s.tabs
	if (!tabs) {
		tabs = visible_element_list(all_tabs, 'id', 'index', tabs_order, hidden_tabs)
		s.tabs = tabs
	}

	selected_tab = tabs.by_id[selected_tab]

	ui.pr(ui.em(2))
	ui.sb(id, 1, 'auto', 'contain')
	ui.h(0, 0, 'l', 't')

	let cs = null
	let drag_tab_id, drag_tab
	for (drag_tab of tabs) {
		drag_tab_id = id+'.tab'+drag_tab.index
		cs = ui.drag_or_hit(drag_tab_id)
		if (cs) break
	}

	let mover = cs && cs.mover
	if (cs) {
		if (!mover && cs.drag) {
			selected_tab = drag_tab
			ui.state(id).value = selected_tab.id
		} else if (!mover && cs.dragging && !cs.drop && abs(cs.dx) > 10) {
			mover = ui.live_move_mixin()
			cs.mover = mover
			mover.movable_element_size = function(vi) {
				let tab = tabs[vi]
				let tab_id = id+'.tab'+tab.index
				let w = ui.state_of(tab_id, 'w')
				return w
			}
			mover.set_movable_element_pos = function(i, x, moving, vi) {
				// not using mover's positions, just mover.over_i
			}
			mover.move_element_start(drag_tab.index, 1, 0, tabs.length)
		} else if (mover && cs.dragging && !cs.drop) {
			mover.move_element_update_dx(cs.dx)
		} else if (mover && cs.drop) {
			array_move(tabs, drag_tab.index, 1, mover.over_i, true)
			tabs_order = tabs.map(tab => tab.id).join(' ')
			s.tabs_order = tabs_order
			tabs = visible_element_list(all_tabs, 'id', 'index', tabs_order, hidden_tabs)
			s.tabs = tabs
			mover = null
		}
	}

	for (let j = 0, n = tabs.length; j < n; j++) {
		let tab_i = j
		let tab = tabs[tab_i]
		let tab_id = id+'.tab'+tab_i
		let over_gap = mover && tab_i == mover.over_i
		if (over_gap) {
			let tab_id = drag_tab_id
			let w = ui.state_of(tab_id, 'w')
			ui.stack('', 0, null, null, w)
			ui.end_stack()
		}
		let moving = mover && tab == drag_tab
		if (moving) {
			ui.popup('', 'overlay', null, 'it', '[')
			ui.ml(max(0, mover.x0 + cs.dx))
		}
		ui.stack(tab_id)
		ui.measure(tab_id)
			let sel = tab == selected_tab
			let hover = cs && !cs.dragging && drag_tab == tab || moving
			ui.bb('bg1', hover ? 'hover' : null)
			ui.p(ui.sp2())
			ui.text('', tab.label)
			if (sel) {
				ui.stack('', 1, 's', 'b', null, 2)
					ui.bb('marker')
				ui.end_stack()
			}
		ui.end_stack()
		if (moving) {
			ui.end_popup()
		}
	}
	if (!mover) {
		if (ui.bare_icon_button(id+'.plus', 'plus', null, false)) {
			all_tabs.push({id: 'newtab'+all_tabs.length, label: 'New Tab '+all_tabs.length})
			tabs = visible_element_list(all_tabs, 'id', 'index', tabs_order, hidden_tabs)
			s.tabs = tabs
			ui.rebuild('tabs_changed')
		}
	}
	ui.end_h()
	ui.end_sb()

	return selected_tab
}

//// TOOLBOX -----------------------------------------------------------------

let toolbox_stack = []

function toolbox_stack_check() {
	assert(!toolbox_stack.length, 'toolbox not closed')
}

ui.toolbox = function(id, title, align, valign, x0, y0, target_i) {

	ui.state(id)
	let  align_start =  parse_align( align || '[') == ALIGN_START
	let valign_start = parse_valign(valign || 't') == ALIGN_START
	let tid = assert(toolbox_stack.at(-1), 'begin_toolboxes missing')
	let ts = ui.state(tid)
	if (hovers(id) && ui.click) {
		ts.to_top = id
		ui.tab_into(id)
	}
	ui.state(id+'.title')
	let cs = ui.drag(id+'.title')
	let s = ui.state(id)
	// ox, oy: offset from the target edges that align and valign anchor the
	// toolbox to, so that it keeps its distance from them when they move.
	// x0, y0 are distances from those edges, the offsets are screen-directed.
	// the popup keeps ox, oy on screen, the drag moves from where the grab
	// found them so that the grabbed point stays under the mouse.
	let ox = s.ox ?? ( align_start ? x0 : -x0)
	let oy = s.oy ?? (valign_start ? y0 : -y0)
	if (cs?.drag) { cs.ox0 = ox; cs.oy0 = oy }
	if (cs?.dragging) { ox = cs.ox0 + cs.dx; oy = cs.oy0 + cs.dy }
	let i = ui.popup(id, 'toolbox', target_i ?? 'screen',
		valign_start ? 'it' : 'ib', align, null, null, 'constrain solid', null,
		ox, oy
	)
		ts.popups.set(id, i)
		ui.focus_group(null, null, id)
		//ui.p(1)
		ui.bb('bg1', null, 1, 'intense')//, null, ui.sp075())
		ui.stack()
			toolbox_stack.push(id, tid)
			ui.v() // title / body split
				ui.h(0) // title bar
					ui.stack(id+'.title')
						ui.bb('bg3')// , null, 1, null, null, ui.sp075())
						ui.p(ui.sp2(), ui.sp())
						ui.text('', title, 0, 'l')
					ui.end_stack()
				ui.end_h()
}

ui.end_toolbox = function() {
	let id = toolbox_stack.at(-2)
	toolbox_stack.length -= 2
			ui.end_v()
			ui.resizer(id)
		ui.end_stack()
		ui.end_focus_group()
	ui.end_popup()
}

ui.begin_toolboxes = function(tid) {
	assert(tid, 'toolboxes id required')
	attr(ui.state(tid), 'popups', map).clear()
	toolbox_stack.push(tid)
}

ui.end_toolboxes = function() {
	let tid = assert(toolbox_stack.pop(), 'begin_toolboxes missing')
	let s = ui.state(tid)
	let popups = s.popups
	if (!popups.size) return
	let order = attr(s, 'order', array)
	// focus moved into a toolbox this frame: bring that toolbox to front.
	// checked here and not in toolbox() because a toolbox's contents are
	// built after toolbox() returns, and they can focus themselves.
	if (focusing_id != null)
		for (let id of popups.keys())
			if (ui.focus_inside(id))
				s.to_top = id
	let to_top_id = s.to_top
	if (to_top_id || !order.length) {
		let prev_top_id = order.at(-1)
		for (let id of order) // remove toolboxes that have been removed
			if (!popups.has(id))
				remove_value(order, id)
		for (let id of popups.keys()) // add toolboxes added this frame
			if (!order.includes(id))
				order.push(id)
		if (to_top_id) {
			let src_i = order.indexOf(to_top_id)
			let dst_i = order.length-1
			if (src_i != dst_i) {
				let o1 = order.join(' ')
				array_move(order, src_i, 1, dst_i)
			}
		}
		if (prev_top_id != order.at(-1) && ui.focus_inside(prev_top_id))
			ui.focus(null)
		s.to_top = null
	}
	let z = 1
	for (let id of order) {
		let popup_i = popups.get(id)
		set_z_index(a, popup_i, z++)
	}
}

//// RESIZER -----------------------------------------------------------------

{
// check if a point (x0, y0) is inside rect (x, y, w, h)
// offseted by d1 internally and d2 externally.
function hit(x0, y0, d1, d2, x, y, w, h) {
	x = x - d1
	y = y - d1
	w = w + d1 + d2
	h = h + d1 + d2
	return x0 >= x && x0 <= x + w && y0 >= y && y0 <= y + h
}

function hit_sides(x0, y0, d1, d2, x, y, w, h) {
	if (hit(x0, y0, d1, d2, x, y, 0, 0))
		return 'top_left'
	else if (hit(x0, y0, d1, d2, x + w, y, 0, 0))
		return 'top_right'
	else if (hit(x0, y0, d1, d2, x, y + h, 0, 0))
		return 'bottom_left'
	else if (hit(x0, y0, d1, d2, x + w, y + h, 0, 0))
		return 'bottom_right'
	else if (hit(x0, y0, d1, d2, x, y, w, 0))
		return 'top'
	else if (hit(x0, y0, d1, d2, x, y + h, w, 0))
		return 'bottom'
	else if (hit(x0, y0, d1, d2, x, y, 0, h))
		return 'left'
	else if (hit(x0, y0, d1, d2, x + w, y, 0, h))
		return 'right'
}

let cursors = {
	bottom       : 'ns-resize',
	right        : 'ew-resize',
	bottom_right : 'nwse-resize',
	top          : 'ns-resize',
	left         : 'ew-resize',
	top_left     : 'nwse-resize',
	top_right    : 'nesw-resize',
	bottom_left  : 'nesw-resize',
}

function resize_side(side, axis) {
	if (axis == 'x')
		return (side == 'right' || side == 'top_right'
			|| side == 'bottom_right') ? 'right' : null
	if (axis == 'y')
		return (side == 'bottom' || side == 'bottom_left'
			|| side == 'bottom_right') ? 'bottom' : null
	return (side == 'right' || side == 'bottom'
		|| side == 'bottom_right') ? side : null
}

ui.widget('resizer', {
	create: function(cmd, id, default_w, default_h, axis, max_w, max_h) {
		ui.state(id)
		let ct_i = ui.ct_i()
		let s = ui.state(id)
		let cs = ui.drag_or_hit(id)
		if (cs) {
			if (!cs.dragging)
				ui.set_cursor(cursors[cs.side])
			if (cs.drag) {
				let side = cs.side
				if (side == 'right' || side == 'bottom_right')
					cs.w0 = cs.measured_w
				if (side == 'bottom' || side == 'bottom_right')
					cs.h0 = cs.measured_h
			}
			if (cs.dragging) {
				let side = cs.side
				ui.set_cursor(cursors[side])
				if (side == 'right' || side == 'bottom_right')
					s.w = min(cs.w0 + cs.dx, max_w ?? 1/0)
				if (side == 'bottom' || side == 'bottom_right')
					s.h = min(cs.h0 + cs.dy, max_h ?? 1/0)
			}
		}
		a[ct_i+0] = s.w ?? default_w ?? a[ct_i+0]
		a[ct_i+1] = s.h ?? default_h ?? a[ct_i+1]
		let i = ui_cmd_begin(cmd)
		a[n++] = ui.ct_i() - i
		a[n++] = id
		a[n++] = axis ?? 'xy'
		ui_cmd_end(i)
		return i
	},
	hit: function(a, i) {

		let ct_i = i+a[i+0]
		let id   = a[i+1]
		let axis = a[i+2]
		let x = a[ct_i+0]
		let y = a[ct_i+1]
		let w = a[ct_i+2]
		let h = a[ct_i+3]

		let borders = 2

		let side = resize_side(hit_sides(ui.mx, ui.my, 5, 5, x, y, w, h), axis)
		if (side) {
			let hs = set_hit(id)
			hs.side = side
			hs.measured_x = x
			hs.measured_y = y
			hs.measured_w = w + borders
			hs.measured_h = h + borders
		}

		return !!side

	},
})

}

//// TEMPLATE ----------------------------------------------------------------

let targs  = {}
let tprops = {}

targs.text  = function(t) { return [t.id, t.s, t.align, t.valign, t.fr] }
targs.h     = function(t) { return [t.fr, t.gap, t.align, t.valign, t.min_w, t.min_h] }
targs.v     = targs.h
targs.stack = function(t) { return [t.id, t.fr, t.align, t.valign, t.min_w, t.min_h] }
targs.bb    = function(t) { return [t.bg_color, t.sides, t.border_color, t.border_radius] }

tprops.text = {
	id     : {type: 'id'  , },
	s      : {type: 'text', },
	align  : {type: 'enum', enum_values: 's c l r', default: 'l'},
	valign : {type: 'enum', enum_values: 's c t b', default: 'c'},
	fr     : {type: 'fr'  , },
}

tprops.h = {
	fr     : {type: 'fr'  , },
	gap    : {type: 'size', },
	align  : {type: 'enum', enum_values: 's c l r', default: 's'},
	valign : {type: 'enum', enum_values: 's c t b', default: 's'},
	min_w  : {type: 'size', default: 0},
	min_h  : {type: 'size', default: 0},
}
tprops.v = tprops.h

tprops.stack = {
	id     : {type: 'id'  , },
	fr     : {type: 'fr'  , },
	align  : {type: 'enum', enum_values: 's c l r', default: 's'},
	valign : {type: 'enum', enum_values: 's c t b', default: 's'},
	min_w  : {type: 'size', default: 0},
	min_h  : {type: 'size', default: 0},
}

tprops.bb = {
	bg_color      : {type: 'color', },
	sides         : {type: 'enum' , enum_values: 't r b l tb rl tr rb lt bl -l -b -r -t all', default: 'all'},
	border_color  : {type: 'color', },
	border_radius : {type: 'size' , default: 0},
}

let hit_template_id
let hit_template_i0
let hit_template_i1
let selected_template_id
let selected_template_root_t
let selected_template_node_t

function hit_frame_template_reset() {
	hit_template_id = null
	hit_template_i0 = null
	hit_template_i1 = null
}

function template_select_node(id, root_t, node_t, node_i) {
	selected_template_id = id
	selected_template_root_t = root_t
	selected_template_node_t = node_t
	ui.rebuild('select_node')
}

function template_find_node(a, i, t, t_i) {
	if (i == t_i)
		return t
	if (t.e) {
		let ch_t_i = cmd_next_i(a, t_i)
		for (let ch_t of t.e) {
			let found_t = template_find_node(a, i, ch_t, ch_t_i)
			if (found_t)
				return found_t
			ch_t_i = cmd_next_sibling_i(a, ch_t_i)
		}
	}
}
function hit_template(a, i) {
	let id = hit_template_id
	if (id && i >= hit_template_i0 && i < hit_template_i1) {
		let hs = hovers(id)
		if (!hs)
			return
		let root_t = hs.root
		let node_t = template_find_node(a, i, root_t, hit_template_i0)
		hs.node = node_t
		if (ui.click)
			template_select_node(id, root_t, node_t)
		return true
	}
}

function template_add(t) {
	let cmd = cmd_name_map[t.t]
	let targs_f = assert(targs[t.t], 'unknown type ', t.t)
	let args = targs_f(t)
	t.i = n + 2
	ui[t.t](...args)
	if (t.e)
		for (let ch_t of t.e)
			template_add(ch_t, 0)
	if (cmd & 1) // container
		ui.end()
}

function template_drag_point(id, ch_t, ct_i, ha, va) {
	ui.popup('', 'overlay', ct_i, ha, va)
		ui.drag_point(id+'.'+ha+va, 0, 0, 'red')
	ui.end_popup()
}

ui.template = function(id, t, ...stack_args) {
	ui.stack('', ...stack_args)
	let i0 = n+2 // index of first cmd's arg#1
	template_add(t)
	let i1 = n+2 // index of next cmd's arg#1
	ui.template_overlay(id, t, i0, i1)
	let ch_t = selected_template_node_t
	let ch_i = ch_t && ch_t.i
	let ct_i = ch_i
	if (t == selected_template_root_t) {
		template_drag_point(id, ch_t, ct_i, 'l', '[')
		template_drag_point(id, ch_t, ct_i, 'l', 'c')
		template_drag_point(id, ch_t, ct_i, 'l', ']')
		template_drag_point(id, ch_t, ct_i, 'r', '[')
		template_drag_point(id, ch_t, ct_i, 'r', 'c')
		template_drag_point(id, ch_t, ct_i, 'r', ']')
		template_editor(id, t, ch_t)
	}
	ui.end_stack()
}

ui.box_widget('template_overlay', {
	create: function(cmd, id, t, i0, i1) {
		let i = ui_cmd_box_begin(cmd, 1, 's', 's', 0, 0)
		a[n++] = id
		a[n++] = t
		a[n++] = i0
		a[n++] = i1
		ui_cmd_box_end(i)
		return i
	},
	hit: function(a, i) {
		let id = a[i+BOX_ARGS+0]
		let t  = a[i+BOX_ARGS+1]
		let i0 = a[i+BOX_ARGS+2]
		let i1 = a[i+BOX_ARGS+3]
		if (hit_box(a, i)) {
			hit_template_id = id
			hit_template_i0 = i0
			hit_template_i1 = i1
			set_hit(id).root = t
		}
	},
	draw: function(a, i) {
		let id = a[i+BOX_ARGS+0]
		let sel_id = selected_template_id
		if (sel_id && sel_id == id) {
			let t = selected_template_node_t
			let i = t.i
			if (a[i-1] == CMD_BB)
				i = i+a[i+BB_CT_I]
			let x = a[i+0]
			let y = a[i+1]
			let w = a[i+2]
			let h = a[i+3]
			cx.strokeStyle = 'magenta'
			cx.beginPath()
			cx.rect(
				x + .5,
				y + .5,
				w - .5,
				h - .5,
			)
			cx.stroke()
		}
	},
})

function draw_node(id, t_t, t, depth) {
	ui.p(depth * 20, ui.sp05(), 0)
	ui.stack(t)
		let hs = hit(t)
		if (hs && ui.click)
			template_select_node(id, t_t, t)
		let sel = t == selected_template_node_t
		if (sel) {
			ui.bb('item',
				ui.focused(id)
					? 'item-focused item-selected focused'
					: 'item-focused item-selected'
			)
		}
		ui.color('text', hs ? 'hover' : null)
		ui.text('', t.t, 1, 'l')
	ui.end_stack()
	if (t.e)
		for (let ct of t.e)
			draw_node(id, t_t, ct, depth+1)
}
function template_editor(id, t, ch_t) {

	ui.begin_toolboxes('template_editor_toolboxes')

	ui.toolbox(id+'.tree_toolbox', 'Tree', ']', 't', 100, 100)
		ui.scrollbox(id+'.tree_toolbox_sb', 1, null, null, null, null, 150, 200)
			ui.p(10)
			ui.v(1, 0, 's', 't')
				draw_node(id, t, t, 0)
			ui.end_v()
		ui.end_scrollbox()
	ui.end_toolbox()

	ui.toolbox(id+'.prop_toolbox', 'Props', ']', 't', 100, 400)
		ui.scrollbox(id+'.prop_toolbox_sb', 1, null, null, null, null, 150, 200)
			ui.v(1, 0, 's', 't')
			let defs = tprops[ch_t.t]
			for (let k in defs) {
				let def = defs[k]
				let v = ch_t[k]
				ui.h()
					ui.border('b', 'light')
					let vs = str((v != null ? v : def.default) ?? '')
					ui.mb(1)
					ui.p(8, 5)
					ui.text('', k , 1, 'l', 'c', 20)
					ui.mb(1)
					ui.p(8, 5)
					ui.stack()
						if (def.type == 'color') {
							ui.bb(v, null, 'l', 'light')
						} else {
							ui.border('l', 'light')
							ui.color(v != null ? 'text' : 'label')
							ui.text('', vs, 1, 'l', 'c', 20)
						}
					ui.end_stack()
				ui.end_h()
			}
			ui.end_v()
		ui.end_scrollbox()
	ui.end_toolbox()

	ui.end_toolboxes()
}

//// AUTOMATED TESTING API ---------------------------------------------------

// nothing in here is part of the widget API: it exists so that a test can
// drive the ui from code and read back what each frame did.

ui._state_map = state_map

// what the last frame did: _rebuild_for holds the labels of every rebuild
// asked for in it and _frame_drawn whether it drew, which redraw_all() sets.
// a frame draws only when it exits the rebuild loop with nothing more asked
// for, so _frame_drawn false means it gave up with another pass pending.
// _build_no counts build passes, so its delta across a frame is how many
// passes that frame took.
ui._rebuild_for = rebuild_for
ui._build_no = () => build_no

// run one frame now instead of on the next animation frame.
ui._redraw = function() {
	if (raf_id) {
		cancelAnimationFrame(raf_id)
		raf_id = null
	}
	redraw_all()
}

// put the pointer over a widget without knowing where it is on screen. the
// widget must have been laid out in the last frame. the hit phase of the
// next frame then resolves the same chain of ids that it would for a real
// pointer at that spot.
ui._point_at = function(id) {
	for (let k = 0; k < recs.length; k++) {
		let ra = recs[k]
		let i = 2
		while (i < ra.length) {
			let si = id_slot[ra[i-1]]
			if (si != null && ra[i+si] === id) {
				let p = ui.local_pointer
				p.mx = ra[i+0] + ra[i+2] / 2
				p.my = ra[i+1] + ra[i+3] / 2
				p.activate()
				return true
			}
			i = cmd_next_i(ra, i)
		}
	}
	return false
}

}()) // module function
