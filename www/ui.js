/*

	Canvas IMGUI library with flexbox, widgets and UI designer.
	Written by Cosmin Apreutesei. Public Domain.

LOADING

	<script src=glue.js [global] [extend]>
	<script src=ui.js [global]>

	global flag:   dump the `ui` namespace into `window`.

GLOBLAS

	scrollbar_thickness         = 6
	scrollbar_thickness_active  = 12
	font_size_normal            = 12

THEME DEFINITIONS

	default_theme   = 'dark'
	default_font    = 'Arial'

	* = fg | border | bg
   *_style         (theme, name, state, h, s, L, a, is_dark)      define a color
	shadow_style    (theme, name, x, y, blur, spread, inset, h, s, L, a)  define a shadow

BUILT-IN STYLES

	fg              : text label link button-danger
	bg              : bg bg0 bg1 bg2 bg3 item toggle row
	border          : light intense
	shadow          : button menu modal picker thumb tooltip

BUILT-IN STYLE STATES

	general         : normal hover active focused
	list item       : item-selected item-focused item-error
	grid cell       : new modified

THEME API

	* = fg | border | bg
	*_color         (name, [state], [theme]) -> css_color                 get theme color for fillStyle/strokeStyle
	*_color_hsl     (name, [state], [theme]) -> [css_color, h, s, L, a]   get theme color for hsl_adjust()
	*_color_rgb     (name, [state], [theme]) -> 0xRRGGBB                  get theme color for WebGL, ignoring alpha
	*_color_rgba    (name, [state], [theme]) -> 0xRRGGBBAA                get theme color for WebGL, with alpha
	bg_is_dark      (bg_color) -> t|f                                     based on this, text is white or black
	dark            () -> t|f
	get_theme       () -> theme
	hsl             (h, s, L, a) -> css_color              make a CSS color from HSL components
	hsl_adjust      (c, h, s, L, a) -> css_color           make a CSS color from a color_hsl() return value, with h, s, L adjusted
	alpha_adjust    (c, a) -> css_color                    make a CSS color from a color_hsl() return value, with alpha adjusted

	set_shadow      (name)  use in draw callback to set a shadow

RENDERING

	cx              = access to canvas context for drawing
	screen          = access to canvas container div
	animate         ()  request another animation frame
	relayout        ()  request another layout pass in this frame
	resize          ()  resize canvas and request another animation frame

MOUSE STATE

	pointers        [p1, ...]
	add_pointer     () -> pointer
	pointer         -> p    active pointer

	mx              active pointer x-coord, transformed
	my              active pointer y-coord, transformed
	mx_notrans      active pointer x-coord
	my_notrans      active pointer y-coord
	pressed         active pointer pressed
	click           active pointer clicked
	clickup         active pointer de-clicked
	dblclick        active pointer double-clicked
	wheel_dy        active pointer wheel delta
	trackpad        active pointer is a trackpad

	local_pointer   = default pointer that tracks the local mouse and keyboard
	mx0 my0         = mouse position when started dragging
	update_mouse    ()   update mouse coords to current transform
	hit_rect        (x, y, w, h) -> t|f
	hit_bb          (x1, y1, x2, y2) -> t|f  ; bb means bounding box
	hit_box         (a, i) -> t|f

	captured_id     = id of widget that captured the mouse
	capture         (id) -> captured_state_map         capture the mouse
	captured        (id) -> captured_state_map | null  get captured state if mouse is captured

	hit             (id[, k) -> hit_state_map | v | null    get hit state map if mouse hovers widget and not captured
	hit_enter       (id) -> t|f                  mouse started hovering widget
	hit_leave       (id) -> t|f                  mouse stopped hovering widget
	hovers          (id) -> hit_state_map | null   get hit state map if mouse hovers widget incl. if mouse captured
	hover           (id) -> hit_state_map       declare that mouse hovers widget
	nohit           ()      exclude last command from hit-testing

	drag            (id, move, dx0, dy0) -> [null|hover|drag|dragging|drop, dx, dy]

	set_cursor      (cursor)   set cursor for this frame

KEYBOARD STATE

	keydown         (key) -> t|f     check if a key was just pressed
	keyup           (key) -> t|f     check if a key was just depressed
	keypressed      (key) -> t|f     check if the active pointer's user holds a key
	key_chars       () -> s          printable characters typed this frame
	key_events      -> [['down'|'up', full_key, key, char, ctrl, alt, shift], ...]
	capture_keys    ()    remove current keydown() and keyup() events
	capture_keydown (key)   stop the browser from acting on a keydown
	capture_keyup   (key)   stop the browser from acting on a keyup

LAYERS

	built-in layers : base toolbox tooltip open overlay modal global_tooltip drag
	layer           (name, [index], ['root modal'])  define a new layer

SCOPES

	scope           ()
	end_scope       ()
	scope_set       (k, v)
	scope_get       (k) -> v

WIDGET STATE

	keepalive       (id, [update_fn])    keep widget alive this frame
	state           (id) -> state        get widget state
	state_init      (id, k, v)           set widget state var if widget is alive
	on_free         (id, free_fn)        add a widget gc hook
	render_state    (id) -> state        get renderer-local widget state
	local_state     (id[, k]) -> state | v | nil   widget state in a draw callback,
	                                     nil if the frame came from another machine

FOCUS STATE

	focused_id      = id                    id of focused widget
	focus           (id)                    focus widget
	focused         (id) -> t|f             check if widget is currently focused
	focusing        (id) -> t|f             widget is focusing this frame
	focusable       (id, [tab_order])       add widget to the tab order
	nofocus         ()                      keep the next widget out of the tab order
	capture_tab     (id, [back])            widget gets tab (shift-tab if back)
	focus_group     ([trap], [tab_order], [id]) begin a tab order group
	end_focus_group ()                      end a tab order group
	default_button  (id)                    enter in the group's inputs hits it
	focus_inside    (group_id) -> t|f       focus is inside this focus group
	focus_first     (group_id)              focus first widget unless focus is inside
	tab_into        (id)                    next tab enters this focus group
	window_focusing   = t                   window is focusing this frame
	window_unfocusing = t                   window is unfocusing this frame
	window_focused    = t|f                 check if window is currently focused

COMMAND RECORDING

	start_recording ()
	end_recording   () -> a1
	play_recording  (a1)

WIDGET DEFINITIONS

	cmd             (cmd_id, ...args) -> i0

	widget          (cmd_name, t, is_ct)
	t.measure       : f(a, i, axis)    measure widget on axis (0 for x, 1 for y)
	t.measure_end   : f(a, i, axis)    measure widget on axis at widget's end() call
	t.position      : f(a, i, axis, x, w, ct_i)   position widget on axis
	t.translate     : f(a, i, x, y)               translate widget
	t.draw          : f(a, i, recs)     draw widget
	t.draw_end      : f(a, i)           draw widget at widget's end() call
	t.hit           : f(a, i, recs)     hit-test widget
	t.is_flex_child : t|f     has fr at a[i+FR] and min_w/h at a[i+2+axis]
	                          so it can be a child of a flex container.

	measure         (id)        request that widget be measured; puts x,y,w,h in its state

SPACINGS (MARGINS & PADDINGS)

	rem             (rem) -> x   rem units to pixels
	em              (em) -> x    em units to pixels

	sp025           () -> rem( .125)
	sp05            () -> rem( .25)
	sp075           () -> rem( .375)
	sp              () -> rem( .5)
	sp1             () -> rem( .5)
	sp2             () => rem( .75)
	sp4             () => rem(1)
	sp8             () => rem(2)

	p[adding]           ([px1], [py1], [px2], [py2])
	p[adding_]l[eft]    (p)
	p[adding_]r[ight]   (p)
	p[adding_]t[op]     (p)
	p[adding_]b[ottom]  (p)
	p[adding_]h[oriz]   (p)
	p[adding_]v[ert]    (p)

	m[argin]            ([mx1], [my1], [mx2], [my2])
	m[argin_]l[eft]     (m)
	m[argin_]r[ight]    (m)
	m[argin_]t[op]      (m)
	m[argin_]b[ottom]   (m)
	m[argin_]h[oriz]    (m)
	m[argin_]v[ert]     (m)

BOX WIDGET DEFINITIONS

	cmd_box         (cmd, fr, align, valign, min_w, min_h, ...args) -> i0
	box_widget      (cmd_name, t, is_ct)   define a box widget
	box_ct_widget   (cmd_name, t)          define a container box widget

	PX1             = index offset in a for x1 padding; y1 padding at PX1+1
	PX2             = index offset in a for x2 padding; y1 padding at PX2+1
	MX1             = index offset in a for x1 margin; y1 margin at MX1+1
	MX2             = index offset in a for x2 margin; y2 margin at MX2+1
	FR              = index offset in a for fr
	ALIGN           = index offset in a for align
	S               = index offset in a for arg#1 after ui_cmd_box_ct args

	add_ct_min_wh   (a, axis, w)   use in measure callback to declare min width/height

	align_x         (a, i, axis, sx, sw)  use in position callback
	align_w         (a, i, axis, sx, sw)  use in position callback
	inner_x         (a, i, axis, ct_x)    use in position callback
	inner_w         (a, i, axis, ct_x)    use in position callback

	ct_i            () -> ct_i    get container index in a; use in widget creation and in measure callback
	last_i          () -> last_i  get the index of the last cmd in a

	popup_target_rect (a, i)  use in draw callback to find a popup's target rect

CONTAINERS

	hv              ('h'|'v', fr, gap, align, valign, min_w, min_h)
	h | v           (fr, gap, align, valign, min_w, min_h)
	stack           (id, fr, align, valign, min_w, min_h)
	sb | scrollbox  (id, fr, overflow_x, overflow_y, align, valign, min_w, min_h, sx, sy, x_id, y_id)
	popup           (id, layer, target_i, side, align, min_w, min_h, flags, z_index, ox, oy)
	hsplit | vsplit (id, size, unit, fixed_side, split_fr, gap, align, valign, min_w, min_h)
	splitter        ()
	toolbox         (id, title, align, valign, x0, y0, target_i)
	frame           (id, on_measure, on_frame, fr, align, valign, min_w, min_h, ...args)
	end             ()

	scroll_to_view_next_box  ()
	scroll_to_view_rect      (scrollbox_id, x, y, w, h)

BORDER & BACKGROUND

	bb              (bg_color, bg_color_state, sides, border_color, border_color_state, border_radius)
	bb_tooltip      (bg_color, bg_color_state,        border_color, border_color_state, border_radius)
	shadow          (x, y, blur, spread, inset, color)

	bg_dots         (id, speed)

TEXT

	color           (color, color_state)
	font            (font|alias)
	font_alias      (alias, font)
	icon_def        (name, font, codepoint|ligature)
	icon            (id, name, fr, align, valign, max_w, w, h)
	fs | font_size  (size)
	font_weight     (weight)
	bold            ()
	nobold          ()
	lg | line_gap   (gap)
	xsmall          ()      ui.font_size(.72  )
	small           ()      ui.font_size(.8125)
	smaller         ()      ui.font_size(.875 )
	large           ()      ui.font_size(1.125)
	xlarge          ()      ui.font_size(1.5  )

	get_font_size   () -> font_size

	text            (id, s, fr, align, valign, max_w, w, h, 'line'|'word'|0, editable, input_type)
	text_editable   (id, s, fr, align, valign, max_w, w, h, input_type)
	text_lines      (id, s, fr, align, valign, max_w, w, h, editable)
	text_wrapped    (id, s, fr, align, valign, max_w, w, h, editable)
	mark_text       (i1, i2, [bg])   background behind [i1,i2) of the next text
	select_text     (id, i, len)         place the caret in an editable text
	text_selection  (id, [from_end], [wanted]) -> [i, len]

	measure_text    (cx, s) -> {w:, asc:, dsc:, {actual|font}BoundingBox{Ascent|Descent|Left|Right}:, }

INPUT

	button          (id, s, fr, align, valign, min_w, min_h, style)
	icon_button     (id, icon, [s], fr, align, valign, min_w, min_h, style)
	input           (id, s, fr, min_w, min_h)
	label           (for_id, s, fr, align, valign)
	radio_label     (for_id, for_group_id, s, fr, align, valign)
	dropdown        (id, items, fr, max_w, min_w, min_h)
	toggle          (id, fr, align, valign, min_w, min_h)
	checkbox        (cmd, id, fr, align, valign, min_w, min_h)

COLOR PICKER

	color_picker    (id, hue, sat, lum)
	sat_lum_square  (id, hue, sat, lum)
	hue_bar         (id, hue)

UI TEMPLATE EDITOR

	template        (id, t, ...stack_args)

LIST

	[h|v|hv]list    (id, items, fr, align, valign, item_align, item_valign, item_fr, max_w, min_w)

OTHER

	drag_point      (id, x, y, color)
	polyline        (id, points, closed, fill_color, fill_color_state, stroke_color, stroke_color_state)
	resizer         (id, default_w, default_h, axis, max_w, max_h)

SCREEN SHARING

	shared_screen   (id, answer_con, fr, align, valign, min_w, min_h)
	process_shared_screen_input (p, t)

	pack_frame      () -> s     pack current frame for sending over the network
	frame_changed   = noop      hook this for sending frames out

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
const G = window

let script_attr = k => document.currentScript.hasAttribute(k)
let ui = script_attr('global') || script_attr('ui-global') ? window : {}
G.ui = ui

ui.VERSION = 1

// utilities -----------------------------------------------------------------

const {
	repl,
	isarray, isstr, isnum,
	assert, warn, pr, debug, trace,
	floor, ceil, round, max, min, abs, clamp, logbase, lerp,
	dec, num, str, json, json_arg,
	set, map, array, attr,
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
	day, week, weekday, weekday_name,
} = glue

let clock_ms = () => ui.DEBUG ? performance.now() : 0

let array_freelist = () => freelist(array)

// When capturing the mouse, setting the cursor for the element that
// is hovered doesn't work anymore, so we use this hack instead.
// We haven't even started yet and the DOM is already giving us trouble.
{
let style = document.createElement('style')
document.documentElement.appendChild(style)
ui.set_cursor = function(cursor) {
	// TODO: use style API here, it's probably faster.
	style.innerHTML = cursor && ui.captured_id ? `* {cursor: ${cursor} !important; }` : ''
	canvas.style.cursor = cursor ?? 'initial'
}
}

// styles --------------------------------------------------------------------

let fonts_to_load = []
ui.load_font = function(name, url, desc) {
	fonts_to_load.push([name, url, desc])
}

ui.css = function(s) {
	let style = document.createElement('style')
	style.innerHTML = s
	document.head.appendChild(style)
}

ui.css(`

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
}

`)

// colors --------------------------------------------------------------------

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

// themes --------------------------------------------------------------------

function array_of_objs(n) {
	let a = []
	for (let i = 0; i < n; i++)
		a.push({})
	return a
}

function theme_make(name, is_dark) {
	themes[name] = {
		is_dark : is_dark,
		name    : name,
		// TODO: 255 seems excessive, though it's probably still faster
		// than a hashmap access, dunno...
		fg     : array_of_objs(255),
		border : array_of_objs(255),
		bg     : array_of_objs(255),
		shadow : {},
	}
}
let themes = {}
ui.themes = themes
theme_make('light', false)
theme_make('dark' , true)

// state parsing -------------------------------------------------------------

const STATE_HOVER         =   1
const STATE_ACTIVE        =   2
const STATE_FOCUSED       =   4
const STATE_ITEM_SELECTED =   8
const STATE_ITEM_FOCUSED  =  16
const STATE_ITEM_ERROR    =  32
const STATE_NEW           =  64
const STATE_MODIFIED      = 128

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

// styling colors ------------------------------------------------------------

// Colors are defined in HSL so they can be adjusted if needed. Colors are
// specified by (theme, name, state) with state 0 (normal) as fallback.
// Concrete colors can also be specified by prefixing them with a `:` (for
// light colors) or `*` (for dark colors), eg. `:#fff`, `*red`, etc. but that
// throws away the ability to HSL-adjust the color.

function def_color_func(k) {
	function def_color(theme, name, state, h, s, L, a, is_dark) {
		if (theme == '*') { // define color for all themes
			for (let theme_name in themes)
				def_color(theme_name, name, state, h, s, L, a, is_dark)
			return
		}
		let states = themes[theme][k]
		if (state == '*') { // copy all states of a color
			assert(isstr(h), 'expected color name to copy for all states')
			for (let state_i = 0; state_i < states.length; state_i++) {
				let color = states[state_i][h]
				if (color != null)
					states[state_i][name] = color
			}
			return
		}
		let state_i = parse_state(state)
		states[state_i][name] = isnum(h)
			? [hsl(h, s, L, a), h, s, L, a, is_dark]
			: isarray(h) ? h : ui[k+'_color_hsl'](h, s ?? state_i, L ?? theme)
	}
	return def_color
}

let theme
ui.get_theme = () => theme
ui.dark = () => theme.is_dark

// default color to fall back to when a name isn't found in the theme, per
// kind, so a missing/misspelled color name doesn't crash the whole frame.
let default_color_name = {fg: 'text', bg: 'bg', border: 'light'}

function lookup_color_hsl_func(k) {
	let default_name = default_color_name[k]
	return function(name, state, theme1) {
		let state_i = parse_state(state)
		theme1 = theme1 ? themes[theme1] : theme
		let c = theme1[k][state_i][name] ?? theme1[k][0][name]
		if (!c) {
			warn('no ', k, ' for (', name, ', ',
				repl(state, 0, 'normal'), ', ', theme1.name, ')')
			c = theme1[k][0][default_name]
		}
		return c
	}
}

let CC_COLON = ':'.charCodeAt(0) // prefix for light colors
let CC_STAR  = '*'.charCodeAt(0) // prefix for dark colors

function lookup_color_func(hsl_color) {
	return function(name, state, theme) {
		if (name.charCodeAt(0) == CC_COLON) { // custom color
			return name.slice(1)
		}
		return hsl_color(name, state, theme)[0]
	}
}

function lookup_color_rgb_int_func(hsl_color) {
	return function(name, state, theme) {
		let c = hsl_color(name, state, theme)
		return hsl_to_rgb_int(c[1], c[2], c[3])
	}
}

function lookup_color_rgba_int_func(hsl_color) {
	return function(name, state, theme) {
		let c = hsl_color(name, state, theme)
		return hsl_to_rgba_int(c[1], c[2], c[3], c[4])
	}
}

function set_bg_color(color, state) {
	let dark
	assert(isstr(color))
	let c = color.charCodeAt(0)
	if (c == CC_COLON || c == CC_STAR) { // custom color: '*...' or ':...'
		dark = c == CC_STAR
		color = color.slice(1)
	} else {
		let c = bg_color_hsl(color, state)
		dark = c[5] ?? c[3] < .5
		color = c[0]
	}
	theme = dark ? themes.dark : themes.light
	cx.fillStyle = color
}

// text colors ---------------------------------------------------------------

ui.fg_style = def_color_func('fg')
let fg_color_hsl = lookup_color_hsl_func('fg')
let fg_color = lookup_color_func(fg_color_hsl)
ui.fg_color_hsl = fg_color_hsl
ui.fg_color = fg_color
ui.fg_color_rgb  = lookup_color_rgb_int_func(fg_color_hsl)
ui.fg_color_rgba = lookup_color_rgba_int_func(fg_color_hsl)

//           theme    name       state       h     s     L    a
// ---------------------------------------------------------------------------
ui.fg_style('light', 'text'   , 'normal' ,   0, 0.00, 0.00)
ui.fg_style('light', 'text'   , 'hover'  ,   0, 0.00, 0.30)
ui.fg_style('light', 'text'   , 'active' ,   0, 0.00, 0.40)
ui.fg_style('light', 'text'   , 'focused',   0, 0.00, 0.00)
ui.fg_style('light', 'label'  , 'normal' ,   0, 0.00, 0.00)
ui.fg_style('light', 'label'  , 'hover'  ,   0, 0.00, 0.00, 0.9)
ui.fg_style('light', 'link'   , 'normal' , 222, 0.00, 0.50)
ui.fg_style('light', 'link'   , 'hover'  , 222, 1.00, 0.70)
ui.fg_style('light', 'link'   , 'active' , 222, 1.00, 0.80)

ui.fg_style('dark' , 'text'   , 'normal' ,   0, 0.00, 0.8)
ui.fg_style('dark' , 'text'   , 'hover'  ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'text'   , 'active' ,   0, 0.00, 1.00)
ui.fg_style('dark' , 'text'   , 'focused',   0, 0.00, 1.0)
ui.fg_style('dark' , 'label'  , 'normal' ,   0, 0.00, 0.95, 0.7)
ui.fg_style('dark' , 'label'  , 'hover'  ,   0, 0.00, 0.90, 0.9)
ui.fg_style('dark' , 'link'   , 'normal' ,  26, 0.88, 0.60)
ui.fg_style('dark' , 'link'   , 'hover'  ,  26, 0.99, 0.70)
ui.fg_style('dark' , 'link'   , 'active' ,  26, 0.99, 0.80)

ui.fg_style('light', 'marker' , 'normal' ,   0, 0.00, 0.5) // TODO
ui.fg_style('light', 'marker' , 'hover'  ,   0, 0.00, 0.5) // TODO
ui.fg_style('light', 'marker' , 'active' ,   0, 0.00, 0.5) // TODO

ui.fg_style('dark' , 'marker' , 'normal' ,  61, 1.00, 0.57)
ui.fg_style('dark' , 'marker' , 'hover'  ,  61, 1.00, 0.57) // TODO
ui.fg_style('dark' , 'marker' , 'active' ,  61, 1.00, 0.57) // TODO

ui.fg_style('light', 'button-danger', 'normal', 0, 0.54, 0.43)
ui.fg_style('dark' , 'button-danger', 'normal', 0, 0.54, 0.43)

ui.fg_style('light', 'faint' , 'normal' ,  0, 0.00, 0.70)
ui.fg_style('dark' , 'faint' , 'normal' ,  0, 0.00, 0.30)

// border colors -------------------------------------------------------------

ui.border_style = def_color_func('border')
let border_color_hsl = lookup_color_hsl_func('border')
let border_color = lookup_color_func(border_color_hsl)
let ui_border_color = border_color
ui.border_color_hsl = border_color_hsl
ui.border_color = border_color
ui.border_color_rgb  = lookup_color_rgb_int_func(border_color_hsl)
ui.border_color_rgba = lookup_color_rgba_int_func(border_color_hsl)

//               theme    name        state       h     s     L     a
// ---------------------------------------------------------------------------
ui.border_style('light', 'light'   , 'normal' ,   0,    0,    0, 0.10)
ui.border_style('light', 'light'   , 'hover'  ,   0,    0,    0, 0.30)
ui.border_style('light', 'intense' , 'normal' ,   0,    0,    0, 0.30)
ui.border_style('light', 'intense' , 'hover'  ,   0,    0,    0, 0.40)
ui.border_style('light', 'max'     , 'normal' ,   0,    0,    0, 1.00)
ui.border_style('light', 'marker'  , 'normal' ,  61, 1.00, 0.57, 1.00) // TODO

ui.border_style('dark' , 'light'   , 'normal' ,   0,    0,    1, 0.09)
ui.border_style('dark' , 'light'   , 'hover'  ,   0,    0,    1, 0.03)
ui.border_style('dark' , 'intense' , 'normal' ,   0,    0,    1, 0.20)
ui.border_style('dark' , 'intense' , 'hover'  ,   0,    0,    1, 0.40)
ui.border_style('dark' , 'max'     , 'normal' ,   0,    0,    1, 1.00)
ui.border_style('dark' , 'marker'  , 'normal' ,  61, 1.00, 0.57, 1.00)

// background colors ---------------------------------------------------------

ui.bg_style = def_color_func('bg')
let bg_color_hsl = lookup_color_hsl_func('bg')
let bg_color = lookup_color_func(bg_color_hsl)
let ui_bg_color = bg_color
ui.bg_color = bg_color
ui.bg_color_hsl = bg_color_hsl
ui.bg_color_rgb  = lookup_color_rgb_int_func(bg_color_hsl)
ui.bg_color_rgba = lookup_color_rgba_int_func(bg_color_hsl)

function bg_is_dark(bg_color) {
	return isarray(bg_color) ? (bg_color[5] ?? bg_color[3] < .5) : theme.is_dark
}
ui.bg_is_dark = bg_is_dark

//           theme    name      state       h     s     L     a
// -------------------------------------------------------------
ui.bg_style('light', 'bg0'   , 'normal' ,   0, 0.00, 0.98)
ui.bg_style('light', 'bg'    , 'normal' ,   0, 0.00, 1.00)
ui.bg_style('light', 'bg'    , 'hover'  ,   0, 0.00, 0.95)
ui.bg_style('light', 'bg'    , 'active' ,   0, 0.00, 0.93)
ui.bg_style('light', 'bg1'   , 'normal' ,   0, 0.00, 0.95)
ui.bg_style('light', 'bg1'   , 'hover'  ,   0, 0.00, 0.93)
ui.bg_style('light', 'bg1'   , 'active' ,   0, 0.00, 0.90)
ui.bg_style('light', 'bg2'   , 'normal' ,   0, 0.00, 0.85)
ui.bg_style('light', 'bg2'   , 'hover'  ,   0, 0.00, 0.82)
ui.bg_style('light', 'bg3'   , 'normal' ,   0, 0.00, 0.70)
ui.bg_style('light', 'bg3'   , 'hover'  ,   0, 0.00, 0.75)
ui.bg_style('light', 'bg3'   , 'active' ,   0, 0.00, 0.80)
ui.bg_style('light', 'alt'   , 'normal' ,   0, 0.00, 0.95) // bg alternate for grid cells
ui.bg_style('light', 'smoke' , 'normal' ,   0, 0.00, 1.00, 0.80)
ui.bg_style('light', 'input' , 'normal' ,   0, 0.00, 0.98)
ui.bg_style('light', 'input' , 'focused',   0, 0.00, 1.00)
ui.bg_style('light', 'input' , 'hover'  ,   0, 0.00, 0.94)
ui.bg_style('light', 'input' , 'active' ,   0, 0.00, 0.90)

ui.bg_style('dark' , 'bg0'   , 'normal' , 216, 0.28, 0.08)
ui.bg_style('dark' , 'bg'    , 'normal' , 216, 0.28, 0.10)
ui.bg_style('dark' , 'bg'    , 'hover'  , 216, 0.28, 0.12)
ui.bg_style('dark' , 'bg'    , 'active' , 216, 0.28, 0.14)
ui.bg_style('dark' , 'bg1'   , 'normal' , 216, 0.28, 0.15)
ui.bg_style('dark' , 'bg1'   , 'hover'  , 216, 0.28, 0.19)
ui.bg_style('dark' , 'bg1'   , 'active' , 216, 0.28, 0.22)
ui.bg_style('dark' , 'bg2'   , 'normal' , 216, 0.28, 0.22)
ui.bg_style('dark' , 'bg2'   , 'hover'  , 216, 0.28, 0.25)
ui.bg_style('dark' , 'bg3'   , 'normal' , 216, 0.28, 0.29)
ui.bg_style('dark' , 'bg3'   , 'hover'  , 216, 0.28, 0.31)
ui.bg_style('dark' , 'bg3'   , 'active' , 216, 0.28, 0.33)
ui.bg_style('dark' , 'alt'   , 'normal' , 260, 0.28, 0.13)
ui.bg_style('dark' , 'smoke' , 'normal' ,   0, 0.00, 0.00, 0.70)
ui.bg_style('dark' , 'input' , 'normal' , 216, 0.28, 0.17)
ui.bg_style('dark' , 'input' , 'focused', 216, 0.28, 0.08)
ui.bg_style('dark' , 'input' , 'hover'  , 216, 0.28, 0.21)
ui.bg_style('dark' , 'input' , 'active' , 216, 0.28, 0.25)

// TODO: see if we can find a declarative way to copy fg colors to bg in bulk.
for (let theme of ['light', 'dark']) {
	for (let state of ['normal', 'hover', 'active'])
		for (let fg of ['text', 'link', 'marker'])
			ui.bg_style(theme, fg, state, fg_color_hsl(fg, state, theme))
}

ui.bg_style('light', 'scrollbar', 'normal' ,   0, 0.00, 0.70, 0.5)
ui.bg_style('light', 'scrollbar', 'hover'  ,   0, 0.00, 0.75, 0.8)
ui.bg_style('light', 'scrollbar', 'active' ,   0, 0.00, 0.80, 0.8)

ui.bg_style('dark' , 'scrollbar', 'normal' , 216, 0.28, 0.37, 0.5)
ui.bg_style('dark' , 'scrollbar', 'hover'  , 216, 0.28, 0.39, 0.8)
ui.bg_style('dark' , 'scrollbar', 'active' , 216, 0.28, 0.41, 0.8)

ui.bg_style('*', 'button'        , '*' , 'bg')
ui.bg_style('*', 'button-primary', '*' , 'link')

ui.bg_style('*', 'search' , 'normal',  60,  1.00, 0.80) // quicksearch text bg
ui.bg_style('*', 'info'   , 'normal', 200,  1.00, 0.30) // info bubbles
ui.bg_style('*', 'warn'   , 'normal',  39,  1.00, 0.50) // warning bubbles
ui.bg_style('*', 'error'  , 'normal',   0,  0.54, 0.43) // error bubbles

// input value states
ui.bg_style('light', 'item', 'new'           , 240, 1.00, 0.97)
ui.bg_style('light', 'item', 'modified'      , 120, 1.00, 0.93)
ui.bg_style('light', 'item', 'new modified'  , 180, 0.55, 0.87)

ui.bg_style('dark' , 'item', 'new'           , 240, 0.35, 0.27)
ui.bg_style('dark' , 'item', 'modified'      , 120, 0.59, 0.24)
ui.bg_style('dark' , 'item', 'new modified'  , 157, 0.18, 0.20)

// grid cell & row states. these need to be opaque!
ui.bg_style('light', 'item', 'item-focused'                       ,   0, 0.00, 0.93)
ui.bg_style('light', 'item', 'item-selected'                      ,   0, 0.00, 0.91)
ui.bg_style('light', 'item', 'item-focused item-selected'         ,   0, 0.00, 0.87)
ui.bg_style('light', 'item', 'item-focused focused'               ,   0, 0.00, 0.87)
ui.bg_style('light', 'item', 'item-focused item-selected focused' , 139 / 239 * 360, 141 / 240, 206 / 240)
ui.bg_style('light', 'item', 'item-selected focused'              , 139 / 239 * 360, 150 / 240, 217 / 240)
ui.bg_style('light', 'item', 'item-error'                         ,   0, 0.54, 0.43)
ui.bg_style('light', 'item', 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.bg_style('light', 'row' , 'item-focused focused'               , 139 / 239 * 360, 150 / 240, 231 / 240)
ui.bg_style('light', 'row' , 'item-focused'                       , 139 / 239 * 360,   0 / 240, 231 / 240)
ui.bg_style('light', 'row' , 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.bg_style('dark' , 'item', 'item-focused'                       , 195, 0.06, 0.12)
ui.bg_style('dark' , 'item', 'item-selected'                      ,   0, 0.00, 0.20)
ui.bg_style('dark' , 'item', 'item-focused item-selected'         , 208, 0.11, 0.23)
ui.bg_style('dark' , 'item', 'item-focused focused'               ,   0, 0.00, 0.23)
ui.bg_style('dark' , 'item', 'item-focused item-selected focused' , 211, 0.62, 0.24)
ui.bg_style('dark' , 'item', 'item-selected focused'              , 211, 0.62, 0.19)
ui.bg_style('dark' , 'item', 'item-error'                         ,   0, 0.54, 0.43)
ui.bg_style('dark' , 'item', 'item-error item-focused'            ,   0, 1.00, 0.60)

ui.bg_style('dark' , 'row' , 'item-focused focused'               , 212, 0.61, 0.13)
ui.bg_style('dark' , 'row' , 'item-focused'                       ,   0, 0.00, 0.13)
ui.bg_style('dark' , 'row' , 'item-error item-focused'            ,   0, 1.00, 0.60)

// canvas --------------------------------------------------------------------

// There's only one global canvas stretched to the entire viewport for now
// since we're not planning to have our canvas-based UI embedded in a normal
// HTML page any time soon.

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
	ui.font_size_normal = 12 * dpr
	animate()
}
ui.resize = resize_canvas
window.addEventListener('resize', resize_canvas)

let raf_id
let frame_no = 0
function raf_animate() {
	raf_id = null
	frame_no++
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

ui.default_theme = document.documentElement.getAttribute('theme') ?? 'light'
ui.default_font  = document.documentElement.getAttribute('font' ) ?? 'Arial'
function set_screen_bg() {
	theme = themes[ui.default_theme]
	document.documentElement.style.background = bg_color('bg')
}
ui.set_default_theme = function(theme) {
	if (!theme)
		theme = system_in_dark_mode() ? 'dark' : 'light'
	ui.default_theme = theme
	set_screen_bg()
}

function system_in_dark_mode() {
	let mql = window.matchMedia
		&& window.matchMedia('(prefers-color-scheme: dark)')
	return !!(mql && mql.matches)
}

window.matchMedia('(prefers-color-scheme: dark)')
	.addEventListener('change', function(e) {
		ui.set_default_theme()
	})

// prevent flicker on load by setting the screen's background color now.
ui.set_default_theme()
set_screen_bg()

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

// TUI -----------------------------------------------------------------------

ui.TUI = false

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

// mouse state ---------------------------------------------------------------

// We support multiple pointers for screen sharing / remote control situations
// but only one can be active at any one time, so two users can't hover two
// things at the same time and can't drag multiple things at the same time,
// and other users can't use the mouse while one user is dragging something.
//
// "true" multiple pointer support may sound cool, but it would complicate
// mouse handling *for every widget*, and it would be a nightmare to figure
// out what ops are allowed in the UI while one user is dragging something.

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
	p.changed = false
}

function update_mouse(ev) {
	ui.local_pointer.mx = round(ev.clientX * dpr)
	ui.local_pointer.my = round(ev.clientY * dpr)
	ui.local_pointer.changed = true
}

canvas.addEventListener('pointerdown', function(ev) {
	update_mouse(ev)
	if (ev.button == 0) {
		ui.local_pointer.click = true
		ui.local_pointer.pressed = true
		this.setPointerCapture(ev.pointerId)
	}
	ui.local_pointer.activate()
	animate()
})

canvas.addEventListener('pointerup', function(ev) {
	update_mouse(ev)
	if (ev.button == 0) {
		ui.local_pointer.pressed = false
		ui.local_pointer.clickup = true
		this.releasePointerCapture(ev.pointerId)
	}
	ui.local_pointer.activate()
	animate()
})

canvas.addEventListener('dblclick', function(ev) {
	update_mouse(ev)
	if (ev.button == 0) {
		ui.local_pointer.dblclick = true
	}
	ui.local_pointer.activate()
	animate()
})

canvas.addEventListener('pointermove', function(ev) {
	update_mouse(ev)
	ui.local_pointer.activate()
	animate()
})

canvas.addEventListener('pointerenter', function(ev) {
	update_mouse(ev)
	ui.local_pointer.activate()
	animate()
})

canvas.addEventListener('pointerleave', function(ev) {
	if (ui.pointer != ui.local_pointer || ui.captured_id == null) {
		ui.local_pointer.mx = null
		ui.local_pointer.my = null
	}
	ui.local_pointer.activate()
	ui.set_cursor()
	animate()
})

// NOTE: wheelDeltaY is 150 in chrome and 120 if FF. Browser developers...
canvas.addEventListener('wheel', function(ev) {
	ui.local_pointer.wheel_dy = ev.deltaY
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

// mouse pointer on current transform ----------------------------------------

ui.update_mouse = function() {
	let m = cx.getTransform().invertSelf()
	let mx = ui.mx_notrans
	let my = ui.my_notrans
	ui.mx = transform_point_x(m, mx, my)
	ui.my = transform_point_y(m, mx, my)
}

// mouse capture state -------------------------------------------------------

let capture_state = obj()

ui.capture = function(id) {
	if (!id)
		return
	if (ui.captured_id != null)
		if (ui.captured_id == id)
			return capture_state
		else
			return
	if (!ui.click)
		return
	let hs = hovers(id)
	if (!hs)
		return
	ui.captured_id = id
	focus_taken = true
	assign(capture_state, hs)
	ui.mx0 = ui.mx
	ui.my0 = ui.my
	return capture_state
}

function captured(id) {
	return id && ui.captured_id == id && capture_state || null
}
ui.captured = captured

// drag & drop ---------------------------------------------------------------

{
let out = [null, 0, 0, null]
ui.drag = function(id, axis) {
	let move_x = !axis || axis == 'x' || axis == 'xy'
	let move_y = !axis || axis == 'y' || axis == 'xy'
	let cs = captured(id)
	let state = null
	let dx = 0
	let dy = 0
	if (cs) {
		if (move_x) { dx = ui.mx - ui.mx0 }
		if (move_y) { dy = ui.my - ui.my0 }
		state = ui.clickup ? 'drop' : 'dragging'
		cs.drag_state = state
	} else {
		cs = hit(id)
		if (cs) {
			if (ui.click) {
				cs = ui.capture(id)
				if (cs)
					state = 'drag'
			} else
				state = 'hover'
		}
	}
	out[0] = state
	out[1] = dx
	out[2] = dy
	out[3] = cs
	return out
}
}

// keyboard state ------------------------------------------------------------

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

function apply_key_event(p, e) {
	let ev_name  = e[0]
	let full_key = e[1]
	let key      = e[2]
	let key_set = ev_name == 'down' ? key_downs : key_ups
	key_set.add(key)
	key_set.add(full_key)
	ui.key_events.push(e)
	if (ev_name == 'down')
		p.key_state.add(key)
	else
		p.key_state.delete(key)
	p.activate() // typing takes over from whoever was driving
	animate()
}

function process_key(ev, ev_name, key) {
	let p = ui.local_pointer
	let e = make_key_event(p, ev_name, key)
	apply_key_event(p, e)
	let full_key = e[1]
	let key_low  = e[2] // lowercased key
	let captured = ev_name == 'down' ? captured_keydowns : captured_keyups
	if (ev && (key_low == 'tab' || captured[full_key])) {
		// this allows us to supress some (but not all) browser key events.
		ev.preventDefault()
	}
}
document.addEventListener('keydown', function(ev) {
	process_key(ev, 'down', ev.key)
})
document.addEventListener('keyup', function(ev) {
	process_key(ev, 'up', ev.key)
})

document.addEventListener('paste', async function(e) {
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

ui.keys_down   = () => key_downs.size
ui.keys_up     = () => key_ups.size
ui.key_changes = () => key_downs.size + key_ups.size

// custom events -------------------------------------------------------------

// events are id-based state are kept for this and next frame only, so that
// a widget that listens to an event can still catch it if the widgets that
// fired it appears later in the frame.
let event_state = map() // {id.ev->[frame_gen, args]}

ui.fire = function(id, ev, ...args) {
	event_state.set(id+'.'+ev, [frame_gen, args])
}

ui.listen = function(id, ev) {
	// call update_fn if not already called, which calls fire().
	state_update(id, state_map.get(id))
	return event_state.get(id+'.'+ev)?.[1]
}

ui.consume = function(id, ev) {
	let k = id+'.'+ev
	// call update_fn if not already called, which calls fire().
	state_update(id, state_map.get(id))
	let e = event_state.get(k)
	if (!e) return
	event_state.delete(k)
	return e[1]
}

// scopes --------------------------------------------------------------------

let scope_stack = []
let scope = null

function begin_scope() {
	scope_stack.push(scope)
	// scope creation is delayed to first call of scope_set().
	// TODO: could COW be faster here with deep scopes?
	// TODO: would parallel per-key stacks be faster here instead of one stack of maps?
	scope = null
}

function end_scope() {
	let ended_scope = scope
	scope = scope_stack.pop()
	if (ended_scope) {
		end_color(ended_scope)
		end_font(ended_scope)
		end_font_size(ended_scope)
		end_font_weight(ended_scope)
		end_line_gap(ended_scope)
	}
}

function scope_get(k) {
	// look in current scope
	if (scope) {
		let v = scope[k]
		if (v !== undefined)
			return v
	}
	// look in parent scopes
	for (let i = scope_stack.length-1; i >= 0; i--) {
		let scope = scope_stack[i]
		if (scope) {
			let v = scope[k]
			if (v !== undefined)
				return v
		}
	}
}
ui.scope_get = scope_get

function scope_set(k, v) {
	scope = scope ?? obj()
	scope[k] = v
}
ui.scope_set = scope_set

function scope_prev_diff_var(ended_scope, k) {
	let v = ended_scope[k]
	if (v === undefined) return
	let v0 = scope_get(k)
	if (v === v0) return
	return v0
}

function scope_stack_check() {
	assert(!scope_stack.length, 'scope not closed')
}

ui.scope = begin_scope
ui.end_scope = end_scope

/* id states -----------------------------------------------------------------

Persistence between frames is kept in per-id state objects. Widgets need to
call keepalive(id) otherwise their state is garbage-collected at the end
of the frame. Widgets can also register a `free` callback to be called if
the widget doesn't appear again on a future frame. State updates should be
done inside an update callback registered with keepalive() so that the widget
state can be updated in advance of the widget appearing in the frame in case
the widget state is queried from outside before the widget appears in the frame.
The update callback is called once per relayout pass, either due to a state
access or when the widget is created in the frame.

*/

let state_map      = map() // {id->state}
let current_id_set = set() // {id}
let remove_id_set  = set() // {id}
let frame_gen = 0 // frame counter, for running state updates once per frame

ui._state_map = state_map

function keepalive(id, update_fn) {
	assert(id, 'id required')
	current_id_set.add(id)
	remove_id_set.delete(id)

	if (update_fn) {
		let s = ui.state(id)
		s.update = update_fn
		state_update(id, s)
	}
}
ui.keepalive = keepalive

// an update must run once per redraw in order to avoid acting on events
// like mouse clicks more than once (one-shot state only gets cleared at the
// end of the frame). the update is triggered by whichever comes first:
// ui.state() or keepalive(). frame_gen keeps it from running twice per
// relayout pass.
function state_update(id, s) {
	let update_fn = s?.update
	if (!update_fn)
		return
	if (s.frame_gen == frame_gen)
		return
	s.frame_gen = frame_gen
	update_fn(id, s)
}

ui.state = function(id, k) {
	assert(!render_state_map, 'state() called while rendering')
	if (!id)
		return
	let s = state_map.get(id)
	if (!s) {
		if (k)
			return
		s = obj()
		state_map.set(id, s)
	} else {
		state_update(id, s)
	}
	return k ? s[k] : s
}

ui.state_init = function(id, k, v) {
	let s = ui.state(id)
	if (s[k] != null) return
	s[k] = v
}

function state_gc() {
	for (let id of remove_id_set) {
		let s = state_map.get(id)
		if (!s)
			continue
		assert(!(ui.captured_id == id), 'id removed while captured')
		let free = s.free
		if (free)
			free(s, id)
		state_map.delete(id)
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

// command state -------------------------------------------------------------

let color, color_state, font, font_size, font_weight, line_gap

ui.get_font_size = () => font_size

ui.TUI = false
let tui_cell_w
let tui_cell_h
function reset_tui() {
	if (!ui.TUI) return
	cx.font = font_size + 'px monospace'
	let m = measure_text(cx, '0')
	let asc = m.actualBoundingBoxAscent
	let dsc = m.actualBoundingBoxDescent
	tui_cell_w = m.width
	tui_cell_h = asc + dsc
}

function reset_canvas() {
	if (!dpr) return // resize_canvas() wasn't called yet (shouldn't happen).
	theme = themes[ui.default_theme]
	color = 'text'
	color_state = 0
	font = ui.TUI ? 'monospace' : ui.default_font
	font_size = ui.font_size_normal
	font_weight = 'normal'
	line_gap = 0.5
	scope_set('color', color)
	scope_set('color_state', color_state)
	scope_set('theme', theme)
	scope_set('font', font)
	scope_set('font_size', font_size)
	scope_set('font_weight', font_weight)
	scope_set('line_gap', line_gap)
	reset_tui()
	cx.font = font_weight + ' ' + font_size + 'px ' + font
	reset_shadow()
}

// focus state ---------------------------------------------------------------

ui.focused_id = null
ui.focused_by_key = null
let focusing_id

// set when focus is taken, the mouse is captured, or a solid popup is
// clicked: another click clears the focus.
let focus_taken

ui.focus = function(id, by_key) {
	focus_taken = true
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

window.addEventListener('blur', function(ev) {
	ui.window_unfocusing = true
	ui.window_focused = false
	ui.local_pointer.key_state.clear()
	key_downs.clear()
	key_ups.clear()
	ui.key_events.length = 0
	animate()
})

ui.window_focused = document.hasFocus()

window.addEventListener('focus', function(ev) {
	ui.window_focusing = true
	ui.window_focused = true
	animate()
})

// container stack -----------------------------------------------------------

// used in both frame creation and measuring phases.

let ct_stack = [] // [ct_i1,...]
ui.ct_stack = ct_stack

ui.ct_i = () => assert(ct_stack.at(-1), 'no container')
ui.rel_ct_i = () => ui.ct_i() - (a.length+2)
ui.last_i = () => cmd_last_i(a)

function ct_stack_check() {
	if (ct_stack.length) {
		for (let i of ct_stack)
			debug(C(a, i), 'not closed')
		assert(false)
	}
}

// command recordings --------------------------------------------------------

let rec_freelist = array_freelist()

function rec() {
	let a = rec_freelist.alloc()
	return a
}

function free_rec(a) {
	a.length = 0
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
	rec_stack.push(a, ct_stack.length)
	a = a1
}

ui.end_recording = function() {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let ct_stack_len = rec_stack.pop()
	let a1 = a
	a = rec_stack.pop()
	assert(ct_stack.length == ct_stack_len,
		'recording must open and close its own containers')
	return a1
}

ui.play_recording = function(a1) {
	a.push(...a1)
	free_rec(a1)
}

function rec_stack_check() {
	assert(!rec_stack.length, 'recordings left unplayed')
}

// secondary command recordings ----------------------------------------------

let recs = []
let rec_i

function begin_rec() {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let a0 = a
	a = rec()
	rec_i = recs.length
	recs.push(a)
	return a0
}

function end_rec(a0) {
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let a1 = a
	a = a0
	return a1
}

function free_recs() {
	for (let a of recs)
		free_rec(a)
	recs.length = 0
}

// current command recording -------------------------------------------------

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
// sibling we use cmd_next_ext_i(). To go back to the container's command
// from its "end" command, we use i+a[i].
// NOTE: Using relative indexes everywhere allows creating command recordings
// that are relocatable, i.e. can be moved into other recordings without
// having to reoffset the indexes.

let a // current recording

let cmd_names = []
let cmd_name_map = obj()

function C(a, i) { return cmd_names[a[i-1]] }

let max_cmd    =  0 // even numbers for non-containers (0 is reserved).
let max_cmd_ct = -1 // odd numbers containers
function unsparse(a, i) {
	if (a[i] === undefined)
		a[i] = null
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
	unsparse_all(cmd-1)
	cmd_names[cmd] = name
	cmd_name_map[name] = cmd
	return cmd
}
function cmd_ct(name) {
	return cmd(name, true)
}

let cmd_next_i = (a, i) => i+a[i-2] // index of next cmd
let cmd_prev_i = (a, i) => i+a[i-3] // index of prev cmd
let cmd_last_i = (a) => cmd_prev_i(a, a.length+2) // index of last command in a
let cmd_arg_end_i = (a, i) => cmd_next_i(a, i)-3 // index after the last arg

// `arguments` instead of `...args` avoids an array allocation.
function ui_cmd(cmd) {
	let n = arguments.length
	let i = a.length+2 // abs index of this cmd's arg#1
	let next_i = n+2 // rel index of next cmd's arg#1
	let prev_i = -next_i // rel index of this cmd's arg#1, rel to next cmd's arg#1
	a.push(next_i, cmd)
	for (let j = 1; j < n; j++)
		a.push(arguments[j])
	a.push(prev_i)
	return i
}
ui.cmd = ui_cmd

// append args to the command at i, for slots that few of them need.
// i must still be the last command: ui_cmd_box() records a second one when
	// scroll_to_view_next_box() was called before it.
// `arguments` instead of `...args` to avoid an array allocation.
function ui_cmd_add_args(i) {
	assert(cmd_last_i(a) == i)
	a.length-- // drop prev_i
	for (let j = 1, n = arguments.length; j < n; j++)
		a.push(arguments[j])
	let next_i = a.length+3 - i
	a[i-2] = next_i
	a.push(-next_i)
}
ui.cmd_add_args = ui_cmd_add_args

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

// z-layers ------------------------------------------------------------------

let layer_map = {} // {name->layer}
let layer_arr = [] // [layer1,...] in creation order

function ui_layer(name, index, flags) {
	if (!name)
		return current_layer
	let layer = layer_map[name]
	if (!layer) {
		layer = obj()
		layer.name = assert(name)
		layer_map[name] = layer
		layer_arr.push(layer)
		layer.i = layer_arr.length-1
		layer.paint_order = index ?? 0
		layer.root  = !!flags?.includes('root')
		layer.modal = !!flags?.includes('modal')
	}
	return layer
}
ui.layer = ui_layer

// each layer owns paint_order_band consecutive paint_order values and a
// popup's z_index picks one of them.
let paint_order_band = 0x10000

let POPUPS_SLOTS       = 4
let POPUPS_PAINT_ORDER = 0
let POPUPS_REC_I       = 1
let POPUPS_CT_I        = 2
let POPUPS_INNER       = 3

let popups_freelist = array_freelist()

let root_popups = []
// [current_popups, i past the popup's END, a] per popup that owns popups.
let popups_stack = []
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
	popups_stack.length = 0
	current_popups = root_popups
}

function add_popup(popups, paint_order, rec_i, ct_i, inner_popups) {
	// stop at the last entry that is not above paint_order, so that entries
	// with an equal paint_order stay in the order they were added.
	let k = popups.length
	while (k) {
		let j = k - POPUPS_SLOTS
		if (popups[j+POPUPS_PAINT_ORDER] <= paint_order)
			break
		k = j
	}
	if (k == popups.length)
		popups.push(paint_order, rec_i, ct_i, inner_popups)
	else
		popups.splice(k, 0, paint_order, rec_i, ct_i, inner_popups)
}

const layer_base =
ui_layer('base'    , 0)
ui_layer('overlay' , 1) // focus rings, drag points: must cover siblings.
ui_layer('error'   , 2) // persistent tooltips: not hover (tooltips are hover).
ui_layer('toolbox' , 3, 'modal')
ui_layer('open'    , 4, 'modal') // dropdowns, menus: must cover all non-modals.
ui_layer('modal'   , 5, 'modal') // modals: must cover all other modals.
ui_layer('tooltip' , 6, 'root') // tooltips: must cover all static.
ui_layer('drag'    , 7, 'root') // dragged object: must cover everything.

let layer_stack = [] // [layer1_i, ...]
let current_layer // set while building

let current_layer_rec
let current_layer_ct_i

function begin_layer(layer) {
	layer_stack.push(current_layer)
	current_layer = layer
}

function end_layer() {
	current_layer = layer_stack.pop()
}

function layer_stack_check() {
	if (layer_stack.length) {
		for (let layer of layer_stack)
			debug('layer', layer.name, 'not closed')
		assert(false)
	}
}

// rendering phases ----------------------------------------------------------

let measure       = []
let measure_end   = []
let position      = []
let translate     = []
let register      = []
let draw          = []
let draw_end      = []
let hittest       = []
let is_flex_child = []

ui.is_flex_child = is_flex_child

// measuring phase (per-axis) ------------------------------------------------

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

// positioning phase (per-axis) ----------------------------------------------

// walk the element tree top-down, and call the position function for each
// element that has it. recursive, uses call stack to pass ct_i and ct_w.

function position_rec(a, axis, ct_wh) {
	for (let i = 2, n = a.length; i < n; i = cmd_next_ext_i(a, i)) {
		let cmd = a[i-1]
		let position_f = position[cmd]
		if (!position_f)
			continue
		let min_wh = a[i+2+axis]
		position_f(a, i, axis, 0, max(min_wh, ct_wh))
	}
}

// translation phase ---------------------------------------------------------

// do scrolling and popup positioning and offset all boxes (top-down, recursive).

// NOTE: translate is not re-runnable by design, which enables:
// - running on_frame callbacks which can read one-shot state like click, etc.
// - updating offsets by delta (popups do that),
// ... but it also means you can't re-translate something if you need to,
// so you can't implement a simple force_scroll() that would work inside the
// translate phase to re-scroll a scrollbox to sync it with a later one.

function translate_rec(a, x, y) {
	for (let i = 2, n = a.length; i < n; i = cmd_next_ext_i(a, i)) {
		let cmd = a[i-1]
		let translate_f = translate[cmd]
		if (!translate_f)
			continue
		translate_f(a, i, x, y)
	}
}

// registration phase --------------------------------------------------------

// walk the element tree in build order and call the register function for
// each element that has it (linear scan).

function register_rec(a, rec_i) {
	// popups left open at the end of this rec are closed by it ending, not
	// by a later popup, so put popups_stack and current_popups back here.
	let popups_stack_n = popups_stack.length
	let popups0 = current_popups
	for (let i = 2, n = a.length; i < n; i = cmd_next_i(a, i)) {
		let cmd = a[i-1]
		let register_f = register[cmd]
		if (!register_f)
			continue
		register_f(a, i, rec_i)
	}
	popups_stack.length = popups_stack_n
	current_popups = popups0
}

/* drawing phase -------------------------------------------------------------

Drawing phase is the only phase that can run on a remote machine on a received
and deserialized frame object, so ui.state(), ui.hit() state, ui.captured_id,
etc. don't work here. Drawing can keep local inter-frame state with
ui.render_state().

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
	let next_ext_i = cmd_next_ext_i(a, i)
	while (i < next_ext_i) {

		let cmd = a[i-1]
		if (cmd & 1) // container
			theme_stack.push(theme)
		else if (cmd == CMD_END)
			theme = theme_stack.pop()

		let draw_f = draw[cmd]
		if (draw_f && draw_f(a, i, recs)) {
			i = cmd_next_ext_i(a, i)
			if (cmd & 1) // container
				theme = theme_stack.pop()
		} else {
			i += a[i-2] // next_i
		}
	}
}

function draw_popups(popups, recs) {
	let prev_rec  = current_layer_rec
	let prev_ct_i = current_layer_ct_i
	for (let k = 0, n = popups.length; k < n; k += POPUPS_SLOTS) {
		reset_canvas()
		let rec_i = popups[k+POPUPS_REC_I]
		let i     = popups[k+POPUPS_CT_I]
		let a = recs[rec_i]
		/*global*/ current_layer_rec  = a
		/*global*/ current_layer_ct_i = i
		draw_cmd(a, i, recs)
		let inner_popups = popups[k+POPUPS_INNER]
		if (inner_popups)
			draw_popups(inner_popups, recs)
	}
	current_layer_rec  = prev_rec
	current_layer_ct_i = prev_ct_i
}

function draw_frame(recs, popups, sm1) {
	let sm0 = render_state_map
	render_state_map = assert(sm1)
	let current_layer_rec0  = current_layer_rec
	let current_layer_ct_i0 = current_layer_ct_i

	let theme_stack_length0 = theme_stack.length
	theme_stack.push(theme)
	theme = themes[ui.default_theme]

	draw_popups(popups, recs)
	assert(current_layer_rec  == current_layer_rec0)
	assert(current_layer_ct_i == current_layer_ct_i0)

	theme = theme_stack.pop()
	assert(theme_stack.length == theme_stack_length0)

	render_state_gc(render_state_map)
	render_state_map = sm0
}

// hit-testing phase ---------------------------------------------------------

let hit_state_map      = map() // {id->state}
let prev_hit_state_map = map() // {id->state}

ui._hit_state_map = hit_state_map

function hovers(id, k) {
	if (!id) return
	let s = hit_state_map.get(id)
	return k ? s?.[k] : s
}
ui.hovers = hovers

function hit(id, k) { // looks in prev. frame
	assert(!render_state_map, 'hit() called while rendering')
	if (ui.captured_id != null) // unavailable while captured
		return
	return hovers(id, k)
}
ui.hit = hit

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
	for (let [id] of hit_state_map)
		if (id.startsWith(prefix))
			return id.substring(prefix.length)
}
ui.hit_match = hit_match

function hover(id) {
	if (!id) return
	let s = hit_state_map.get(id)
	if (!s) {
		s = obj()
		hit_state_map.set(id, s)
	}
	return s
}
ui.hover = hover

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
		/*global*/ current_layer_rec  = a
		/*global*/ current_layer_ct_i = i
		let hit_f = hittest[a[i-1]]
		if (hit_f && !a.nohit_set?.has(i) && hit_f(a, i, recs))
			return true
	}
}

function hit_frame(recs, popups) {

	ui.set_cursor()

	hit_template_id = null
	hit_template_i0 = null

	hit_template_i1 = null
	hit_state_map.clear()

	if (ui.mx == null)
		return

	hit_popups(popups, recs)

}

// tab focusing --------------------------------------------------------------

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
	ui_cmd(FOCUSABLE, id, tab_order ?? 0)
	// calling scroll_to_view_next_box() here means that focusable() must be
	// called before the widget box is recorded.
	if (ui.focusing(id))
		ui.scroll_to_view_next_box()
}

// id is optional, only needed for tab_into().
ui.focus_group = function(trap, tab_order, id) {
	ui_cmd(FOCUS_GROUP, tab_order ?? 0, trap ? 1 : 0, id)
}

ui.end_focus_group = function() {
	ui_cmd(END_FOCUS_GROUP)
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
	let id = ui.keydown('enter')
		? focusables[group_i+FOCUSABLE_DEFAULT_BUTTON] : null
	if (id == null && ui.keydown('escape'))
		id = focusables[group_i+FOCUSABLE_CANCEL_BUTTON]
	if (id != null) {
		let focused_i = focus_find(ui.focused_id)
		if (focused_i != null && focus_group_of(focused_i) == group_i) {
			ui.fire(id, 'click')
			ui.capture_keys()
			animate()
		}
	}
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

// tab order is only known after register_rec puts the secondary recordings
// in their real order, so this records a request that resolves there.
ui.focus_first = function(group_id) {
	if (ui.focus_inside(group_id))
		return
	focus_first_id = group_id
}

// default button ------------------------------------------------------------

let GROUP_BUTTON = cmd('group_button')

ui.default_button = function(id) {
	ui_cmd(GROUP_BUTTON, id, FOCUSABLE_DEFAULT_BUTTON)
}

ui.cancel_button = function(id) {
	ui_cmd(GROUP_BUTTON, id, FOCUSABLE_CANCEL_BUTTON)
}

register[GROUP_BUTTON] = function(a, i) {
	let group_i = open_focus_groups.at(-1)
	assert(group_i != null,
		'default_button/cancel_button outside a focus group')
	let button_slot = a[i+1]
	focusables[group_i+button_slot] = a[i]
}

// tab capture ----------------------------------------------------------------

ui.capture_tab = function(id, back) {
	ui.state(id)[back ? 'capture_shift_tab' : 'capture_tab'] = true
}

function tab_captured(id) {
	return !!ui.state(id, ui.keypressed('shift') ? 'capture_shift_tab' : 'capture_tab')
}

let tab_into_id // focus group that the next tab must move into

ui.tab_into = function(id) {
	tab_into_id = id
}

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

// nohit command -------------------------------------------------------------

let NOHIT = cmd('nohit')
ui.nohit = function(ct_i) {
	ct_i ??= ui.ct_i()
	let i = ui_cmd(NOHIT, ct_i)
	a[i] -= i // make it relative
}

// doesn't have to happen on translate, any phase before hit-testing will do.
translate[NOHIT] = function(a, i) {
	let ct_i = i+a[i]
	if (!a.nohit_set)
		a.nohit_set = set()
	a.nohit_set.add(ct_i)
}

// frame packing -------------------------------------------------------------

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

// frame unpacking -----------------------------------------------------------

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

// p2p connection ------------------------------------------------------------




// measuring requests --------------------------------------------------------

const CMD_MEASURE = cmd('measure')

// measure current container after layouting and put it in ui.state(into_id).
ui.measure = function(into_id) {
	let i = ui_cmd(CMD_MEASURE, into_id, ui.ct_i())
	a[i+1] -= i // make ct_i relative
}

register[CMD_MEASURE] = function(a, i) {
	let ct_i = i+a[i+1]
	let s = ui.state(a[i+0])
	s.x = a[ct_i+0]
	s.y = a[ct_i+1]
	s.w = a[ct_i+2]
	s.h = a[ct_i+3]
}

// animation frame -----------------------------------------------------------

let want_relayout

// NOTE: this must only be called conditionally on a condition that is
// guaranteed to be false after relayout, or you risk a relayout loop, which
// itself is guarded against with a warning and refusal to relayout again.
ui.relayout = function() {
	want_relayout = true
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
	layer_stack_check()
	scope_stack_check()
	rec_stack_check()
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
	// relayout loop below.
	let sm = prev_hit_state_map
	prev_hit_state_map = hit_state_map
	hit_state_map = sm
	ui._hit_state_map = hit_state_map

	let relayout_count = 0
	while (1) {
		let t0, t1

		want_relayout = false

		t0 = clock_ms()

		hit_frame(recs, root_popups)

		if (ui.keydown('tab') && !tab_captured(ui.focused_id)) {
			let i = step_focus(ui.keypressed('shift'))
			if (i != null)
				ui.focus(focusables[i+FOCUSABLE_ID], true)
		}
		t1 = clock_ms()
		frame_graph_push('frame_hit_time', t1 - t0)

		reset_popups()
		free_recs()

		t0 = clock_ms()
		frame_make_ms = 0

		reset_canvas()

		begin_rec()
		let i = ui.stack()
		begin_layer(layer_base)
		assert(rec_i == 0)
		add_popup(root_popups, layer_base.paint_order * paint_order_band, rec_i, i, null)
		ui.main()
		reset_spacings()
		ui.end()
		end_layer()
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

		if (focus_first_id != null) {
			let group_id = focus_first_id
			focus_first_id = null
			if (resolve_focus_first(group_id))
				ui.relayout()
		}

		t1 = clock_ms()
		frame_graph_push('frame_make_time', make_ms + frame_make_ms)
		frame_graph_push('frame_layout_time', t1 - t0 - frame_make_ms)

		state_gc()

		if (!want_relayout) {
			t0 = clock_ms()

			cx.clearRect(0, 0, canvas.width, canvas.height)

			drawn_focused_input = null
			drawn_focused_by_key = false
			draw_frame(recs, root_popups, root_render_state_map)

			sync_dom_focus()
			sync_dom_selection()

			for (let p of ui.pointers)
				if (p != ui.local_pointer)
					draw_pointer(p, 0, 0)

			t1 = clock_ms()
			frame_graph_push('frame_draw_time', t1 - t0)

			ui.frame_changed()
		}

		reset_canvas()

		if (ui.clickup) {
			ui.captured_id = null
			capture_state = obj()
		}

		if (ui.click && !focus_taken) {
			ui.focused_id = null
			ui.relayout()
		}
		focus_taken = false

		for (let p of ui.pointers)
			reset_pointer_state(p)
		reset_pointer_state(ui)

		key_downs.clear()
		key_ups.clear()
		ui.key_events.length = 0

		for (let [k, es] of event_state)
			if (es[0] < frame_gen)
				event_state.delete(k)

		// updates can run again now that they can't see the same edge state.
		frame_gen++

		ui.window_focusing = false
		ui.window_unfocusing = false

		if (!want_relayout)
			break
		relayout_count++
		if (relayout_count > 2) {
			warn('relayout loop detected')
			break
		}
	}

	// a discarded pass must not clear it: the widget that resolve_focus_first()
	// focused is only built again on the pass after that.
	focusing_id = null
}

// widget API ----------------------------------------------------------------

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
	let create = t.create
	if (create) {
		// bind() to avoid `...args` which allocates.
		let bound_create = create.bind(null, _cmd)
		ui[cmd_name] = bound_create
		let setstate = t.setstate
		if (setstate)
			ui[cmd_name+'_state'] = setstate.bind(null, _cmd)
		return bound_create
	} else {
		return _cmd
	}
}

// box widgets ---------------------------------------------------------------

// a box has min_w, min_h, margin, padding, align, valign, and also `fr`
// if it's is_flex_child. a box can also be a container.
// it's x,y,w,h are calculated by the layouting system using the above.

const PX1        =  4
const PX2        =  6
const MX1        =  8
const MX2        = 10

const FR         = 12 // all `is_flex_child` widgets: fraction from main-axis size.
const ALIGN      = 13 // vert. align at ALIGN+1
const BOX_CT_NEXT_EXT_I = 15 // all container-boxes: next command after this one's END command.
const BOX_CT_ARGS = 16 // first index after the ui_cmd_box_ct header.
const BOX_ARGS    = 16 // first index after the ui_cmd_box header.

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

ui.rem = rem => round((rem ?? 1) * ui.font_size_normal)
ui. em =  em => round((em  ?? 1) * font_size)

let em  = ui.em
let rem = ui.rem
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
ui.padding_horiz  = function(p) { px1 = p; px2 = p }; ui.ph = ui.padding_horiz
ui.padding_vert   = function(p) { py1 = p; py2 = p }; ui.pv = ui.padding_vert

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
ui.margin_horiz  = function(p) { mx1 = p; mx2 = p }; ui.mh = ui.margin_horiz
ui.margin_vert   = function(p) { my1 = p; my2 = p }; ui.mv = ui.margin_vert

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

// box command

// set by ui.scroll_to_view_next_box() to indicate that the next box needs
// to be revealed by its scrollbox(es).
let scroll_to_view_next

function ui_cmd_box(cmd, fr, align, valign, min_w, min_h, ...args) {
	tui_snap_paddings()
	let i = ui_cmd(cmd,
		min_w ?? 0, // user min_w in measuring phase; x in positioning phase
		min_h ?? 0, // user min_h in measuring phase; y in positioning phase
		0, // children's min_w -> min_w in measuring phase; w in positioning phase
		0, // children's min_h -> min_h in measuring phase; h in positioning phase
		px1, py1, px2, py2,
		mx1, my1, mx2, my2,
		round(max(0, fr ?? 1) * 1024),
		parse_align  (align  ?? 's'),
		parse_valign (valign ?? 's'),
		// hack for ui_cmd_box_ct() to be able to call ui_cmd_box() with
		// `arguments`. 2 extra bytes in json for each box for this.
		0, // next_ext_i
		...args
	)
	reset_spacings()
	if (scroll_to_view_next) {
		scroll_to_view_next = false
		let j = ui_cmd(CMD_SCROLL_TO_VIEW, i)
		a[j+0] -= j // make the requested box index relative
	}
	return i
}
ui.cmd_box = ui_cmd_box

// box measure phase

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

// box position phase

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

// box translate phase

function box_translate(a, i, dx, dy) {
	a[i+0] += dx
	a[i+1] += dy
}
ui.box_translate = box_translate

// box hit phase

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
	function box_hit(a, i) {
		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]
		let id = a[i+ID]
		if (hit_rect(x, y, w, h)) {
			hover(id)
			return true
		}
	}
	return ui.widget(cmd_name, {
		measure   : box_measure   ,
		position  : box_position  ,
		translate : box_translate ,
		hit       : ID != null && box_hit,
		is_flex_child: true,
		...t,
	}, is_ct)
}

// container-box widgets -----------------------------------------------------

function cmd_next_ext_i(a, i) {
	let cmd = a[i-1]
	if (cmd & 1) // container
		return i+a[i+BOX_CT_NEXT_EXT_I]
	return cmd_next_i(a, i)
}

// NOTE: `ct` is short for container, which must end with ui.end().
function ui_cmd_box_ct(cmd, fr, align, valign, min_w, min_h) {
	begin_scope()
	let i = ui_cmd_box.apply(null, arguments)
	ct_stack.push(i)
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
	end_scope()
	assert(!scroll_to_view_next, 'focusable widget recorded no box')
	let i = assert(ct_stack.pop(), 'end command outside container')
	if (cmd && a[i-1] != cmd)
		assert(false, 'closing ', cmd_names[cmd], ' instead of ', C(a, i))
	let end_i = ui_cmd(CMD_END, i)
	a[end_i+0] -= end_i // make relative
	let next_i = cmd_next_i(a, end_i)
	a[i+BOX_CT_NEXT_EXT_I] = next_i-i // next_i but relative to the ct cmd at i

	if (a[i-1] == CMD_POPUP) { // TOOD: make this non-specific
		end_layer()
	}
}

measure[CMD_END] = function(a, _, axis) {
	let i = assert(ct_stack.pop(), 'end command outside a container')
	let cmd = a[i-1]
	let measure_end_f = measure_end[cmd]
	if (measure_end_f) {
		measure_end_f(a, i, axis)
	} else {
		let main_axis = is_main_axis(cmd, axis)
		let user_min_w = a[i+0+axis]
		let min_w      = a[i+2+axis]
		if (main_axis)
			min_w = max(0, min_w - a[i+FLEX_GAP]) // remove last element's gap
		min_w = max(min_w, user_min_w) + spacings(a, i, axis)
		a[i+2+axis] = min_w
		add_ct_min_wh(a, axis, min_w)
	}
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

		i = cmd_next_ext_i(a, i)
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
		i = cmd_next_ext_i(a, i)
	}
}

function translate_ct(a, i, dx, dy) {
	a[i+0] += dx
	a[i+1] += dy
	translate_children(a, i, dx, dy)
}

// hit phase utils

function hit_children(a, i, recs) {

	// hit direct children in reverse paint order.
	let ct_i = i
	let next_ext_i = cmd_next_ext_i(a, i)
	let end_i = cmd_prev_i(a, next_ext_i)
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
		hover(id)
		return true
	}
	if (hit_box(a, i)) {
		hover(id)
		hit_template(a, i)
	}
}

// flex ----------------------------------------------------------------------

const FLEX_GAP = BOX_CT_ARGS+0

function ui_hv(cmd, fr, gap, align, valign, min_w, min_h) {
	return ui_cmd_box_ct(cmd, fr, align, valign, min_w, min_h,
		gap ?? 0,
	)
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
		(cmd == CMD_V ? 1 : 2) == axis ||
		(cmd == CMD_H ? 0 : 2) == axis
	)
}

measure[CMD_H] = ct_stack_push
measure[CMD_V] = ct_stack_push

function is_last_flex_child(a, i) {
	while (1) {
		i = cmd_next_ext_i(a, i)
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
				total_fr += a[i+FR] / 1024
				n++
			}
			i = cmd_next_ext_i(a, i)
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
				let fr    = a[i+FR] / 1024

				let flex_w = total_w * fr / total_fr
				let overflow_w = max(0, min_w - flex_w)
				let free_w = max(0, flex_w - min_w)
				total_overflow_w += overflow_w
				total_free_w     += free_w

			}
			i = cmd_next_ext_i(a, i)
		}

		// distribute the overflow to children which have free space to
		// take it. each child shrinks to take in the percent of the overflow
		// equal to the child's percent of free space.
		i = next_i
		let ct_sx = sx
		let ct_sw = sw
		while (a[i-1] != CMD_END) {
			if (is_flex_child[a[i-1]]) {

				let min_w = a[i+2+axis]
				let fr    = a[i+FR] / 1024

				// compute item's stretched width.
				let flex_w = total_w * fr / total_fr
				let sw
				if (min_w > flex_w) { // overflow
					sw = min_w
				} else {
					let free_w = flex_w - min_w
					let free_p = free_w / total_free_w
					let shrink_w = total_overflow_w * free_p
					if (shrink_w != shrink_w) // total_free_w == 0
						shrink_w = 0
					sw = floor(flex_w - shrink_w)
				}


				// let the last child eat up any rounding errors.
				if (is_last_flex_child(a, i))
					sw = ct_sw - (sx - ct_sx)

				// position item's children recursively.
				let position_f = position[a[i-1]]
				position_f(a, i, axis, sx, sw)

				sx += sw + gap

			} else {

				let position_f = position[a[i-1]]
				if (position_f)
					position_f(a, i, axis, ct_sx, ct_sw)
			}

			i = cmd_next_ext_i(a, i)
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

// stack ---------------------------------------------------------------------

const STACK_ID = BOX_CT_ARGS+0

const CMD_STACK = cmd_ct('stack')

ui.stack = function(id, fr, align, valign, min_w, min_h) {
	return ui_cmd_box_ct(CMD_STACK, fr, align, valign, min_w, min_h,
		id || '')
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

/*
// clip ----------------------------------------------------------------------

const CMD_CLIP     = cmd('clip')
const CMD_END_CLIP = cmd('end_clip')

const CMD_CLIP_CT_I = 0

ui.clip     = function() { return ui_cmd(CMD_CLIP, ui.ct_i()) }
ui.end_clip = function() { return ui_cmd(CMD_END_CLIP) }

draw[CMD_CLIP] = function(a, i) {
	let ct_i = a[i+CMD_CLIP_CT_I]
	let x = a[ct_i+0]
	let y = a[ct_i+1]
	let w = a[ct_i+2]
	let h = a[ct_i+3]
	cx.save()
	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.clip()
}

draw[CMD_END_CLIP] = function() {
	cx.restore()
}
*/

// scrollbox -----------------------------------------------------------------

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

ui.scrollbox = function(
	id, fr, overflow_x, overflow_y, align, valign,
	min_w, min_h, sx, sy, x_id, y_id
) {

	overflow_x = parse_sb_overflow(overflow_x)
	overflow_y = parse_sb_overflow(overflow_y)

	assert(id, 'id required for scrollbox')

	keepalive(id)
	if (x_id) keepalive(x_id)
	if (y_id) keepalive(y_id)
	let xstate = ui.state(x_id ?? id)
	let ystate = ui.state(y_id ?? id)
	if (sx != null) xstate.scroll_x = sx
	if (sy != null) ystate.scroll_y = sy

	let i = ui_cmd_box_ct(CMD_SCROLLBOX, fr, align, valign, min_w, min_h,
		overflow_x,
		overflow_y,
		0, 0, // content w, h
		id,
		0, 0, // computed scroll x, y
		0, // state
		x_id,
		y_id,
	)

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
	let max_sx = -(x + w - pw)
	let max_sy = -(y + h - ph)
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
	let box = ui.state(id, 'scroll_to_view')
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
	if (j > i && j < i + a[i+BOX_CT_NEXT_EXT_I]) {
		let bx = a[j+0] - a[i+0] // marked box coords, relative to the contents
		let by = a[j+1] - a[i+1]
		;[sx, sy] = scroll_offsets_to_view_rect(
			bx, by, a[j+2], a[j+3], w, h, sx, sy)
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

		// wheel scrolling
		if (axis && ui.wheel_dy && hit(id) && (visible || y_id)) {
			sy = sy + ui.wheel_dy
			if (!infinite_y)
				sy = max(0, min(sy, ch - h))
			ystate.scroll_y = sy
		}
		if (!visible)
			continue

		// drag-scrolling
		let sbar_id = id+'.scrollbar'+axis
		let cs = captured(sbar_id)
		let hs
		if (cs) {
			if (!axis) {
				let psx0 = cs.psx0
				let dpsx = (ui.mx - ui.mx0) / (w - tw)
				sx = round((psx0 + dpsx) * (cw - w))
				if (!infinite_x)
					sx = max(0, min(sx, cw - w))
				xstate.scroll_x = sx
			} else {
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
			let cs = ui.capture(sbar_id)
			if (cs)
				if (!axis)
					cs.psx0 = psx
				else
					cs.psy0 = psy
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
	let sx = ui.state(x_id, 'scroll_x') ?? 0
	let sy = ui.state(y_id, 'scroll_y') ?? 0

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

ui.scrollbar_thickness = 6
ui.scrollbar_thickness_active = 12

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
	let thickness = ui.scrollbar_thickness
	let thickness_active = state ? ui.scrollbar_thickness_active : thickness
	let visible, tx, ty, tw, th
	let h_visible = pw < 1
		&& (overflow_x == SB_OVERFLOW_SCROLL || overflow_x == SB_OVERFLOW_AUTO)
	let v_visible = ph < 1
		&& (overflow_y == SB_OVERFLOW_SCROLL || overflow_y == SB_OVERFLOW_AUTO)
	let both_visible = h_visible && v_visible && 1 || 0
	let bar_min_len = round(2 * ui.font_size_normal)
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
		cx.fillStyle = bg_color('scrollbar', state)
		cx.fill()

	}
}

hittest[CMD_SCROLLBOX] = function(a, i, recs) {
	let id = a[i+SB_ID]

	// fast-test the outer box since we're clipping the contents.
	if (!hit_box(a, i))
		return

	hover(id)

	hit_template(a, i)

	// test the scrollbars
	for (let axis = 0; axis < 2; axis++) {
		let [visible, tx, ty, tw, th] = scrollbar_rect(a, i, axis, 'hover')
		if (!visible)
			continue
		if (!hit_rect(tx, ty, tw, th))
			continue
		hover(id+'.scrollbar'+axis)
		return true
	}

	// test the children
	hit_children(a, i, recs)

	return true
}

// popup ---------------------------------------------------------------------

const POPUP_SIDE_CENTER       = 0 // only POPUP_SIDE_INNER_CENTER is valid!
const POPUP_SIDE_LR           = 2
const POPUP_SIDE_TB           = 4
const POPUP_SIDE_INNER        = 8
const POPUP_SIDE_LEFT         = POPUP_SIDE_LR + 0
const POPUP_SIDE_RIGHT        = POPUP_SIDE_LR + 1
const POPUP_SIDE_TOP          = POPUP_SIDE_TB + 0
const POPUP_SIDE_BOTTOM       = POPUP_SIDE_TB + 1
const POPUP_SIDE_INNER_CENTER = POPUP_SIDE_INNER + POPUP_SIDE_CENTER
const POPUP_SIDE_INNER_LEFT   = POPUP_SIDE_INNER + POPUP_SIDE_LEFT
const POPUP_SIDE_INNER_RIGHT  = POPUP_SIDE_INNER + POPUP_SIDE_RIGHT
const POPUP_SIDE_INNER_TOP    = POPUP_SIDE_INNER + POPUP_SIDE_TOP
const POPUP_SIDE_INNER_BOTTOM = POPUP_SIDE_INNER + POPUP_SIDE_BOTTOM

const POPUP_ALIGN_CENTER  = 0
const POPUP_ALIGN_START   = 1
const POPUP_ALIGN_END     = 2
const POPUP_ALIGN_STRETCH = 3

function popup_parse_side(s) {
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
	if (s == 'c'      ) return POPUP_ALIGN_CENTER
	if (s == '['      ) return POPUP_ALIGN_START
	if (s == ']'      ) return POPUP_ALIGN_END
	if (s == '[]'     ) return POPUP_ALIGN_STRETCH
	if (s == 's'      ) return POPUP_ALIGN_STRETCH
	if (s == 'center' ) return POPUP_ALIGN_CENTER
	if (s == 'start'  ) return POPUP_ALIGN_START
	if (s == 'end'    ) return POPUP_ALIGN_END
	if (s == 'stretch') return POPUP_ALIGN_STRETCH
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

const POPUP_ID        = FR      // because fr is not used
const POPUP_SIDE      = ALIGN   // because align is not used
const POPUP_ALIGN     = ALIGN+1 // because valign is not used
const POPUP_LAYER_I   = BOX_CT_ARGS+0
const POPUP_Z_INDEX   = BOX_CT_ARGS+1
const POPUP_TARGET_I  = BOX_CT_ARGS+2
const POPUP_FLAGS     = BOX_CT_ARGS+3
const POPUP_SIDE_REAL = BOX_CT_ARGS+4
const POPUP_OX        = BOX_CT_ARGS+5 // offset x,y from where side+align put it

const CMD_POPUP = cmd_ct('popup')

// ox, oy shift the popup from where side and align put it, in screen
// direction. margins stay a gap between the popup and its target.
ui.popup = function(
	id, layer, target, side, align, min_w, min_h, flags, z_index, ox, oy
) {
	layer = ui_layer(layer)
	let target_i = target == 'screen' ? 0
		: !target || target == 'container' ? ui.ct_i()
		: assert(num(target), 'invalid target ', target)
	side  = popup_parse_side  (side  ?? 't')
	align = popup_parse_align (align ?? 'c')
	flags = popup_parse_flags (flags ?? '')

	let i = ui_cmd_box_ct(CMD_POPUP,
		null, // fr -> id
		null, // align -> side
		null, // valign -> align
		min_w, min_h,
		// BOX_ARGS+0
		layer.i, z_index ?? 0,
		target_i, flags,
		side, // side_real
		ox ?? 0, oy ?? 0,
	)
	if (target_i)
		a[i+POPUP_TARGET_I] -= i // make relative
	a[i+POPUP_ID   ] = id
	a[i+POPUP_SIDE ] = side
	a[i+POPUP_ALIGN] = align
	begin_layer(layer)
	force_scope_vars()
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

	// stretched popups stretch to the dimensions of their target.
	let target_i = a[i+POPUP_TARGET_I]
	let side     = a[i+POPUP_SIDE]
	let align    = a[i+POPUP_ALIGN]
	if (target_i) target_i += i // make absolute
	if (side && align == POPUP_ALIGN_STRETCH) {
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

let x, y
function position_popup(w, h, side, align) {

	let tw = tx2 - tx1
	let th = ty2 - ty1

	if (side == POPUP_SIDE_RIGHT) {
		x = tx2
		y = ty1
	} else if (side == POPUP_SIDE_LEFT) {
		x = tx1 - w
		y = ty1
	} else if (side == POPUP_SIDE_TOP) {
		x = tx1
		y = ty1 - h
	} else if (side == POPUP_SIDE_BOTTOM) {
		x = tx1
		y = ty2
	} else if (side == POPUP_SIDE_INNER_RIGHT) {
		x = tx2 - w
		y = ty1
	} else if (side == POPUP_SIDE_INNER_LEFT) {
		x = tx1
		y = ty1
	} else if (side == POPUP_SIDE_INNER_TOP) {
		x = tx1
		y = ty1
	} else if (side == POPUP_SIDE_INNER_BOTTOM) {
		x = tx1
		y = ty2 - h
	} else if (side == POPUP_SIDE_INNER_CENTER) {
		x = tx1 + round((tw - w) / 2)
		y = ty1 + round((th - h) / 2)
	} else {
		assert(false)
	}

	let sdx = side & POPUP_SIDE_LR
	let sdy = side & POPUP_SIDE_TB

	if (align == POPUP_ALIGN_CENTER && sdy)
		x += round((tw - w) / 2)
	else if (align == POPUP_ALIGN_CENTER && sdx)
		y += round((th - h) / 2)
	else if (align == POPUP_ALIGN_END && sdy)
		x += tw - w
	else if (align == POPUP_ALIGN_END && sdx)
		y += th - h

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
		// or alignment and relayout, and if that doesn't work, its offset.

		let d = screen_margin
		let out_x1 = x < d
		let out_y1 = y < d
		let out_x2 = x + w > (bw - d)
		let out_y2 = y + h > (bh - d)

		let side0 = side
		if (side == POPUP_SIDE_BOTTOM && out_y2)
			side = POPUP_SIDE_TOP
		 else if (side == POPUP_SIDE_TOP && out_y1)
			side = POPUP_SIDE_BOTTOM
		 else if (side == POPUP_SIDE_RIGHT && out_x2)
			side = POPUP_SIDE_LEFT
		 else if (side == POPUP_SIDE_LEFT && out_x1)
			side = POPUP_SIDE_RIGHT

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

register[CMD_POPUP] = function(a, i, rec_i) {
	// put back the current_popups of every popup whose END this one is past.
	// entries from another rec belong to the scan that pushed them.
	let n = popups_stack.length
	while (n && popups_stack[n-1] == a && i >= popups_stack[n-2]) {
		current_popups = popups_stack[n-3]
		n -= 3
	}
	popups_stack.length = n
	let layer = layer_arr[a[i+POPUP_LAYER_I]]
	let z_index = a[i+POPUP_Z_INDEX]
	assert(z_index >= 0 && z_index < paint_order_band,
		'z_index out of range: ', z_index)
	let inner_popups = layer.modal ? popups_freelist.alloc() : null
	add_popup(layer.root ? root_popups : current_popups,
		layer.paint_order * paint_order_band + z_index,
		rec_i, i, inner_popups)
	if (inner_popups) {
		popups_stack.push(current_popups, i+a[i+BOX_CT_NEXT_EXT_I], a)
		current_popups = inner_popups
	}
}

draw[CMD_POPUP] = function(a, i) {
	if (a != current_layer_rec || i != current_layer_ct_i)
		return true
}

hittest[CMD_POPUP] = function(a, i, recs) {
	if (a != current_layer_rec || i != current_layer_ct_i)
		return
	let solid = a[i+POPUP_FLAGS] & POPUP_SOLID
	if (hit_children(a, i, recs)) {
		hover(a[i+POPUP_ID])
		if (solid && ui.click)
			focus_taken = true
		return true
	}
	if (solid && hit_box(a, i)) {
		hover(a[i+POPUP_ID])
		if (ui.click)
			focus_taken = true
		return true
	}
}

// tooltip background & border -----------------------------------------------

function tooltip_tip_cut_center(x1, x2, align, r, d) {
	if (align == POPUP_ALIGN_START)
		return x1+r + d/2
	else if (align == POPUP_ALIGN_END)
		return x2-r - d/2
	else if (align == POPUP_ALIGN_CENTER)
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
	return ui_cmd(CMD_BB_TOOLTIP, rel_ct_i, bg_color ?? 0, parse_state(bg_color_state),
		border_color ?? 0, parse_state(border_color_state),
		round((border_radius ?? 0) * 128),
	)
}

cx.fillStyle = bg_color

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

	let side  = a[ct_i+POPUP_SIDE_REAL]
	let align = a[ct_i+POPUP_ALIGN]

	let T = POPUP_SIDE_TOP
	let B = POPUP_SIDE_BOTTOM
	let L = POPUP_SIDE_LEFT
	let R = POPUP_SIDE_RIGHT
	let S = POPUP_ALIGN_START
	let E = POPUP_ALIGN_END

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
	} else if (align == POPUP_ALIGN_CENTER) {
		if (side & POPUP_SIDE_TB) {
			tx = tx1 + (tx2 - tx1) / 2
			ty = side == T ? ty1 : ty2
		} else {
			ty = ty1 + (ty2 - ty1) / 2
			tx = side == L ? tx1 : tx2
		}
	}

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

	if (bg_color) {
		set_bg_color(bg_color, bg_color_state)
		tooltip_path(cx, x, y, x + w, y + h,
			side, tx, ty, b1x, b1y, b2x, b2y, r, d)
		cx.fill()
	}
	if (shadow_set)
		reset_shadow()
	if (border_color) {
		cx.strokeStyle = ui_border_color(border_color, border_color_state)
		cx.lineCap = 'square'
		tooltip_path(cx, x + .5, y + .5, x + w - .5, y + h - .5,
			side, tx, ty, b1x, b1y, b2x, b2y, r, d)
		cx.stroke()
		cx.lineCap = 'butt'
	}

}

// box shadow ----------------------------------------------------------------

ui.shadow_style = function(theme, name, x, y, blur, spread, inset, h, s, L, a) {
	themes[theme].shadow[name] = [x, y, blur, spread, inset, hsl(h, s, L, a), h, s, L, a]
}

//               theme    name        x   y  bl sp  inset  h  s  L  a
// ----------------------------------------------------------------------------------
ui.shadow_style('light', 'tooltip' ,  2,  2,  9, 0, false, 0, 0, 0, 0x44 / 0xff)
ui.shadow_style('light', 'toolbox' ,  1,  1,  4, 0, false, 0, 0, 0, 0xaa / 0xff)
ui.shadow_style('light', 'menu'    ,  0,  5, 16, 0, false, 0, 0, 0, 0x33 / 0xff)
ui.shadow_style('light', 'button'  ,  0,  0,  2, 0, false, 0, 0, 0, 0x11 / 0xff)
ui.shadow_style('light', 'thumb'   ,  0,  0,  2, 0, false, 0, 0, 0, 0xbb / 0xff)
ui.shadow_style('light', 'modal'   ,  2,  5, 10, 0, false, 0, 0, 0, 0x88 / 0xff)
ui.shadow_style('light', 'picker'  ,  0,  5, 10, 1, false, 0, 0, 0, 0x22 / 0xff) // large fuzzy shadow

ui.shadow_style('dark', 'tooltip' ,  2,  2,  9, 0, false, 0, 0, 0, 0x44 / 0xff)
ui.shadow_style('dark', 'toolbox' ,  1,  1,  4, 0, false, 0, 0, 0, 0xaa / 0xff)
ui.shadow_style('dark', 'menu'    ,  1,  1,  9, 0, false, 0, 0, 0, 0xff / 0xff)
ui.shadow_style('dark', 'button'  ,  0,  0,  2, 0, false, 0, 0, 0, 0xff / 0xff)
ui.shadow_style('dark', 'thumb'   ,  1,  1,  2, 0, false, 0, 0, 0, 0xaa / 0xff)
ui.shadow_style('dark', 'modal'   ,  2,  5, 10, 0, false, 0, 0, 0, 0x88 / 0xff)
ui.shadow_style('dark', 'picker'  ,  0,  2, 15, 1, false, 0, 0, 0, .8)

const CMD_SHADOW = cmd('shadow')

ui.shadow = function(x, y, blur, spread, inset, color) {
	if (isstr(x))
		x = assert(theme.shadow[x])
	if (isarray(x))
		[x, y, blur, spread, inset, color] = x
	ui_cmd(CMD_SHADOW, x, y, blur, spread, inset ? 1 : 0, color)
}

let shadow_set

// TODO: use spread & inset
ui.set_shadow = function(s) {
	let [x, y, blur, spread, inset, color] = assert(theme.shadow[s], 'unknown shadow ', s)
	cx.shadowBlur    = blur
	cx.shadowOffsetX = x
	cx.shadowOffsetY = y
	cx.shadowColor   = color
	shadow_set = true
}

draw[CMD_SHADOW] = function(a, i) {
	cx.shadowOffsetX = a[i+0]
	cx.shadowOffsetY = a[i+1]
	cx.shadowBlur    = a[i+2]
	// TODO: use a[i+3] spread
	// TODO: use a[i+4] inset
	cx.shadowColor   = a[i+5]
	shadow_set = true
}

function reset_shadow() {
	cx.shadowBlur    = 0
	cx.shadowOffsetX = 0
	cx.shadowOffsetY = 0
	shadow_set = false
}

// background & border -------------------------------------------------------

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
	ui_cmd(CMD_BB, ui.rel_ct_i(), bg_color ?? 0, parse_state(bg_color_state),
		parse_border_sides(border_sides), border_color ?? 0, parse_state(border_color_state),
		round((border_radius ?? 0) * 128),
		border_dash ?? null,
	)
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
	}
	if (shadow_set)
		reset_shadow()
	if (border_sides && border_color) {
		cx.strokeStyle = ui_border_color(border_color, border_color_state)
		cx.lineCap = 'square'
		border_path(cx, x + .5, y + .5, x + w - .5, y + h - .5, border_sides, border_radius)
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

// text state ----------------------------------------------------------------

const CMD_COLOR = cmd('color')

function force_color(s, state) {
	if (color != s)
		scope_set('color', s)
	if (color_state != state)
		scope_set('color_state', state)
	ui_cmd(CMD_COLOR, s, state)
	color = s
	color_state = state
}
ui.color = function(s, state) {
	state = state ?? 0
	if (color == s && color_state == state) return
	force_color(s, state)
}
function end_color(ended_scope) {
	let s     = scope_prev_diff_var(ended_scope, 'color')
	let state = scope_prev_diff_var(ended_scope, 'color_state')
	if (s === undefined && state === undefined) return
	if (s !== undefined) color = s; else s = color
	if (state !== undefined) color_state = state; else state = color_state
	ui_cmd(CMD_COLOR, s, state)
}

const CMD_FONT = cmd('font')

function force_font(s) {
	scope_set('font', s)
	ui_cmd(CMD_FONT, s)
	font = s
}
function end_font(ended_scope) {
	let s = scope_prev_diff_var(ended_scope, 'font')
	if (s === undefined) return
	ui_cmd(CMD_FONT, s)
	font = s
}
// ui.font() looks this up first; a name that's not in here is used as-is.
let font_aliases = obj()

ui.font_alias = function(alias, font) {
	font_aliases[alias] = font
}

ui.font = function(s) {
	s = font_aliases[s] ?? s
	if (font == s) return
	force_font(s)
}

// text is a codepoint, or the icon's name for a font that ligates names:
// material icons ligates, tabler and font awesome don't.
let icons = obj() // {name -> [font, text]}

ui.icon_def = function(name, font, text) {
	icons[name] = [font, text]
}

ui.icon = function(id, name, fr, align, valign, max_w, w, h) {
	let [font, text] = assert(icons[name], 'unknown icon ', name)
	ui.scope()
	ui.font(font)
	ui.text(id, text, fr, align, valign, max_w, w, h)
	ui.end_scope()
}

/* default font & icon aliases -----------------------------------------------

Widgets never name a font or a codepoint directly, they go through these.
Loading a different icon font means redefining the names below (each one
names its own font, not the `icon` alias, so they don't follow it).

*/

ui.icon_def('plus'       , 'tabler', '\ueb0b')
ui.icon_def('caret_right', 'tabler', '\ueb5f')

ui.xsmall  = function() { ui.font_size(.72   ) }
ui.small   = function() { ui.font_size(.8125 ) }
ui.smaller = function() { ui.font_size(.875  ) }
ui.large   = function() { ui.font_size(1.125 ) }
ui.xlarge  = function() { ui.font_size(1.5   ) }

const CMD_FONT_SIZE = cmd('font_size')

function force_font_size(s) {
	scope_set('font_size', s)
	ui_cmd(CMD_FONT_SIZE, s)
	font_size = s
}
function end_font_size(ended_scope) {
	let s = scope_prev_diff_var(ended_scope, 'font_size')
	if (s === undefined) return
	ui_cmd(CMD_FONT_SIZE, s)
	font_size = s
}
ui.font_size = function(x) {
	if (ui.font_size_normal * font_size == x) return
	force_font_size(ui.font_size_normal * x)
}
ui.fs = ui.font_size

const CMD_FONT_WEIGHT = cmd('font_weight')

function force_font_weight(s) {
	scope_set('font_weight', s)
	ui_cmd(CMD_FONT_WEIGHT, s)
	font_weight = s
}
function end_font_weight(ended_scope) {
	let s = scope_prev_diff_var(ended_scope, 'font_weight')
	if (s === undefined) return
	ui_cmd(CMD_FONT_WEIGHT, s)
	font_weight = s
}
ui.font_weight = function(s) {
	if (font_weight == s) return
	force_font_weight(s)
}
ui.bold   = function() { ui.font_weight('bold') }
ui.nobold = function() { ui.font_weight('normal') }

const CMD_LINE_GAP = cmd('line_gap')

function force_line_gap(s) {
	scope_set('line_gap', s)
	ui_cmd(CMD_LINE_GAP, round(s * 1024))
	line_gap = s
}
function end_line_gap(ended_scope) {
	let s = scope_prev_diff_var(ended_scope, 'line_gap')
	if (s === undefined) return
	ui_cmd(CMD_LINE_GAP, round(s * 1024))
	line_gap = s
}
ui.line_gap = function(s) {
	if (line_gap == s) return
	force_line_gap(s)
}
ui.lg = ui.line_gap

let last_font_str
function set_font(a, i) {
	font = a[i]
	let s = font_weight + ' ' + font_size + 'px ' + font
	if (s == last_font_str) return
	last_font_str = s
	cx.font = s
}

function set_font_size(a, i) {
	font_size = a[i]
	let s = font_weight + ' ' + font_size + 'px ' + font
	if (s == last_font_str) return
	last_font_str = s
	cx.font = s
}

function set_font_weight(a, i) {
	font_weight = a[i]
	let s = font_weight + ' ' + font_size + 'px ' + font
	if (s == last_font_str) return
	last_font_str = s
	cx.font = s
}

function set_line_gap(a, i) {
	line_gap = a[i] / 1024
}

measure[CMD_FONT] = set_font
measure[CMD_FONT_SIZE] = set_font_size
measure[CMD_FONT_WEIGHT] = set_font_weight
measure[CMD_LINE_GAP] = set_line_gap

draw[CMD_COLOR] = function(a, i) {
	color       = a[i+0]
	color_state = a[i+1]
}
draw[CMD_FONT] = set_font
draw[CMD_FONT_SIZE] = set_font_size
draw[CMD_FONT_WEIGHT] = set_font_weight
draw[CMD_LINE_GAP] = set_line_gap

function force_scope_vars() {
	force_color(color, color_state)
	force_font(font)
	force_font_size(font_size)
	force_font_weight(font_weight)
	force_line_gap(line_gap)
}

// text box ------------------------------------------------------------------

const TEXT_ASC        = BOX_ARGS+0
const TEXT_DSC        = BOX_ARGS+1
const TEXT_X          = BOX_ARGS+2
const TEXT_W          = BOX_ARGS+3
const TEXT_H          = BOX_ARGS+4
const TEXT_ID         = BOX_ARGS+5
const TEXT_S          = BOX_ARGS+6
const TEXT_FLAGS      = BOX_ARGS+7
const TEXT_INPUT_TYPE = BOX_ARGS+8
// only present when TEXT_MARKED is set, see mark_text().
const TEXT_MARK_I1    = BOX_ARGS+9
const TEXT_MARK_I2    = BOX_ARGS+10
const TEXT_MARK_BG    = BOX_ARGS+11

// TEXT_FLAGS
const TEXT_WRAP           =  3 // bits 0 and 1
const TEXT_WRAP_LINE      =  1 // bit 1
const TEXT_WRAP_WORD      =  2 // bit 2
const TEXT_EDITABLE       =  4 // bit 3
const TEXT_FOCUSED        =  8 // bit 4
const TEXT_FOCUSED_BY_KEY = 16 // bit 5
const TEXT_MARKED         = 32 // bit 6

const CMD_TEXT = cmd('text')

// draw a background behind [i1, i2) of the next text, to show a match or a
// selection. bg defaults to the `search` background style.
let mark_i1, mark_i2, mark_bg
ui.mark_text = function(i1, i2, bg) {
	mark_i1 = i1
	mark_i2 = i2
	mark_bg = bg
}

ui.text = function(
	id, s, fr, align, valign, max_w, w, h, wrap, editable, input_type
) {
	// NOTE: w and h default to measured text size.
	s = s ?? ''
	wrap = wrap == 'line' ? TEXT_WRAP_LINE : wrap == 'word' ? TEXT_WRAP_WORD : 0
	if (wrap == TEXT_WRAP_LINE) {
 		if (s.includes('\n'))
			s = s.split('\n')
	} else if (wrap == TEXT_WRAP_WORD) {
		keepalive(id)
		s = word_wrapper(id, s)
	}
	if (editable) {
		keepalive(id)
		ui.focusable(id)
		// so that text_selection() works before the user types any text.
		s = ui.state(id).text ??= s
	}
	let marked = mark_i1 != null && mark_i2 > mark_i1
	let i = ui_cmd_box(CMD_TEXT, fr ?? 1, align ?? 'l', valign ?? 'c',
		w ?? -1, // -1=auto
		h ?? -1, // -1=auto
		0, // ascent
		0, // descent
		0, // text_x
		max_w ?? -1, // -1=inf
		0, // text_h
		id,
		s,
		wrap // flags
			| (editable ? TEXT_EDITABLE : 0)
			| (ui.focused(id) ? TEXT_FOCUSED : 0)
			| (ui.focused(id) && ui.focused_by_key ? TEXT_FOCUSED_BY_KEY : 0)
			| (marked ? TEXT_MARKED : 0),
		input_type,
	)
	if (marked)
		ui_cmd_add_args(i, mark_i1, mark_i2, mark_bg ?? 'search')
	mark_i1 = null

	return s
}
ui.text_editable = function(id, s, fr, align, valign, max_w, w, h, input_type) {
	return ui.text(id, s, fr, align, valign, max_w, w, h, null, true, input_type)
}
ui.text_lines = function(id, s, fr, align, valign, max_w, w, h, editable) {
	return ui.text(id, s, fr, align, valign, max_w, w, h, 'line', editable)
}
ui.text_wrapped = function(id, s, fr, align, valign, max_w, w, h, editable) {
	return ui.text(id, s, fr, align, valign, max_w, w, h, 'word', editable)
}

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
	m._frame_no = frame_no
	return m
}
ui.measure_text = measure_text

runevery(60 * 2, function() {
	let n = 0
	for (let fm of tm.values()) {
		for (let [s, m] of fm) {
			if (frame_no - m._frame_no > 60 * 60 * 4) {
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
	ww.wrap = function(ct_w, align) {
		if (!s)
			return
		if (ct_w == last_ct_w && line_gap * font_size == last_line_gap)
			return
		last_ct_w = ct_w
		last_line_gap = line_gap * font_size
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
			+ (line_count-1) * round(line_gap * font_size)
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
	let wrap = a[i+TEXT_FLAGS] & TEXT_WRAP
	if (wrap == TEXT_WRAP_WORD) {
		// word-wrapping is the reason for splitting the layouting algorithm
		// into interlaced per-axis measuring and positioning phases.
		let id = a[i+TEXT_ID]
		let ww = a[i+TEXT_S]
		if (!axis) {
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
			let h = a[i+1]
			if (h == -1)
				h = ww.h
			a[i+3] = h // min_h = h
			a[i+TEXT_H] = ww.h
		}
	} else if (!axis) {
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
			text_h += (s.length-1) * round(line_gap * font_size)
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
	a[i+2+axis] += spacings(a, i, axis)
	let w = a[i+2+axis]
	add_ct_min_wh(a, axis, w)
}

position[CMD_TEXT] = function(a, i, axis, sx, sw) {
	if (!axis) {
		let wrap = a[i+TEXT_FLAGS] & TEXT_WRAP
		if (wrap == TEXT_WRAP_WORD) {
			let ww = a[i+TEXT_S]
			ww.wrap(sw)
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

ui.text_value = function(id) { // user-typed text
	return ui.state(id, 'text')
}

// selecting text ------------------------------------------------------------

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
	let s = ui.state(input._ui_id)
	s.sel_i = 0
	s.sel_len = 1/0
	s.sel_pending = false
	input._ui_anchor = 0
	input._ui_caret = input.value.length
}

function apply_select_text(input) {
	let s = ui.state(input._ui_id)
	if (!s.sel_pending)
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

// input DOM elements --------------------------------------------------------

// move the DOM focus to where the frame put it:
// 1) same input focused (do nothing)
// 2) diff input focused by key (focus it, and select all of it by default)
// 3) diff input focused by click (do nothing: the click placed the caret)
// 4) no input focused (focus back the canvas).
function sync_dom_focus() {
	let input = drawn_focused_input
	if (input == prev_drawn_focused_input)
		return
	if (input) {
		if (drawn_focused_by_key) {
			input.focus()
			let id = input._ui_id
			if (!input._ui_ss_ids && !ui.state(id).sel_pending)
				ui.select_text(id, 0, 1/0)
		}
	} else if (document.activeElement == prev_drawn_focused_input) {
		canvas.focus()
	}
	prev_drawn_focused_input = input
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
	input.removeEventListener('blur', remote_input_blur)
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
	if (ui.focused_id == this._ui_id)
		ui.focused_id = null
	animate()
}

// anchor = selection start, caret = selection end; equal = no selection.
function read_input_sel(t, input) {
	let backward = input.selectionDirection == 'backward'
	t.anchor = backward ? input.selectionEnd   : input.selectionStart
	t.caret  = backward ? input.selectionStart : input.selectionEnd
}

function input_text_changed() {
	let s = ui.state(this._ui_id)
	s.text = this.value
	read_input_sel(s, this)
	forget_selection(s)
	animate()
}

function input_selection_changed() {
	let s = ui.state(this._ui_id)
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

function remote_input_blur() {
	// deactivating the window blurs the input, but focus didn't move.
	if (!document.hasFocus())
		return
	remote_input_send(this, {input: this._ui_id, event: 'blur'})
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

// send on the outermost screen's connection; the other ids are the route.
function remote_input_send(input, t) {
	let ids = input._ui_ss_ids
	if (ids.length > 1)
		t.ss_ids = ids.slice(1)
	ui.state(ids[0], 'con').send(json(t))
}

ui.process_shared_screen_input = function(p, t) {
	if (t.ss_ids?.length) {
		// clicking a remote input never reaches a canvas, so focus and blur
		// must apply to every screen on the route, not just to the input.
		let id = t.ss_ids.shift()
		if (t.event == 'focus') {
			ui.focus(id)
			animate()
		} else if (t.event == 'blur' && ui.focused_id == id) {
			ui.focused_id = null
			animate()
		}
		ui.state(id, 'con').send(json(t))
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
	} else if (t.event == 'blur') {
		if (ui.focused_id == t.input) {
			ui.focused_id = null
			animate()
		}
	} else if (t.event == 'input') {
		let s = ui.state(t.input)
		s.text = t.value
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
		input.addEventListener('selectionchange', remote
			? remote_input_selection_changed : input_selection_changed)
		screen.appendChild(input)
		s.input = input
		s.free = input_free
	}
	return input
}

// text drawing and hit-testing ----------------------------------------------

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
	let input_type = a[i+TEXT_INPUT_TYPE]
	let wrap     = flags & TEXT_WRAP
	let editable = flags & TEXT_EDITABLE
	let focused  = flags & TEXT_FOCUSED
	let by_key   = flags & TEXT_FOCUSED_BY_KEY
	if (ss_ids.length)
		focused = focused && ss_focused

	let col = ui.fg_color(color, color_state)

	if (editable) {
		let input = input_create(id, input_type)

		let align = a[i+ALIGN]
		let css_align = align == ALIGN_END ? 'right'
			: align == ALIGN_CENTER ? 'center' : 'left'
		let css_x = sx / dpr
		let css_y = y  / dpr
		let css_w = sw / dpr
		let css_font_size = font_size / dpr
		let opacity = focused ? 1 : 0
		// the frame is a round trip behind what was typed here, so take its
		// text only once it echoes back the last edit sent. a local input
		// never sends, so _ui_n stays 0 and the frame always wins.
		if (document.activeElement != input
				|| (ss_frame?.n ?? 0) >= input._ui_n) {
			if (input.value != s)
				input.value = s
			let anchor = ss_frame?.anchor
			let caret  = ss_frame?.caret
			if (focused && anchor != null
					&& (anchor != input._ui_anchor || caret != input._ui_caret)) {
				input.setSelectionRange(min(anchor, caret), max(anchor, caret),
					anchor > caret ? 'backward' : 'forward')
				input._ui_anchor = anchor
				input._ui_caret = caret
			}
		}
		if (input._ui_font != font
				|| input._ui_font_weight != font_weight
				|| input._ui_font_size != css_font_size) {
			input.style.fontFamily = font
			input.style.fontWeight = font_weight
			input.style.fontSize   = css_font_size+'px'
			input._ui_font        = font
			input._ui_font_weight = font_weight
			input._ui_font_size   = css_font_size
		}
		if (input._ui_x != css_x
				|| input._ui_y != css_y
				|| input._ui_w != css_w) {
			input.style.left  = css_x+'px'
			input.style.top   = css_y+'px'
			input.style.width = css_w+'px'
			input._ui_x = css_x
			input._ui_y = css_y
			input._ui_w = css_w
		}
		if (input._ui_align != css_align) {
			input.style.textAlign = css_align
			input._ui_align = css_align
		}
		if (input._ui_opacity != opacity) {
			input.style.opacity = opacity
			input._ui_opacity = opacity
		}

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

	let clip = w > sw

	if (clip) {
		let h = a[i+3]
		cx.save()
		cx.beginPath()
		cx.rect(sx, y, sw, h)
		cx.clip()
	}

	let text_align = a[i+ALIGN]
	let anchor_x
	if (text_align == ALIGN_END) {
		cx.textAlign = 'right'
		anchor_x = sx + sw
	} else if (text_align == ALIGN_CENTER && a[i+2] <= sw) {
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
			let i1 = a[i+TEXT_MARK_I1]
			let i2 = a[i+TEXT_MARK_I2]
			let mark_s = s.slice(i1, i2)
			let text_x
			if (text_align == ALIGN_END)
				text_x = anchor_x - measure_text(cx, s).width
			else if (text_align == ALIGN_CENTER)
				text_x = anchor_x - measure_text(cx, s).width / 2
			else
				text_x = anchor_x
			let mark_x = text_x + measure_text(cx, s.slice(0, i1)).width
			let bg = bg_color_hsl(a[i+TEXT_MARK_BG])
			cx.fillStyle = bg[0]
			cx.fillRect(mark_x, y, measure_text(cx, mark_s).width, asc + dsc)
			cx.fillStyle = fg_color('text', null, bg_is_dark(bg) ? 'dark' : 'light')
			cx.textAlign = 'left'
			cx.fillText(mark_s, mark_x, y + asc)
		}

	} else if (wrap == TEXT_WRAP_LINE) {

		cx.fillStyle = col

		for (let ss of s) {
			cx.fillText(ss, anchor_x, y + asc)
			y += asc + dsc + round(line_gap * font_size)
		}

	} else if (wrap == TEXT_WRAP_WORD) {

		cx.fillStyle = col
		cx.textAlign = 'left'

		let align = a[i+ALIGN]
		let x0 = x
		let ww = s

		for (let k = 0, n = ww.lines.length; k < n; k += 2) {

			let i1     = ww.lines[k]
			let line_w = ww.lines[k+1]
			let i2     = ww.lines[k+2] ?? ww.words.length

			let x
			if (align == ALIGN_END)
				x = x0 + w - line_w
			else if (align == ALIGN_CENTER)
				x = x0 + round((w - line_w) / 2)
			else
				x = x0

			for (let i = i1; i < i2; i++) {
				let s1 = ww.words [i]
				let w1 = ww.widths[i]
				cx.fillText(s1, x, y + asc)
				x += w1 + ww.sp_w
			}

			y += asc + dsc + round(line_gap * font_size)
		}
	}

	if (clip)
		cx.restore()

}

hittest[CMD_TEXT] = function(a, i) {
	if (hit_box(a, i)) {
		hover(a[i+TEXT_ID])
		hit_template(a, i)
		return true
	}
}

// frame widget --------------------------------------------------------------

const FRAME_ON_MEASURE = BOX_ARGS+0
const FRAME_ON_FRAME   = BOX_ARGS+1
const FRAME_CT_I       = BOX_ARGS+2
const FRAME_REC_I      = BOX_ARGS+3
const FRAME_LAYER_I    = BOX_ARGS+4
const FRAME_ARGS_I     = BOX_ARGS+5

ui.FRAME_ARGS_I = FRAME_ARGS_I

let frame_make_ms = 0

let frame = {}

frame.create = function(
	cmd, on_measure, on_frame, fr, align, valign, min_w, min_h, ...args
) {

	let ct_i = ui.ct_i()
	let rel_ct_i = ui.rel_ct_i()
	assert(a[ct_i-1] == CMD_SCROLLBOX, 'frame is not inside a scrollbox')

	return ui_cmd_box(cmd, fr, align, valign, min_w, min_h,
		on_measure, on_frame,
		rel_ct_i,
		null, // rec_i, unset (0 is the main record)
		current_layer.i,
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

	let on_frame = a[i+FRAME_ON_FRAME]
	let t0 = clock_ms()
	let a0 = begin_rec()
		a[i+FRAME_REC_I] = rec_i
		let prev_layer = current_layer
		let layer_i = a[i+FRAME_LAYER_I]
		current_layer = layer_arr[layer_i]
		ui.stack()
			force_scope_vars()
			on_frame(a, i, x, y, w, h, cx, cy, cw, ch)
			reset_spacings()
		ui.end_stack()
		current_layer = prev_layer
		frame_end_check()
	let a1 = end_rec(a0)
	// pr(json(a1).length)
	frame_make_ms += clock_ms() - t0

	layout_rec(a1, x, y, w, h)

	// callbacks are not serializable so we have to clean them up from the rec.
	a[i+FRAME_ON_MEASURE] = null
	a[i+FRAME_ON_FRAME] = null

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

// shared screen widget ------------------------------------------------------

let SS_ID    = BOX_ARGS+0
let SS_FRAME = BOX_ARGS+1
let SS_STATE = BOX_ARGS+2

let SS_FOCUSED = 1

let ss = {}

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

	keepalive(id)
	ui.focusable(id)
	ui.capture_tab(id)
	ui.capture_tab(id, true)
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
	if (hs && ui.click) {
		ui.focus(id)
		hs = ui.capture(id) || hs
	}
	let keys = ui.focused(id) ? ui.pointer.key_state : empty_set
	if (!s.sent_keys || !set_equals(s.sent_keys, keys)) {
		s.sent_keys = set(keys)
		answer_con.send(json({event: 'key_state', keys: [...keys]}))
	}
	if (ui.focused(id)) {
		for (let e of ui.key_events)
			answer_con.send(json({event: 'key', key_event: e}))
		ui.capture_keys()
	}
	let mx = answer_con.frame && hs && ui.mx != null ? ui.mx - hs.x : null
	let my = answer_con.frame && hs && ui.my != null ? ui.my - hs.y : null
	ss_send_pointer(s, mx, my)

	return ui_cmd_box(cmd, fr, align, valign, min_w, min_h,
		id,
		answer_con.frame,
		// The renderer needs this to decide if nested DOM inputs can be active.
		ui.focused(id) ? SS_FOCUSED : 0,
	)

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
	let cs = captured(id)
	let hs
	if (hit_rect(a[i+0], a[i+1], a[i+2], a[i+3]))
		hs = hover(id)
	if (!hs && !cs)
		return
	if (hs) {
		hs.x = a[i+0]
		hs.y = a[i+1]
	}
	if (cs) {
		cs.x = a[i+0]
		cs.y = a[i+1]
	}
	return true
}

// Recorded on remote DOM inputs for routing through nested shared screens.
let ss_ids = []
// The frame being drawn, null for this machine's own; see draw[CMD_TEXT].
let ss_frame
// Ids of the machines whose frames are being drawn, this one's first.
// A repeat means a cycle.
let ss_screen_ids = [screen_id]
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
		cx.fillStyle = fg_color('button-danger')
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

// template widget -----------------------------------------------------------

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

function template_select_node(id, root_t, node_t, node_i) {
	selected_template_id = id
	selected_template_root_t = root_t
	selected_template_node_t = node_t
	ui.relayout()
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
			ch_t_i = cmd_next_ext_i(a, ch_t_i)
		}
	}
}
function hit_template(a, i) {
	let id = hit_template_id
	if (id && i >= hit_template_i0 && i < hit_template_i1) {
		let hs = hit(id)
		if (!hs)
			return
		let root_t = hs.root
		let node_t = template_find_node(a, i, root_t, hit_template_i0)
		hs.node = node_t
		if (ui.clickup)
			template_select_node(id, root_t, node_t)
		return true
	}
}

function template_add(t) {
	let cmd = cmd_name_map[t.t]
	let targs_f = assert(targs[t.t], 'unknown type ', t.t)
	let args = targs_f(t)
	t.i = a.length + 2
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
	let i0 = a.length+2 // index of first cmd's arg#1
	template_add(t)
	let i1 = a.length+2 // index of next cmd's arg#1
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
		return ui_cmd_box(cmd, 1, 's', 's', 0, 0, id, t, i0, i1)
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
			hover(id).root = t
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

// drag point widget ---------------------------------------------------------

{
let ARGS  = 2+2+8+1
let COLOR = ARGS+0
let ID    = ARGS+1
let out = [0, 0, null]
ui.widget('drag_point', {
	create: function(cmd, id, x, y, color) {
		color ??= 'red'
		keepalive(id)
		ui.state_init(id, 'x', x)
		ui.state_init(id, 'y', y)
		x = ui.state(id, 'x')
		y = ui.state(id, 'y')
		let [state, dx, dy] = ui.drag(id)
		if (state == 'dragging' || state == 'drop') {
			x += dx
			y += dy
		}
		if (state == 'drop') {
			ui.state(id).x = x
			ui.state(id).y = y
		}

		// NOTE: we're making it a zero-sized box because it's freely movable.
		let i = ui_cmd(cmd, x, y,
			0, 0, // w, h
			0, 0, 0, 0, // p
			0, 0, 0, 0, // m
			0, // fr
			color, id,
		)
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
			hover(id)
			return true
		}
	},
})
}

// button --------------------------------------------------------------------

// NOTE: the button is activated only if the mouse button was released while
// over the button, and only if it was pressed while over the button, even
// though the mouse _is_ captured.

ui.button_stack = function(id, fr, align, valign, min_w, min_h) {
	ui.focusable(id)
	ui.stack(id, fr, align ?? 's', valign ?? 'c', min_w, min_h ?? ui.em(1.5))
}

ui.button_state = function(id) {
	let cs = ui.capture(id)
	let hs = hit(id) || (cs && hovers(id))
	if (ui.consume(id, 'click'))
		return 'click'
	if (ui.focused(id) && (ui.keydown('enter') || ui.keydown(' '))) {
		if (ui.keydown('enter'))
			ui.capture_keys()
		return 'click'
	}
	return cs && hs ? ui.clickup ? 'click' : 'active'
		: hs ? 'hover' : ui.focused(id) ? 'focused' : null
}

ui.button_bb = function(style, state) {
	state = repl(state, 'click', 'hover')
	style = style ?? 'button'
	if (!style) { // false, 0, '' means no border
		if (state == 'focused')
			ui.focus_ring()
		return
	}
	ui.shadow('button')
	let radius = ui.sp05()
	ui.bb(style, repl(state, 'focused', null),
		1, 'intense', repl(state, 'focused', 'hover'), radius)
}

ui.button_text = function(s, state, w, h) {
	state = repl(state, 'click', 'hover')
	h ??= ui.em(2.2) // force h
	ui.bold()
	ui.color('text', state)
	ui.text('', s, 0, 'c', 'c', null, w, h)
}

ui.button_icon = function(font, icon, state, w, h) {
	state = repl(state, 'click', 'hover')
	ui.scope()
		ui.font(font)
		ui.font_size(1.5)
		ui.color('text', state)
		ui.text('', icon)
	ui.end_scope()
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
	let state = ui.button_state(id)
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
	let state = ui.button_state(id)
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

// split ---------------------------------------------------------------------

function split(hv, id, size, unit, fixed_side,
	split_fr, gap, align, valign, min_w, min_h,
) {

	let snap_px = 50
	let splitter_w = 1

	let horiz = hv == 'h'
	let W = horiz ? 'w' : 'h'
	let [state, dx, dy] = ui.drag(id)
	keepalive(id)
	let s = ui.state(id)
	let cs = captured(id)
	let measured_wh = cs?.[W] ?? s[W]
	let max_size = (measured_wh ?? 1/0) - splitter_w
	assert(!unit || unit == 'px' || unit == '%')
	let fixed = unit == 'px'
	if (fixed && measured_wh == null)
		ui.relayout() // needed or `collapsed` may start out wrong and stay wrong.
	size = s.size ?? size
	let fr = fixed ? 0 : (size ?? 0.5)
	let min_size = fixed ? size ?? 0 : 0
	if (state && state != 'hover') {
		if (state == 'drag')
			cs[W] = s[W]
		let size_px = fixed ? min_size : round(fr * max_size)
		size_px += horiz ? dx : dy
		if (size_px < snap_px)
			size_px = 0
		else if (size_px > max_size - snap_px)
			size_px = max_size
		size_px = min(size_px, max_size)
		if (fixed)
			min_size = size_px
		else
			fr = size_px / max_size
		if (state == 'drop')
			s.size = fixed ? min_size : fr
	}

	ui[hv](split_fr, gap, align, valign, min_w, min_h)

	if (state)
		ui.set_cursor(horiz ? 'ew-resize' : 'ns-resize')
	ui.measure(id)

	let collapsed = fixed
		? min_size == 0 || (max_size != null && min_size == max_size)
		: fr == 0 || fr == 1

	scope_set('split'   , hv)
	scope_set('split_id', id)
	scope_set('split_collapsed', collapsed)
	scope_set('split_fr2', fixed ? 1 : 1 - fr)

	ui.sb(id+'.scrollbox1', fr, null, null, null, null, min_size)

	return size
}

ui.splitter = function() {

	ui.end_sb()

	let hit_distance = 10

	let hv = scope_get('split')
	let id = scope_get('split_id')
	let collapsed = scope_get('split_collapsed')
	let fr2 = scope_get('split_fr2')
	let st = hit(id) ? 'hover' : null

	if (hv == 'h') {
		ui.stack('', 0, 'l', 's', 1, 0)
			ui.popup('', null, null, 'it', '[]')
				ui.ml(-hit_distance / 2)
				ui.stack(id, 0, 'l', 's', hit_distance)
					ui.stack('', 1, 'c', 's')
						ui.border('l', 'intense', st)
					ui.end_stack()
					if (collapsed) {
						ui.stack('', 1, 'c', 'c', 5, 2*ui.sp8())
							ui.border('lr', 'intense', st)
						ui.end_stack()
					}
				ui.end_stack()
			ui.end_popup()
		ui.end_stack()
	} else {
		ui.stack('', 0, 's', 't', 0, 1)
			ui.popup('', null, null, 'it', '[]')
				ui.mt(-hit_distance / 2)
				ui.stack(id, 0, 's', 't', 0, hit_distance)
					ui.stack('', 1, 's', 'c')
						ui.border('t', 'intense', st)
					ui.end_stack()
					if (collapsed) {
						ui.stack('', 1, 'c', 'c', 2*ui.sp8(), 5)
							ui.border('tb', 'intense', st)
						ui.end_stack()
					}
				ui.end_stack()
			ui.end_popup()
		ui.end_stack()
	}

	ui.sb(id+'.scrollbox2', fr2)
}

function end_split(hv) {

	ui.end_sb()

	if (hv == 'h')
		ui.end_h()
	else
		ui.end_v()

}

ui.hsplit = function(...args) { return split('h', ...args) }
ui.vsplit = function(...args) { return split('v', ...args) }

ui.end_hsplit = function() { end_split('h') }
ui.end_vsplit = function() { end_split('v') }

// text-input ----------------------------------------------------------------

ui.input = function(id, s, fr, w, h) {
	ui.stack('', fr, 's', 's')
		ui.bb(
			'input', ui.focused(id) ? 'focused' : null,
			1, 'intense', ui.focused(id) ? 'hover' : null)
		ui.p(ui.sp())
		ui.color('text', ui.focused(id) ? 'focused' : null)
		s = ui.text(id, s, 1, 'l', 'c', null, w ?? ui.em(12), h, null, true)
	ui.end_stack()
	return s
}

ui.label = function(for_id, s, fr, align, valign) {
	let id = for_id+'.label'
	ui.color('text')
	ui.text(id, s, fr, align ?? 'l', valign ?? 'c')
}

ui.radio_label = function(for_id, for_group_id, s, fr, align, valign) {
	let id = for_id+'.label'
	ui.color('text', (hit(id) || hit(for_id)) ? 'hover' : null)
	ui.text(id, s, fr, align ?? 'l', valign ?? 'c')
}

// list ----------------------------------------------------------------------

ui.valid_list_index = function(i, items) {
	return items.length ? clamp(i, 0, items.length-1) : null
}

function list_update(id, s) {
	let items  = s.items
	let fi     = s.focused_item_i
	let before_fi = fi
	let d = ui.focused(id) && (
			ui.keydown('arrowdown') &&  1 ||
			ui.keydown('arrowup'  ) && -1
		) || 0
	fi = fi != null ? fi + d : d >= 0 ? 0 : items.length-1
	fi = ui.valid_list_index(fi, items)
	let fi_changed = d && 'key'
	let i = 0
	for (let item of items) {
		let item_id = id+'.'+i
		if (hit(item_id) && ui.click) {
			ui.focus(id)
			fi = i
			fi_changed = 'click'
		}
		i++
	}
	s.focused_item_i = fi
	s.focused_item_changed = before_fi != fi ? fi_changed : false
	let has_enter = fi != null && ui.focused(id) && ui.keydown('enter')
	if (fi_changed == 'click' || has_enter)
		ui.fire(id, 'item_picked', fi)
	if (has_enter)
		ui.capture_keys()
}
function hvlist(hv, id, items, fr, align, valign,
	item_align, item_valign, item_fr,
	max_w, min_w,
	item_pad_l, item_pad_r, item_pad_y, item_h
) {
	let s = ui.state(id)
	s.items = items
	keepalive(id, list_update)
	ui.focusable(id)
	let fi = s.focused_item_i ?? 0
	let list_focused = ui.focused(id)
	// reveal the focused item on tab-focusing the list and on arrow keys.
	// a clicked item is excepted to avoid shifting it under the mouse pointer.
	let reveal_fi = ui.focusing(id) || s.focused_item_changed == 'key'
	let i = 0
	hv = hv || 'v'
	assert(hv == 'v' || hv == 'h')
	ui.hv(hv, fr, 0, align ?? '[', valign ?? '[', min_w ?? 120)
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
			if (list_focused && item_focused)
				ui.focus_ring()
		ui.end_stack()
		i++
	}
	ui.end()
	return items[fi]
}
ui.hvlist = hvlist
ui.vlist = function(...args) { return hvlist('v', ...args) }
ui.hlist = function(...args) { return hvlist('h', ...args) }
ui.list = ui.vlist

// tabs ----------------------------------------------------------------------

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

ui.tabs = function(id, all_tabs, selected_tab, tabs_order, hidden_tabs) {

	let s = ui.state(id)
	selected_tab = s.selected_tab ?? selected_tab
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

	let drag_state, dx, dy, cs
	let drag_tab_id, drag_tab
	for (drag_tab of tabs) {
		drag_tab_id = id+'.tab'+drag_tab.index
		;[drag_state, dx, dy, cs] = ui.drag(drag_tab_id)
		if (drag_state) break
	}

	let mover = cs?.mover
	if (!mover && drag_state == 'drag') {
		selected_tab = drag_tab
		ui.state(id).selected_tab = selected_tab.id
	} else if (!mover && drag_state == 'dragging' && abs(dx) > 10) {
		mover = ui.live_move_mixin()
		cs.mover = mover
		mover.movable_element_size = function(vi) {
			let tab = tabs[vi]
			let tab_id = id+'.tab'+tab.index
			let w = ui.state(tab_id).w
			return w
		}
		mover.set_movable_element_pos = function(i, x, moving, vi) {
			// not using mover's positions, just mover.over_i
		}
		mover.move_element_start(drag_tab.index, 1, 0, tabs.length)
	} else if (mover && drag_state == 'dragging') {
		mover.move_element_update_dx(dx)
	} else if (mover && drag_state == 'drop') {
		array_move(tabs, drag_tab.index, 1, mover.over_i, true)
		tabs_order = tabs.map(tab => tab.id).join(' ')
		s.tabs_order = tabs_order
		tabs = visible_element_list(all_tabs, 'id', 'index', tabs_order, hidden_tabs)
		s.tabs = tabs
		mover = null
	}

	for (let j = 0, n = tabs.length; j < n; j++) {
		let tab_i = j
		let tab = tabs[tab_i]
		let tab_id = id+'.tab'+tab_i
		let over_gap = mover && tab_i == mover.over_i
		if (over_gap) {
			let tab_id = drag_tab_id
			let w = ui.state(tab_id).w
			ui.stack('', 0, null, null, w)
			ui.end_stack()
		}
		let moving = mover && tab == drag_tab
		if (moving) {
			ui.popup('', 'overlay', null, 'it', '[')
			ui.ml(max(0, mover.x0 + dx))
		}
		ui.stack(tab_id)
		ui.measure(tab_id)
			let sel = tab == selected_tab
			let hover = drag_state == 'hover' && drag_tab == tab || moving
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
			ui.relayout()
		}
	}
	ui.end_h()
	ui.end_sb()

	return selected_tab
}

// menu ----------------------------------------------------------------------

ui.menu = function(id, items, side, align) {

		let open_items = ui.state(id, 'open_items')
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
				if (hover)
					if (item.items?.length) {
						open_items[level] = item.id
						open_items.length = level+1
					} else {
						open_items.length = level
					}
				let open = open_items[level] == item.id
				ui.stack(item_id)
					ui.pl(ui.rem(3))
					ui.pr(ui.rem(1))
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

// polyline ------------------------------------------------------------------

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
		return ui_cmd(cmd, id, ui.rel_ct_i(), (closed ?? 0) ? 1 : 0,
			fill_color   ?? 0, parse_state(fill_color_state  ),
			stroke_color ?? 0, parse_state(stroke_color_state), line_width ?? 1,
			...points)
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
			add_ct_min_wh(a, 0, x2-x1)
			add_ct_min_wh(a, 1, y2-y1)
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
		if (fill_color) {
			set_points(cx, x0, y0, a, pi1, pi2, closed, 0)
			cx.fillStyle = bg_color(fill_color, fill_color_state)
			cx.fill()
		}
		if (stroke_color) {
			set_points(cx, x0, y0, a, pi1, pi2, closed, line_width / 2)
			cx.strokeStyle = fg_color(stroke_color, stroke_color_state)
			cx.lineWidth = line_width
			cx.stroke()
			cx.lineWidth = 1
		}
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
			hover(id)
			return true
		}
	},
})

/* dropdown ------------------------------------------------------------------

	let open = ui.dropdown(id, [side])
		... the value ...
	ui.dropdown_picker()
		if (open)
			... the picker, under id+'.picker' ...
	ui.end_dropdown()

*/

// fires 'picked', 'opened', 'closed'. responds to 'open'. sets ui.state(id).open.
function dropdown_update(id, s) {

	let picker_id = id+'.picker'
	let popup_id = id+'.popup'
	let was_open = s.open
	let open = was_open

	let click = hit(id) && ui.click // id is the dropbox or the grid cell
	let picked_args = ui.consume(picker_id, 'item_picked')
	let picked = !!picked_args
	let want_open = !!ui.consume(id, 'open')

	let enter = ui.focused(id) && ui.keydown('enter')

	let toggle = click || enter
	let escape = open && ui.keydown('escape') && ui.focus_inside(picker_id)
	// using hovers() is a hack to make the resizer work which captures the
	// mouse and masks hit() (but it doesn't clear ui.click).
	let click_outside = open && ui.click && !hovers(popup_id)

	if (picked || escape || click_outside) {
		open = false
		if (escape)
			ui.capture_keys()
	} else if (toggle) {
		open = !open
		if (enter)
			ui.capture_keys()
	} else if (want_open) {
		open = true
	}

	s.open = open
	if (picked)
		ui.fire(id, 'picked', ...picked_args)
	if (!was_open && open)
		ui.fire(id, 'opened')
	if (was_open && !open)
		ui.fire(id, 'closed', picked)

	if (!was_open && open)
		ui.focus_first(picker_id)
	if (was_open && !open && ui.focus_inside(picker_id))
		ui.focus(id)
}

let dd_open // decided in dropdown(), needed in dropdown_picker() and end_dropdown()
let dd_picker_id // focus group id of the open dropdown's picker

// opened by 'open' event.
ui.dropdown = function(id, side) {

	assert(dd_open == null, 'nested dropdown')

	let s = ui.state(id) // runs dropdown_update() if it hasn't run this frame
	s.open ??= false
	keepalive(id, dropdown_update)
	let open = s.open
	dd_open = open
	dd_picker_id = id+'.picker'

	keepalive(dd_picker_id+'.resizer')

	if (open) {
		ui.popup(id+'.popup', 'open', null, side ?? 'il', 's', 0, 0,
			'constrain change_side solid')
		ui.shadow('picker')
		ui.bb('input') // background only: end_dropdown() draws the border
	}

	ui.v()

		ui.focusable(id)
		ui.stack(id)

	return open
}

ui.dropdown_picker = function() {
	ui.end_stack()
	if (dd_open) {
		ui.focus_group(true, null, dd_picker_id)
		ui.stack()
	}
}

ui.end_dropdown = function() {
	let open = dd_open
	dd_open = null
	if (open) {
		ui.end_stack()
		ui.end_focus_group()
	}
	ui.end_v()
	if (open) {
		// last, so that the picker's item backgrounds don't paint over it.
		ui.bb(null, null, 1, 'intense')
		ui.end_popup()
	}
}

// list_dropdown -------------------------------------------------------------

ui.list_dropdown = function(id, items, fr, max_w, min_w, min_h) {

	let picker_id = id+'.picker'

	// reading the state runs the decision for this frame.
	let open = ui.state(id, 'open') ?? false

	// open, the value follows the list's focused item; on a pick, that item
	// is the value.
	let i = (open || ui.listen(id, 'picked'))
		? ui.state(picker_id, 'focused_item_i') : null
	let sel_i = i ?? ui.state(id, 'i') ?? 0
	sel_i = ui.valid_list_index(sel_i, items)
	ui.state(id).i = sel_i

	// arrow keys move the selection with the list closed.
	if (!open && ui.focused(id)) {
		let d = ui.keydown('arrowup') && -1 || ui.keydown('arrowdown') && 1 || 0
		if (d) {
			sel_i = ui.valid_list_index(sel_i + d, items)
			ui.state(id).i = sel_i
		}
	}

	ui.stack('', fr, 's', 's', min_w ?? ui.em(12), min_h)

	// empty box for the popup to align to, the size of the closed dropdown.
	ui.p(ui.sp())
	ui.text('', '', 0, 'l', 'c')

	ui.dropdown(id)

		if (!open)
			ui.bb('input', null, 1, 'intense', ui.focused(id) ? 'hover' : null)
		ui.p(ui.sp())
		ui.h(0, ui.sp())
			ui.text('', sel_i != null ? items[sel_i] : '', 1, 'l', 'c', max_w ?? ui.em(8))
			ui.stack('', 0)
				ui.polyline('', '0 4  7 11  14 4', false, null, null, 'label')
			ui.end_stack()
		ui.end_h()

	ui.dropdown_picker()

		if (open) {
			ui.state_init(picker_id, 'focused_item_i', sel_i)
			ui.scrollbox(picker_id+'.sb', 1, 'hide', 'auto', 's', 's')
				ui.list(picker_id, items, 0, 's', 's', 'l', 'c', 0, max_w,
					null, ui.sp(), ui.sp(), ui.sp())
			ui.end_scrollbox()
			ui.resizer(picker_id+'.resizer', null, ui.em(16), 'y')
		}

	ui.end_dropdown()

	ui.end_stack()
}

// toolbox widget ------------------------------------------------------------

ui.toolbox = function(id, title, align, valign, x0, y0, target_i) {

	keepalive(id)
	let  align_start =  parse_align( align || '[') == ALIGN_START
	let valign_start = parse_valign(valign || 't') == ALIGN_START
	let ts = ui.state(assert(scope_get('toolboxes_id'), 'begin_toolboxes missing'))
	if (hit(id) && ui.click) {
		ts.to_top = id
		ui.tab_into(id)
	}
	let [dstate, dx, dy] = ui.drag(id+'.title')
	let cs = captured(id+'.title') // null unless dragging
	let s = ui.state(id)
	// ox, oy: offset from the target edges that align and valign anchor the
	// toolbox to, so that it keeps its distance from them when they move.
	// x0, y0 are distances from those edges, the offsets are screen-directed.
	// the popup keeps ox, oy on screen, the drag moves from where the grab
	// found them so that the grabbed point stays under the mouse.
	let ox = s.ox ?? ( align_start ? x0 : -x0)
	let oy = s.oy ?? (valign_start ? y0 : -y0)
	if (dstate == 'drag') { cs.ox0 = ox; cs.oy0 = oy }
	if (cs) { ox = cs.ox0 + dx; oy = cs.oy0 + dy }
	let i = ui.popup(id, 'toolbox', target_i ?? 'screen',
		valign_start ? 'it' : 'ib', align, null, null, 'constrain solid', null,
		ox, oy
	)
		ts.popups.set(id, i)
		ui.focus_group(null, null, id)
		//ui.p(1)
		ui.bb('bg1', null, 1, 'intense')//, null, ui.sp075())
		ui.stack()
			scope_set('toolbox_id', id)
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
	let id = scope_get('toolbox_id')
			ui.end_v()
			ui.resizer(id)
		ui.end_stack()
		ui.end_focus_group()
	ui.end_popup()
}

ui.begin_toolboxes = function(tid) {
	assert(tid, 'toolboxes id required')
	attr(ui.state(tid), 'popups', map).clear()
	scope_set('toolboxes_id', tid)
}

ui.end_toolboxes = function() {
	let tid = assert(scope_get('toolboxes_id'), 'begin_toolboxes missing')
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
		s.to_top = null
	}
	let z = 1
	for (let id of order) {
		let popup_i = popups.get(id)
		set_z_index(a, popup_i, z++)
	}
}

// all-sides resizer widget --------------------------------------------------

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
		keepalive(id)
		let ct_i = ui.ct_i()
		let s = ui.state(id)
		let [dstate, dx, dy, cs] = ui.drag(id)
		if (dstate == 'hover')
			ui.set_cursor(cursors[cs.side])
		if (dstate == 'drag') {
			let side = cs.side
			if (side == 'right' || side == 'bottom_right')
				cs.w0 = cs.measured_w
			if (side == 'bottom' || side == 'bottom_right')
				cs.h0 = cs.measured_h
		}
		if (dstate == 'drag' || dstate == 'dragging' || dstate == 'drop') {
			let side = cs.side
			ui.set_cursor(cursors[side])
			if (side == 'right' || side == 'bottom_right')
				s.w = min(cs.w0 + dx, max_w ?? 1/0)
			if (side == 'bottom' || side == 'bottom_right')
				s.h = min(cs.h0 + dy, max_h ?? 1/0)
		}
		a[ct_i+0] = s.w ?? default_w ?? a[ct_i+0]
		a[ct_i+1] = s.h ?? default_h ?? a[ct_i+1]
		return ui_cmd(cmd, ui.rel_ct_i(), id, axis ?? 'xy')
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
			let hs = hover(id)
			hs.side = side
			hs.measured_x = x
			hs.measured_y = y
			hs.measured_w = w + borders
			hs.measured_h = h + borders
		}

		return ui.captured_id == id || ui.captured_id == null && !!side

	},
})

}

// toggle --------------------------------------------------------------------

ui.bg_style('*', 'toggle'      , '*', 'bg2')
ui.bg_style('*', 'toggle'      , 'normal item-selected', 'link', 'normal')
ui.bg_style('*', 'toggle'      , 'hover  item-selected', 'link', 'hover' )
ui.bg_style('*', 'toggle-thumb', '*', 'text')

let TOGGLE_ID    = BOX_ARGS+0
let TOGGLE_STATE = BOX_ARGS+1

let TOGGLE_ON    = 1
let TOGGLE_HOVER = 2

let toggle = {}

toggle.create = function(cmd, id, on, fr, align, valign, min_w, min_h) {
	keepalive(id)
	let hs = hit(id) || hit(id+'.label')
	if (hs && ui.click)
		on = !on
	ui_cmd_box(cmd, fr, align ?? 'c', valign ?? 'c',
		min_w ?? ui.em(2.5),
		min_h ?? ui.em(1.5),
		id,
		(on ? TOGGLE_ON : 0) | (hs ? TOGGLE_HOVER : 0))
	return on
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

	// button

	cx.beginPath()
	cx.roundRect(x, y, w, h, 1000)
	let state =
		(on ? STATE_ITEM_SELECTED : 0) |
		(hs ? STATE_HOVER         : 0)
	cx.fillStyle = ui_bg_color('toggle', state)
	cx.fill()

	// thumb

	cx.beginPath()
	let cx1 = on ? x + w - h / 2 : x + h / 2
	let cy1 = y + h / 2
	cx.arc(cx1, cy1, h * .35, 0, 2 * PI)
	cx.closePath()
	ui.set_shadow('button')
	cx.fillStyle = ui_bg_color('toggle-thumb', hs ? 'hover' : null)
	cx.fill()
	reset_shadow()
}

ui.box_widget('toggle', toggle)

// checkbox ------------------------------------------------------------------

let checkbox = {...toggle}

checkbox.create = function(cmd, id, fr, align, valign, min_w, min_h) {
	return toggle.create(cmd, id, fr, align, valign,
		min_w ?? ui.em(1.5),
		min_h ?? ui.em(1.5),
	)
}

checkbox.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let flags = a[i+TOGGLE_STATE]
	let on = flags & TOGGLE_ON
	let hs = flags & TOGGLE_HOVER

	let state =
		(on ? STATE_ITEM_SELECTED : 0) |
		(hs ? STATE_HOVER         : 0)
	let bg = bg_color_hsl('toggle', state)
	let fg = fg_color('text', hs ? 'hover' : null, bg_is_dark(bg) ? 'dark' : 'light')
	bg = bg[0]

	// check box

	cx.beginPath()
	cx.roundRect(x, y, w, h, 2)
	cx.fillStyle = bg
	cx.fill()

	// check mark

	cx.beginPath()
	cx.save()
	cx.translate(x, y)
	cx.scale(1/w, 1/h)
	cx.scale(20, 20)
	cx.translate(1, 0)
	cx.moveTo(4, 11)
	cx.lineTo(8, 15)
	cx.lineTo(16, 6)
	cx.strokeStyle = fg
	cx.lineWidth = 1.5
	cx.lineCap = 'round'
	cx.lineJoin = 'round'
	cx.setLineDash([20])
	cx.lineDashOffset = on ? 0 : 20 // TODO: animate
	cx.stroke()
	cx.restore()

}

ui.box_widget('checkbox', checkbox)

// radio ---------------------------------------------------------------------

let radio = {...checkbox}

let RADIO_GROUP_ID = BOX_ARGS+2

//|| hit(id+'.label')
radio.create = function(cmd, id, group_id, fr, align, valign, min_w, min_h) {
	keepalive(id)
	keepalive(group_id)
	let clicked = (hit(group_id) || hit(group_id+'.label')) && ui.click
	let clicked_id = clicked && hit(group_id, 'id')
	let on = clicked ? clicked_id == id && !ui.state(id, 'on') : null
	if (clicked) {
		ui.state(id).on = false
		ui.state(clicked_id).on = true
	}
	let hs = hit(id) || hit(id+'.label')
	let selected = ui.state(id, 'on')
	ui_cmd_box(cmd, fr, align ?? 'c', valign ?? 'c',
		min_w ?? ui.em(1.5),
		min_h ?? ui.em(1.5),
		id,
		(selected ? TOGGLE_ON : 0) | (hs ? TOGGLE_HOVER : 0),
		group_id)
	return on
}

radio.draw = function(a, i) {

	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let flags = a[i+TOGGLE_STATE]
	let on = flags & TOGGLE_ON
	let hs = flags & TOGGLE_HOVER

	let cx1 = x + w / 2
	let cy1 = y + h / 2

	// button

	cx.beginPath()
	cx.arc(cx1, cy1, h * .5, 0, 2 * PI)
	cx.fillStyle = bg_color('toggle', hs ? 'hover' : null)
	cx.fill()

	// bullet

	cx.beginPath()
	cx.arc(cx1, cy1, h * (on ? .15 : 0), 0, 2 * PI)
	cx.closePath()
	ui.set_shadow('button')
	cx.fillStyle = bg_color('toggle-thumb', hs ? 'hover' : null)
	cx.fill()
	reset_shadow()

}

radio.hit = function(a, i) {
	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let id = a[i+TOGGLE_ID]
	let group_id = a[i+RADIO_GROUP_ID]
	if (hit_rect(x, y, w, h)) {
		hover(group_id).id = id
		return true
	}
}

ui.box_widget('radio', radio)

// slider --------------------------------------------------------------------

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
let SLIDER_P          = BOX_ARGS+4 // progress in 0..1
let SLIDER_MARKERS    = BOX_ARGS+5
let SLIDER_SCALE_BASE = BOX_ARGS+6
let SLIDER_SCALES     = BOX_ARGS+7
let SLIDER_THUMB_I    = BOX_ARGS+8
let SLIDER_STATE      = BOX_ARGS+9

let SLIDER_HOVER   = 1
let SLIDER_FOCUSED = 2

let fr0, align0, valign0, min_w0, min_h0

ui.box_args = function(fr, align, valign, min_w, min_h) {
	fr0     = fr
	align0  = align
	valign0 = valign
	min_w0  = min_w
	min_h0  = min_h
}

ui.clear_box_args = function() {
	fr0     = null
	align0  = null
	valign0 = null
	min_w0  = null
	min_h0  = null
}

ui.slider_mark_w_em = 2
ui.slider_thumb_r_em = .6
ui.slider_shaft_h_em = 0.2

ui.slider_progress = function(id) {
	return ui.state(id, 'p') ?? .5
}

ui.slider_value = function(id, from, to) {
	return lerp(ui.slider_progress(id), 0, 1, from ?? 0, to ?? 1)
}

ui.slider_set_progress = function(id, p) {
	p = clamp(p, 0, 1)
	ui.state(id).p = p
}

ui.slider_set_value = function(id, from, to, v) {
	let p = lerp(v, from ?? 0, to ?? 1, 0, 1)
	ui.slider_set_progress(id, p)
}

function dot(x, y) {
	cx.beginPath()
	cx.arc(x, y, 10, 0, 2 * PI)
	cx.strokeStyle = 'red'
	cx.stroke()
}

function rect(x, y, w, h) {
	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.strokeStyle = 'red'
	cx.stroke()
}

function a_rect(a, i) {
	let x = a[i+0]
	let y = a[i+1]
	let w = a[i+2]
	let h = a[i+3]
	let mx1 = a[i+MX1+0]
	let my1 = a[i+MX1+1]
	let mx2 = a[i+MX2+0]
	let my2 = a[i+MX2+1]
	let px1 = a[i+PX1+0]
	let py1 = a[i+PX1+1]
	let px2 = a[i+PX2+0]
	let py2 = a[i+PX2+1]

	cx.beginPath()
	cx.rect(x, y, w, h)
	cx.strokeStyle = 'red'
	cx.stroke()

	cx.rect(x-px1, y-py1, w+px1+px2, h+py1+py2)
	cx.strokeStyle = 'green'
	cx.stroke()

	cx.rect(x-px1-mx1, y-py1-my1, w+px1+px2+mx1+mx2, h+py1+py2+my1+my2)
	cx.strokeStyle = 'blue'
	cx.stroke()
}

ui.box_widget('slider', {

	create: function(cmd, id, from, to, decimals, markers, scale_base, scales) {

		keepalive(id)
		ui.focusable(id)

		markers = (markers ?? 1) ? 1 : 0

		let fr = fr0 ?? 1
		let align = align0 ?? 's'
		let valign = valign0 ?? 'c'
		let min_w = min_w0 ?? ui.em(12)
		let min_h = min_h0 ?? ui.em((markers ? 2.8 : 1.2))
		ui.clear_box_args()

		let hs = hit(id)
		let click = hs && ui.click

		if (click) {
			ui.focus(id)
			ui.capture(id)
		}

		if (ui.focused(id)) {
			let d = ui.keydown('arrowright') && 1 || ui.keydown('arrowleft') && -1
			if (d) {
				let p = ui.slider_progress(id)
				p += d * (ui.keypressed('shift') ? .01 : .1)
				ui.slider_set_progress(id, p)
			}
		}

		ui.stack()

			ui.m(markers ? ui.sp8() : ui.sp2(), ui.sp2())
			let i = ui_cmd_box(cmd, fr, align, valign,
				min_w,
				min_h,
				id,
				from ?? 0,
				to ?? 1,
				decimals ?? 2,
				0, // p
				markers,
				scale_base ?? 10,
				scales ?? 0,
				0, // thumb_i
				(hs ? SLIDER_HOVER : 0) | (ui.focused(id) ? SLIDER_FOCUSED : 0),
			)

			let thumb_i = ui.stack('', 0, 'l', 't'); ui.end_stack()
			a[i+SLIDER_THUMB_I] = thumb_i - i // make relative

		ui.end_stack()

		if (!markers && (hs || captured(id))) {
			ui.mb(10)
			ui.p(ui.sp2(), ui.sp())
			ui.popup(id+'.popup', 'overlay', thumb_i,
					't', 'c', 0, 0, 'change_side constrain')
				ui.bb_tooltip('info', null, 'light', null, ui.sp05())
				ui.text('', dec(ui.state(id, 'v'), decimals ?? 2))
			ui.end_popup()
		}

	},

	ID: SLIDER_ID,

	translate: function(a, i, dx, dy) {
		a[i+0] += dx
		a[i+1] += dy
		let id = a[i+SLIDER_ID]

		let p = ui.state(id, 'p') ?? .5

		if (captured(id)) {
			let thumb_r = ui.em(ui.slider_thumb_r_em)
			let margin_x = thumb_r
			let x = a[i+0] + margin_x
			let w = a[i+2] - 2*margin_x
			p = clamp((ui.mx - x) / w, 0, 1)
			ui.state(id).p = p
		}

		let from  = a[i+SLIDER_FROM]
		let to    = a[i+SLIDER_TO]
		let v = lerp(p, 0, 1, from, to)
		ui.state(id).v = v

		a[i+SLIDER_P] = round(p * 32767)

		// find thumb's center point and position the thumb anchor stack.
		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]
		let shaft_h = round(ui.em(ui.slider_shaft_h_em))
		let r = round(shaft_h / 2) // shaft corner radius
		let thumb_r = ui.em(ui.slider_thumb_r_em)
		let margin_x = thumb_r
		let thumb_cx = x + margin_x + p * (w - 2 * margin_x)
		let thumb_cy = y + h - 2*thumb_r

		let thumb_i = i + a[i+SLIDER_THUMB_I]

		// HACK: set position of thumb_i manually.
		a[thumb_i+0] = thumb_cx
		a[thumb_i+1] = thumb_cy

	},

	draw: function(a, i) {

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let p       = a[i+SLIDER_P] / 32767
		let markers = a[i+SLIDER_MARKERS]
		let state   = a[i+SLIDER_STATE]
		let hs      = state & SLIDER_HOVER
		let focused = state & SLIDER_FOCUSED

		let shaft_h = round(ui.em(ui.slider_shaft_h_em))
		let r = round(shaft_h / 2) // shaft corner radius
		let thumb_r = ui.em(ui.slider_thumb_r_em)
		let margin_x = thumb_r

		y += h - r - thumb_r
		x += margin_x
		w -= 2 * margin_x

		let thumb_cx = x + p * w
		let thumb_cy = y + r

		// draw shaft
		bg_path(cx, x - r, y, x + w + r, y + 2*r, BORDER_SIDE_ALL, 1000)
		cx.fillStyle = bg_color('bg2', hs ? 'hover' : null)
		cx.fill()

		bg_path(cx, x - r, y, thumb_cx, y + 2*r, BORDER_SIDE_ALL, 1000)
		cx.fillStyle = bg_color('link', hs ? 'hover' : null)
		cx.fill()

		bg_path(cx, x + .5 - r, y + .5, x + w - .5 + r, y + 2*r - .5, BORDER_SIDE_ALL, 1000)
		cx.strokeStyle = border_color('light', null)
		cx.stroke()

		// draw focus ring under thumb
		if (focused) {
			let hsl_color = bg_color_hsl('item', 'item-focused item-selected focused')
			cx.fillStyle = hsl_adjust(hsl_color, 1, 1, 1, .5)
			cx.beginPath()
			cx.arc(thumb_cx, thumb_cy, thumb_r * 2, 0, 2 * PI)
			cx.fill()
		}

		// draw thumb
		cx.fillStyle = fg_color('link', hs ? 'hover' : null)
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

			let hsl_color = fg_color_hsl('label')
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
				cx.fillStyle   = fg_color('text')
				cx.strokeStyle = fg_color('text')

				cx.beginPath()
				cx.moveTo(x, round(y - ui.em(1.0)) + .5)
				cx.lineTo(x, round(y - ui.em(0.6)) + .5)
				cx.stroke()

				let s = dec(v, decimals)
				cx.fillText(s, x, y - ui.em(1.2)) //  - asc - dsc)
			}

		}

	},

})

// calendar ------------------------------------------------------------------

ui.focus_ring = function(id) {
	if (!ui.focused_by_key)
		return
	ui.m(-2)
	ui.popup('', 'overlay', null, 'ic', 's')
		ui.bb(null, null, 1, 'max')
	ui.end_popup()
}

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

	let sel_day = ui.state(id, 'day')
	let hit_day = ui.hit(id, 'day')

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

				if (d == today) {
					ui.bb('marker')
				} else if (d == sel_day) {

					ui.bb('item', calendar_focused
						? 'item-focused item-selected focused'
						: 'item-focused item-selected'
					)

					if (calendar_focused)
						ui.focus_ring()

				} else if (d == hit_day) {
					ui.bb('bg1', 'hover')
				} else if (m % 2) {
					ui.bb('alt')
				}
				//ui.bb('bg2', null, 'ltb', 'intense', null, 1/0)
				ui.pr(ui.em(0.65))
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
			ui.end_stack()

			d_days++
		}
		ui.end_h()
	}
	ui.end_v()
}

ui.calendar = function(id, ranges, fr, align, valign, min_w, min_h) {

	ui.focusable(id)
	let s = ui.state(id)
	let h = s.h ?? 0
	let cell_w = snap(ui.em(2.5), 2)
	let cell_h = snap(ui.em(2.5), 2)
	let cells_w = cell_w * 7
	let cells_h = h * 2

	let sel_day = s.day
	let hit_day = num(ui.hit_match(id+'.day.'))
	let clicked_day
	if (hit_day) {
		ui.hover(id).day = hit_day
		let [dstate] = ui.drag(id+'.day.'+hit_day)
		if (dstate == 'drag') {
			ui.focus(id)
			clicked_day = true
			if (hit_day != sel_day) {
				sel_day = hit_day
				s.day = sel_day
			}
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

		if (ctrl && (ui.keydown('arrowup') || ui.keydown('arrowdown'))) {
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
				s.day = sel_day
				let weeks_from_this_week = days(week(sel_day) - week(time())) / 7
				ui.scroll_to_view_rect(id, 0,
					(weeks_from_this_week + 1) * cell_h,
					cells_w, cell_h)
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
	if (picked) {
		ui.fire(id, 'item_picked', sel_day)
		if (picked_by_key)
			ui.capture_keys()
		ui.relayout()
	}

	ui.v(fr, 0, align, valign, min_w, min_h ?? cell_h * 6)

		let now = time()
		let week0 = week(now)

		// week days header
		ui.h(0)
		ui.bb('bg1', null, 'b', 'intense')
		for (let weekday = 0; weekday < 7; weekday++) {
			let s = weekday_name(day(week0, weekday), 'short', lang()).slice(0, 1).toUpperCase()
			ui.stack('', 0, null, null, cell_w, cell_h)
				ui.pr(rem(1))
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

	return picked ? sel_day : null
}

// image ---------------------------------------------------------------------

function create_image(src, data) { // called from async callback!
	let image = new Image()
	image.src = data
	image.onload = function() {
		let s = ui.state(src)
		s.image = image
		s.data = data
		s.loading = false
		animate() // relayout() won't work as we're not in ui.main() here!
	}
}

ui.box_widget('img', {

	create: function(cmd, src, fr, align, valign, max_min_h, min_w, min_h) {

		// TODO: check expire time and refetch on a timer.
		// TODO: check etag and refetch on a timer.
		keepalive(src)
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

		let i = ui_cmd_box(cmd, fr, align, valign, min_w, min_h,
			src,
			max_min_h ?? 0, // -1=inf
			data ?? '',
		)

		return i

	},

	measure: function(a, i, axis) {
		if (!axis) return // can't impose a width (min_w still works)

		let sw        = a[i+2]
		let src       = a[i+BOX_ARGS+0]
		let max_min_h = a[i+BOX_ARGS+1]

		let image = ui.state(src, 'image')
		if (!image?.complete) return
		let iw = image.width
		let ih = image.height
		if (!iw || !ih) return

		let max_h = (ih / iw) * sw // max h for max w that fits
		let min_h = min(max_h, repl(max_min_h, -1, 1/0))
		let user_min_h = a[i+0+1]
		a[i+0+1] = max(user_min_h, min_h)
		box_measure(a, i, axis)
	},

	position: function(a, i, axis, sx, sw) {
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

			let image = ui.state(src, 'image')
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
	},

	draw: function(a, i) {

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
	},

})

// blit'able -----------------------------------------------------------------

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

// sat-lum square ------------------------------------------------------------

function draw_cross(x0, y0, w, h, hue, sat, lum, alpha) {
	if (sat == null) return
	let x = round(x0 + lerp(sat, 0, 1, 0, w-1)) + .5
	let y = round(y0 + lerp(lum, 1, 0, 0, h-1)) + .5
	let d = 10.5
	cx.strokeStyle = hsl(360-hue, sat, lum > .5 ? 0 : 1, alpha)
	cx.beginPath()
	cx.moveTo(x, y); cx.lineTo(x+d, y)
	cx.moveTo(x, y); cx.lineTo(x-d, y)
	cx.moveTo(x, y); cx.lineTo(x, y+d)
	cx.moveTo(x, y); cx.lineTo(x, y-d)
	cx.stroke()
}

let SAT_LUM_ID      = BOX_ARGS+0
let SAT_LUM_HUE     = BOX_ARGS+1
let SAT_LUM_HIT_SAT = BOX_ARGS+2
let SAT_LUM_HIT_LUM = BOX_ARGS+3
let SAT_LUM_SEL_SAT = BOX_ARGS+4
let SAT_LUM_SEL_LUM = BOX_ARGS+5

ui.box_widget('sat_lum_square', {

	create: function(cmd, id, hue, sat, lum) {

		keepalive(id)
		ui.focusable(id)

		let fr     = fr0     ?? 1
		let align  = align0  ?? 's'
		let valign = valign0 ?? 's'
		let min_w  = min_w0  ?? 0
		let min_h  = min_h0  ?? 0
		ui.clear_box_args()

		hue = hue ?? 0
		sat = sat ?? .5
		lum = lum ?? .5

		ui.state_init(id, 'sat', sat)
		ui.state_init(id, 'lum', lum)

		let [dstate, dx, dy, cs] = ui.drag(id)
		if (dstate == 'drag')
			ui.focus(id)
		if (dstate == 'drag' || dstate == 'dragging' || dstate == 'drop') {
			sat = clamp(cs.sat + dx / (cs.w - 1), 0, 1)
			lum = clamp(cs.lum - dy / (cs.h - 1), 0, 1)
			ui.state(id).sat = sat
			ui.state(id).lum = lum
		}

		if (hit(id) && ui.click) {
			ui.focus(id)
			ui.capture(id)
		}

		if (ui.focused(id)) {
			let lum_step = ui.keydown('arrowup'   ) && 1 || ui.keydown('arrowdown') && -1
			let sat_step = ui.keydown('arrowright') && 1 || ui.keydown('arrowleft') && -1
			if (lum_step) {
				let lum = ui.state(id, 'lum')
				ui.state(id).lum = clamp(lum + (ui.keypressed('shift') ? 0.1 : 1) * 0.1 * lum_step, 0, 1)
			}
			if (sat_step) {
				let sat = ui.state(id, 'sat')
				ui.state(id).sat = clamp(sat + (ui.keypressed('shift') ? 0.1 : 1) * 0.1 * sat_step, 0, 1)
			}
		}

		ui.stack('', fr, align, valign, min_w, min_h)
			let i = ui_cmd_box(cmd, null, null, null, 0, 0,
				id,
				hue,
				hit(id, 'sat'),
				hit(id, 'lum'),
				ui.state(id, 'sat'),
				ui.state(id, 'lum'))
			if (ui.focused(id))
				ui.focus_ring()
		ui.end_stack()
		return i
	},

	draw: function(a, i) {

		let id      = a[i+SAT_LUM_ID]
		let hue     = a[i+SAT_LUM_HUE]
		let hit_sat = a[i+SAT_LUM_HIT_SAT]
		let hit_lum = a[i+SAT_LUM_HIT_LUM]
		let sel_sat = a[i+SAT_LUM_SEL_SAT]
		let sel_lum = a[i+SAT_LUM_SEL_LUM]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let idata = ui.image_data(id, 'square', w, h)

		if (idata.hue != hue) {
			let d = idata.data
			let w = idata.width
			let h = idata.height
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					let sat = lerp(x, 0, w-1, 0, 1)
					let lum = lerp(y, 0, h-1, 1, 0)
					hsl_to_rgb_out(d, (y * w + x) * 4, hue, sat, lum)
				}
			}
			idata.hue = hue
		}

		cx.putImageData(idata, x, y)

		draw_cross(x, y, w, h, hue, hit_sat, hit_lum, 0.3)
		draw_cross(x, y, w, h, hue, sel_sat, sel_lum, 1.0)

	},

	hit: function(a, i) {

		let id = a[i+SAT_LUM_ID]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let hs = hit_rect(x, y, w, h) && hover(id)
		if (hs) {
			hs.sat = clamp(lerp(ui.mx - x, 0, w-1, 0, 1), 0, 1)
			hs.lum = clamp(lerp(ui.my - y, h-1, 0, 0, 1), 0, 1)
			hs.w = w
			hs.h = h
		}

		return !!hs
	},

})

// hue bar -------------------------------------------------------------------

function draw_hue_line(x, y, h, w, hue, alpha) {
	if (hue == null) return
	cx.strokeStyle = hsl(0, 0, 0, alpha)
	cx.beginPath()
	let hue_y = round(lerp(hue, 0, 360, 0, h-1))
	cx.moveTo(x    , y + hue_y + .5)
	cx.lineTo(x + w, y + hue_y + .5)
	cx.stroke()
}

let HUE_BAR_ID      = BOX_ARGS+0
let HUE_BAR_HIT_HUE = BOX_ARGS+1
let HUE_BAR_SEL_HUE = BOX_ARGS+2

ui.box_widget('hue_bar', {

	create: function(cmd, id, hue) {

		keepalive(id)
		ui.focusable(id)
		ui.state_init(id, 'hue', hue)

		let fr     = fr0     ?? 0
		let align  = align0  ?? 's'
		let valign = valign0 ?? 's'
		let min_w  = min_w0  ?? ui.em(1.5)
		let min_h  = min_h0  ?? 0
		ui.clear_box_args()

		let [dstate, dx, dy, cs] = ui.drag(id)
		if (dstate == 'drag')
			ui.focus(id)
		if (dstate == 'drag' || dstate == 'dragging' || dstate == 'drop')
			ui.state(id).hue = round(clamp(
				cs.hue + dy / (cs.h - 1) * 360, 0, 360))

		if (ui.focused(id)) {
			let step = ui.keydown('arrowup') && -1 || ui.keydown('arrowdown') && 1
			if (step) {
				let hue = ui.state(id, 'hue')
				hue = clamp(round(hue + (ui.keypressed('shift') ? 1 : 10) * step), 0, 360)
				ui.state(id).hue = hue
			}
		}

		ui.stack('', fr, align, valign, min_w, min_h)
			let i = ui_cmd_box(cmd, null, null, null, 0, 0,
				id,
				hit(id, 'hue'),
				ui.state(id, 'hue'))
			if (ui.focused(id))
				ui.focus_ring()
		ui.end_stack()
		return i
	},

	draw: function(a, i) {

		let id      = a[i+HUE_BAR_ID]
		let hit_hue = a[i+HUE_BAR_HIT_HUE]
		let sel_hue = a[i+HUE_BAR_SEL_HUE]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let idata = ui.image_data(id, 'bar', w, h)

		if (!idata.ready) {
			let d = idata.data
			let w = idata.width
			let h = idata.height
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					let hue = lerp(y, 0, h-1, 0, 360)
					hsl_to_rgb_out(d, (y * w + x) * 4, hue, 1, .5)
				}
			}
			idata.ready = true
		}

		cx.putImageData(idata, x, y)

		draw_hue_line(x, y, h, w, hit_hue, 0.3)
		draw_hue_line(x, y, h, w, sel_hue, 1.0)

	},

	hit: function(a, i) {

		let id = a[i+HUE_BAR_ID]

		let x = a[i+0]
		let y = a[i+1]
		let w = a[i+2]
		let h = a[i+3]

		let hs = hit_rect(x, y, w, h) && hover(id)
		if (hs) {
			let hue = round(clamp(lerp(ui.my - y, 0, h - 1, 0, 360), 0, 360))
			hs.hue = hue
			hs.h = h
			return true
		}
	},

})

// aspect box ----------------------------------------------------------------

ui.box_ct_widget('aspect_box', {
	create: function(cmd, aspect, fr, align, valign, min_w, min_h) {
		return ui_cmd_box_ct(cmd, fr, align, valign, min_w, min_h,
			aspect ?? 1)
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

// color picker --------------------------------------------------------------

let HEX_RE = /^#[0-9a-f]{6}$/i
let HSL_RE = /^\s*([\d.]+)\s*\u00B0?\s*,\s*([\d.]+)\s*%?\s*,\s*([\d.]+)\s*%?\s*$/

ui.color_picker = function(id, hue, sat, lum) {
	hue = hue ?? 0
	sat = sat ?? .5
	lum = lum ?? .5
	ui.v(1, ui.sp())
		ui.h(0, ui.sp05())
			ui.start_recording()
				ui.hue_bar(id+'.hb', hue)
			let hue_bar = ui.end_recording()
			ui.start_recording()
				ui.aspect_box(1, 1, 's', 't')
					hue = ui.state(id+'.hb', 'hue') ?? hue
					ui.sat_lum_square(id+'.sl', hue, sat, lum)
				ui.end_aspect_box()
			let sl_square = ui.end_recording()
			sat = ui.state(id+'.sl', 'sat') ?? sat
			lum = ui.state(id+'.sl', 'lum') ?? lum
			ui.aspect_box(1, 1, 's', 't')
				ui.bb(':'+hsl(hue, sat, lum))
			ui.end_aspect_box()
			ui.play_recording(sl_square)
			ui.play_recording(hue_bar)
		ui.end_h()
		ui.h(0, ui.sp(), 's')
			ui.label(id+'.input_hsl', 'HSL', .5)
			let s =
				dec(hue)+'\u00B0, '+
				dec(sat*100)+'%, '+
				dec(lum*100)+'%'
			if (!ui.focused(id+'.input_hsl'))
				ui.state(id+'.input_hsl').text = s
			let s1 = ui.input(id+'.input_hsl', s, 1)
			if (ui.focused(id+'.input_hsl') && s1 != s) {
				let m = s1.match(HSL_RE)
				if (m) {
					hue = clamp(num(m[1])      , 0, 360)
					sat = clamp(num(m[2]) / 100, 0, 1)
					lum = clamp(num(m[3]) / 100, 0, 1)
					ui.state(id+'.hb').hue = hue
					ui.state(id+'.sl').sat = sat
					ui.state(id+'.sl').lum = lum
				}
			}
		ui.end_h()
		ui.h(0, ui.sp(), 's')
			ui.label(id+'.input_rgb', 'HEX', .5)
			let hex = hsl_to_rgb_hex(hue, sat, lum)
			// keep the box in sync with hue_bar/sat_lum_square while the user
			// isn't typing in it; only trust its text as an edit while focused.
			if (!ui.focused(id+'.input_rgb'))
				ui.state(id+'.input_rgb').text = hex
			let hex1 = ui.input(id+'.input_rgb', hex, 1)
			if (ui.focused(id+'.input_rgb') && hex1 != hex && HEX_RE.test(hex1)) {
				;[hue, sat, lum] = hex_to_hsl(hex1)
				ui.state(id+'.hb').hue = hue
				ui.state(id+'.sl').sat = sat
				ui.state(id+'.sl').lum = lum
				hex = hex1
			}
		ui.end_h()
	ui.end_v()
	return hex
}

// bg_dots -------------------------------------------------------------------
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
		return ui_cmd(cmd, id, ui.rel_ct_i(), round((speed ?? 1) * 1024))
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

		cx.fillStyle = hsl_adjust(fg_color_hsl('label'), 1, 1, 0.5, 1)
		for (let t of dots) {
			if (t != dots.mouse_dot) {
				cx.beginPath()
				cx.arc(t.x, t.y, 2, 0, Math.PI*2, true)
				cx.closePath()
				cx.fill()
			}
		}

		let c = fg_color_hsl('label')
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

// frame graphs --------------------------------------------------------------

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

frame_graph('frame_time'       , '#fff', 'ms'  , 1, 0,  1/60 * 1000)
frame_graph('frame_make_time'  , '#0f0', 'ms'  , 1, 0,  1/60 * 1000)
frame_graph('frame_layout_time', '#00f', 'ms'  , 1, 0,  1/60 * 1000)
frame_graph('frame_draw_time'  , '#f00', 'ms'  , 1, 0,  1/60 * 1000)
frame_graph('frame_hit_time'   , '#f0f', 'ms'  , 1, 0,  1/60 * 1000)
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
	cx.strokeStyle = g.color ?? fg_color('link')
	cx.stroke()

	if (with_agg) {

		cx.fillStyle = fg_color('label')
		let y1 = y0 + ui.em()
		let x1 = x0 + ui.sp()
		cx.font = font_weight + ' ' + (font_size * .75) + 'px ' + font
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
		ui_cmd_box(cmd, fr, align, valign, min_w, min_h,
			overlapped_frame_graphs)
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
		ui_cmd_box(cmd, fr, align, valign, min_w, min_h,
			name, ui.frame_graphs[name])
		//ui.animate()
	},
	draw: function(a, i) {
		let x0 = a[i+0]
		let y0 = a[i+1]
		let w  = a[i+2]
		let h  = a[i+3]
		let g    = a[i+BOX_CT_ARGS+0]
		if (!g) return
		draw_graph(x0, y0, w, h, g, true)
	},
})

// live-move list element pattern --------------------------------------------

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

	if (1) {
	ui.v(0, 0, 's', 's', 200)
		ui.border('l', 'intense')

		ui.stack('', 0)
			ui.bb('bg2')
			ui.color('text')
			ui.p(ui.sp())
			ui.text('', 'PROFILE', 0, 'l')
		ui.end_stack()
		ui.frame_graph_overlapped(.5)

		ui.stack('', 0)
			ui.bb('bg2')
			ui.color('text')
			ui.p(ui.sp())
			ui.text('', 'ID STATES', 0, 'l')
		ui.end_stack()
		ui.scrollbox('demo_id_states_sb')
			ui.v(0, 0, 's', '[')
				for (let [id, s] of ui._state_map) {
					ui.p(ui.sp(), ui.sp05())
					ui.color('link')
					ui.text('', id, 0, 'l')
					for (let [k, v] of entries(s)) {
						if (v === undefined)
							continue
						if (k == 'frame_gen')
							continue
						ui.ml(ui.sp2())
						ui.h(0, ui.sp())
							let s = isobject(v) || isfunc(v) ? '<'+(typeof v)+'>' : str(v)
							ui.color('text')
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
			ui.color('text')
			ui.p(ui.sp())
			ui.text('', 'HIT STATES', 0, 'l')
		ui.end_stack()
		ui.scrollbox('demo_hit_states_sb', .5)
			ui.v(0, 0, 's', '[')
				for (let [id, s] of ui._hit_state_map) {
					ui.p(ui.sp(), ui.sp05())
					ui.color('link')
					ui.text('', isstr(id) ? id : typeof id, 0, 'l')
					for (let [k, v] of entries(s)) {
						ui.ml(ui.sp2())
						ui.h(0, ui.sp())
							let s = isobject(v) || isfunc(v) ? '<'+(typeof v)+'>' : str(v)
							ui.color('text')
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
					for (let [k, v] of entries(ui.captured(ui.captured_id))) {
						ui.ml(ui.sp2())
						ui.h(1, ui.sp())
							let s = isobject(v) || isfunc(v) ? '<'+(typeof v)+'>' : str(v)
							ui.color('text')
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
}


}()) // module function
