--[[

	Immediate Mode Text User Interface library for Linux terminals.
	Written by Cosmin Apreutesei. Public Domain.

]]

require'glue'
require'fs'
require'sock'
require'signal'
require'termios'

assert(Linux, 'not on Linux')

local DEBUG = true

ui = {}

-- encoding and writing terminal output --------------------------------------

local TERM = env'TERM'
local is_256_color =
	TERM == 'xterm-256color' or
	TERM == 'screen-256color'

local function wr(s)
	return stdout:write(s)
end

local function wrf(s, ...)
	return stdout:write(s:format(...))
end

local dbgf = DEBUG and wrf or noop

--hsl is in (0..360, 0..1, 0..1); rgb is (0..1, 0..1, 0..1)
local function h2rgb(m1, m2, h)
	if h<0 then h = h+1 end
	if h>1 then h = h-1 end
	if h*6<1 then
		return m1+(m2-m1)*h*6
	elseif h*2<1 then
		return m2
	elseif h*3<2 then
		return m1+(m2-m1)*(2/3-h)*6
	else
		return m1
	end
end
local function hsl_to_rgb(h, s, L)
	h = h / 360
	local m2 = L <= .5 and L*(s+1) or L+s-L*s
	local m1 = L*2-m2
	return
		h2rgb(m1, m2, h+1/3),
		h2rgb(m1, m2, h),
		h2rgb(m1, m2, h-1/3)
end
local function hue_to_ansi_color(h)
	if h >= 0 and h < 30 then
		return 1 --red
	elseif h >= 30 and h < 90 then
		return 3 --yellow
	elseif h >= 90 and h < 150 then
		return 2 --green
	elseif h >= 150 and h < 210 then
		return 6 --cyan
	elseif h >= 210 and h < 270 then
		return 4 --blue
	elseif h >= 270 and h < 330 then
		return 5 --magenta
	else
		return 1 --red (for hs from 330 to 360)
	end
end
local function hsl_to_ansi_color(h, s, l)
	if s > .5 then
		local c = hue_to_ansi_color(h)
		return c, l > .5
	elseif l > .5 then --grayscale
		return 7, l > .75 --white
	else
		return 0, l > .25 --black
	end
end
local function hsl_to_256_color(h, s, l)
	if s > 0 then --saturated, use the 6x6x6 color cube.
		local r, g, b = hsl_to_rgb(h, s, l)
		--scale the rgb values to the range of 0-5.
		r = floor(r * 5 + 0.5)
		g = floor(g * 5 + 0.5)
		b = floor(b * 5 + 0.5)
		return 16 + (r * 36) + (g * 6) + b
	elseif l == 0 then --grayscale (24 gray levels) + 0 (black) + 15 (white)
		return 0 --black
	elseif l == 1 then
		return 7, true -- white
	else --gray
		return floor(232 + (intensity / 255) * 23)
	end
end
local function hsl_to_color(h, s, l)
	if is_256_color then
		return hsl_to_256_color(h, s, l)
	else
		return hsl_to_ansi_color(h, s, l)
	end
end

local bg_color, bg_bright
local fg_color, fg_bright

local function wr_bg(h, s, l)
	local color, bright = hsl_to_color(h, s, l)
	if bg_color == color and bg_bright == bright then return end
	wrf(is_256_color and '\27[48;5;%dm' or '\27[%d%dm', bright and '10' or '4', color)
	bg_color, bg_bright = color, bright
end

local function wr_fg(h, s, l)
	local color, bright = hsl_to_color(h, s, l)
	if fg_color == color and fg_bright == bright then return end
	wrf(is_256_color and '\27[38;5;%dm' or '\27[%d%dm', bright and '9' or '3', color)
	fg_color, fg_bright = color, bright
end

local function gotoxy(x, y)
	wrf('\27[%d;%dH', y, x)
end

-- reading and decoding terminal input ---------------------------------------

local b = new'char[128]'
local function rd()
	stdin:readn(b, 1)
	if DEBUG then dbgf(' rd %s %s\r\n', b[0], char(b[0])) end
	return b[0]
end

local function readto(c1, c2)
	c1 = byte(c1)
	c2 = byte(c2)
	for i = 0,127 do
		local len, err = stdin:read(b+i, 1)
		assert(len, err)
		assert(len > 0, 'eof')
		if b[i] == c1 or b[i] == c2 then
			if DEBUG then dbgf('  readto %s or %s: %d "%s" %s\r\n',
				char(c1), char(c2), i, str(b, i+1):gsub('\\', '\\\\'), err or '') end
			return str(b, i+1)
		end
	end
	assert(false)
end

local function wait_rd(timeout)
	stdin:settimeout(timeout)
	local len, err = stdin:try_read(b, 1)
	stdin:settimeout(nil)
	if not len and err == 'timeout' then
		if DEBUG then dbgf(' %s\r\n', 'timeout') end
		return nil
	else
		assert(len == 1)
	end
	if DEBUG then dbgf(' wait_rd %s %s\r\n', b[0], char(b[0])) end
	return b[0]
end

key = nil
scroll = nil
mx, my = nil
mstate, ldown, lup, rdown, rup, mdown, mup = nil

local function read_input() --read keyboard and mouse input in raw mode
	key = nil
	scroll = nil
	local c = rd()
	if c == 27 then --\033
		c = wait_rd(.01)
		if not c then
			key = 'esc'
		elseif c == 91 then --[
			c = rd()
			if     c == 65 then
				key = 'up'
			elseif c == 66 then
				key = 'down'
			elseif c == 67 then
				key = 'right'
			elseif c == 68 then
				key = 'left'
			elseif c == 49 then
				c = rd()
				if     c == 49 then if rd() == 126 then key = 'f1' end
				elseif c == 50 then if rd() == 126 then key = 'f2' end
				elseif c == 51 then if rd() == 126 then key = 'f3' end
				elseif c == 52 then if rd() == 126 then key = 'f4' end
				elseif c == 53 then if rd() == 126 then key = 'f5' end
				elseif c == 55 then if rd() == 126 then key = 'f6' end
				elseif c == 56 then if rd() == 126 then key = 'f7' end
				elseif c == 57 then if rd() == 126 then key = 'f8' end
				elseif c == 126 then key = 'home'
				end
			elseif c == 50 then
				c = rd()
				if     c == 48 then if rd() == 126 then key = 'f9' end
				elseif c == 49 then if rd() == 126 then key = 'f10' end
				elseif c == 51 then if rd() == 126 then key = 'f11' end
				elseif c == 52 then if rd() == 126 then key = 'f12' end
				elseif c == 126 then key = 'insert'
				end
			elseif c == 51 then if rd() == 126 then key = 'delete' end
			elseif c == 52 then if rd() == 126 then key = 'end' end
			elseif c == 53 then if rd() == 126 then key = 'pageup' end
			elseif c == 54 then if rd() == 126 then key = 'pagedown' end
			elseif c == 60 then --<
				local s = readto('M', 'm')
				if DEBUG then dbgf('   "%s"\r\n', s:gsub('\\', '\\\\')) end
				local b, smx, smy, st = s:match'^(%d+);(%d+);(%d+)([Mm])$'
				assertf(b, 'invalid mouse event: "%s"', s:gsub('\\', '\\\\'))
				mx = num(smx)
				my = num(smy)
				if b == '0' then
					ldown = st == 'M'
					lup   = st == 'm'
					mstate = b..st
				elseif b == '2' then
					rdown = st == 'M'
					ldown = st == 'm'
					mstate = b..st
				elseif b == '1' then
					mdown = st == 'M'
					mup   = st == 'm'
					mstate = b..st
				elseif b == '64' then
					scroll = -1
				elseif b == '65' then
					scroll = 1
				end
				if DEBUG then dbgf('mouse %d %d %s %s\r\n', mx, my, b, st) end
			end
		end
	elseif c == 127 then
		key = 'backspace'
	elseif c >= 32 and c <= 126 then
		key = char(c)
	elseif c == 13 then
		key = 'enter'
	else
		key = c
	end
	if DEBUG and key then dbgf('key %s\r\n', key) end
end

------------------------------------------------------------------------------
-- imgui ---------------------------------------------------------------------
------------------------------------------------------------------------------

-- command state -------------------------------------------------------------

--[[
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
]]

-- command recordings --------------------------------------------------------

--local rec_freelist = array_freelist()

function rec()
	local a = {} --rec_freelist.alloc()
	return a
end

function free_rec(a)
	--a.length = 0
	--if (a.nohit_set)
	--	a.nohit_set.clear()
	--rec_freelist.free(a)
end

local rec_stack = {}

ui.start_recording = function()
	local a1 = rec()
	add(rec_stack, a)
	a = a1
end

ui.end_recording = function()
	local a1 = a
	a = del(rec_stack)
	return a1
end

ui.play_recording = function(a1)
	extend(a, a1)
	--free_rec(a1)
end

function rec_stack_check()
	assert(#rec_stack == 0, 'recordings left unplayed')
end

-- secondary command recordings ----------------------------------------------

local recs = {}
local rec_i

function begin_rec()
	local a0 = a
	a = rec()
	ui.a = a
	rec_i = #recs
	add(recs, a)
	return a0
end

function end_rec(a0)
	local a1 = a
	a = a0
	return a1
end

function free_recs()
	--for _,a in ipairs(recs) do
	--	free_rec(a)
	--recs.length = 0
	recs = {}
end

-- current command recording -------------------------------------------------

local a --current recording

-- Format of a command recording array:
--
--  next_i, cmd, arg1..n, prev_i; next_i, cmd, arg1..n, prev_i; ...
--    |            ^        |                    ^
--    |            +--------+                    |
--    +------------------------------------------+
--
-- With next_i and prev_i we can walk back and forth between commands,
-- always landing at the command's arg#1. From the arg#1 index then we have
-- the command code at a[i-1], next command's arg#1 at i+a[i-2] and prev
-- command's arg#1 at i+a[i-3]. To walk the command array as a tree, we check
-- when a container starts with `a[i-1] & 1` (all containers have even codes)
-- and when it ends with `a[i-1] == 'end'` (all containers end with the same
-- "end" command). To skip all container's children and jump to the next
-- sibling we use cmd_next_ext_i(). To go back to the container's command
-- from its "end" command, we use i+a[i].
-- NOTE: Using relative indexes everywhere allows creating command recordings
-- that are relocatable, i.e. can be moved into other recordings without
-- having to reoffset the indexes.

local function cmd_next_i(a, i) return i+a[i-2] end --index of next cmd
local function cmd_prev_i(a, i) return i+a[i-3] end --index of prev cmd
local function cmd_last_i(a) return cmd_prev_i(a, #a+3) end --index of last command in a
local function cmd_arg_end_i(a, i) return cmd_next_i(a, i)-3 end --index after the last arg

function ui_cmd(cmd, ...)
	local i = #a+3 -- abs index of this cmd's arg#1
	local next_i = #args+4 -- rel index of next cmd's arg#1
	local prev_i = -next_i -- rel index of this cmd's arg#1, rel to next cmd's arg#1
	add(a, next_i)
	add(a, cmd)
	for i = 1, select('#', ...) do
		add(a, (select(i, ...)))
	end
	add(a, prev_i)
	return i
end
ui.cmd = ui_cmd

-- z-layers ------------------------------------------------------------------

local layer_map = {} -- {name->layer}
local layer_arr = {} -- {layer1,...} in creation order

local layers = {} -- {layer1,...} in paint order

function ui_layer(name, index)
	if not name then
		return current_layer
	end
	local layer = layer_map[name]
	if not layer then
		layer = {}
		layer.name = assert(name)
		if index ~= null then
			insert(layers, index, layer)
		end
		layer_map[name] = layer
		add(layer_arr, layer)
		layer.i = layer_arr.length
		if not layer.indexes then
			layer.indexes = {} -- [rec1_i, ct1_i, z_index1, rec2_i, ct2_i, z_index2, ...]
		end
	end
	return layer
end
ui.layer = ui_layer

function clear_layers()
	for _,layer in ipairs(layer_arr) do
		layer.indexes = {}
	end
end

local layer_base =
ui_layer('base'   , 0)
ui_layer('window' , 1) -- modals
-- all these below must be temporary to work with modals!
ui_layer('overlay', 2) -- temporary overlays that must show behind the dragged object.
ui_layer('tooltip', 3)
ui_layer('open'   , 4) -- dropdowns, must cover tooltips
ui_layer('handle' , 5) -- dragged object

local layer_stack = {} -- {layer1_i, ...}
local current_layer    -- set while building
local current_layer_i  -- set while drawing

function begin_layer(layer, ct_i, z_index)
	layer_stack.push(current_layer)
	-- NOTE: only adding the cmd to the layer if the current layer actually
	-- changes otherwise it will be drawn twice!
	-- TODO: because of the condition below, start_recording on a layer and
	-- play_recording on another layer is not supported: either support it
	-- or prevent it!
	if layer == current_layer then
		return
	end
	current_layer = layer
	set_layer(layer, ct_i, z_index)
	return true
end

function end_layer()
	current_layer = del(layer_stack)
end

function layer_stack_check()
	if #layer_stack then
		for _,layer in ipairs(layer_stack) do
			debug('layer', layer.name, 'not closed')
		end
		assert(false)
	end
end

-- rendering phases ----------------------------------------------------------

ui.widget = function(cmd, t, is_ct)
	local create = t.create
	if create then
		function wrapper(...)
			return create(cmd, ...)
		end
		ui[cmd] = wrapper
		local setstate = t.setstate
		if t.setstate then
			function wrapper(...)
				return create(cmd, ...)
			end
			ui[cmd+'_state'] = wrapper
		end
		return wrapper
	else
		return cmd
	end
end

-- box widgets ---------------------------------------------------------------

function ui_cmd_box(cmd, fr, align, valign, min_w, min_h, ...)
	return ui_cmd(cmd,
		min_w or 0, -- min_w in measuring phase; x in positioning phase
		min_h or 0, -- min_h in measuring phase; y in positioning phase
		0, --children's min_w in measuring phase; w in positioning phase
		0, --children's min_h in measuring phase; h in positioning phase
		round(max(0, fr or 1) * 1024),
		align or 's',
		valign or 's',
		...
	)
end
ui.cmd_box = ui_cmd_box

-- measuring phase (per-axis) ------------------------------------------------

-- walk the element tree bottom-up and call the measure function for each
-- element that has it. uses ct_stack for recursion and containers'
-- measure_end callback to do the work.

function measure_rec(a, axis)
	local i, n = 2, #a
	while i < n do
		local cmd = a[i-1]
		local measure_f = cmd.measure
		if measure_f then
			measure_f(a, i, axis)
		end
		i = cmd_next_i(a, i)
	end
end

-- positioning phase (per-axis) ----------------------------------------------

-- walk the element tree top-down, and call the position function for each
-- element that has it. recursive, uses call stack to pass ct_i and ct_w.

function position_rec(a, axis, ct_w)
	local i, n = 2, #a
	while i < n do
		local cmd = a[i-1]
		local position_f = cmd.position
		if position_f then
			local min_w = a[i+2+axis]
			position_f(a, i, axis, 0, max(min_w, ct_w))
		end
		i = cmd_next_ext_i(a, i)
	end
end

-- translation phase ---------------------------------------------------------

-- do scrolling and popup positioning and offset all boxes (top-down, recursive).

function translate_rec(a, x, y)
	local i, n = 2, #a
	while i < n do
		local cmd = a[i-1]
		local translate_f = cmd.translate
		if translate_f then
			translate_f(a, i, x, y)
		end
		i = cmd_next_ext_i(a, i)
	end
end

-- drawing phase -------------------------------------------------------------

local theme_stack = {}

function draw_cmd(a, i, recs)
	local next_ext_i = cmd_next_ext_i(a, i)
	while i < next_ext_i do
		local cmd = a[i-1]
		if cmd.is_ct then
			add(theme_stack, theme)
		elseif cmd.is_end then
			theme = del(theme_stack)
		end
		local draw_f = cmd.draw
		if draw_f and draw_f(a, i, recs) then
			i = cmd_next_ext_i(a, i)
			if cmd.is_ct then
				theme = del(theme_stack)
			end
		else
			i = i + a[i-2] --next_i
		end
	end
end

function draw_layer(layer_i, indexes, recs)
	local prev_layer_i = current_layer_i
	--[[global]] current_layer_i = layer_i
	for k = 0, #indexes, 3 do
		reset_canvas()
		local rec_i = indexes[k]
		local i     = indexes[k+1]
		local a = recs[rec_i]
		draw_cmd(a, i, recs)
	end
	current_layer_i = prev_layer_i
end

function draw_layers(layers, recs)
	for _,layer in ipairs(layers) do
		draw_layer(layer.i, layer.indexes, recs)
	end
end

function draw_frame(recs, layers)
	local theme_stack_length0 = #theme_stack
	add(theme_stack, theme)
	theme = themes[ui.default_theme]

	draw_layers(layers, recs)
	assert(current_layer_i == nil)

	theme = del(theme_stack)
	assert(#theme_stack == theme_stack_length0)
end

-- hit-testing phase ---------------------------------------------------------

--local hit_state_map_freelist = map_freelist()
local hit_state_maps = {} -- {id->map}

ui._hit_state_maps = hit_state_maps

function hovers(id, k)
	if not id then return end
	local m = hit_state_maps[id]
	return k and m and m[k] or m
end
ui.hovers = hovers

function hit(id, k)
	if ui.captured_id then --unavailable while captured
		return
	end
	return hovers(id, k)
end
ui.hit = hit

--[[
function hit_match(prefix)
	for (let [id] of hit_state_maps)
		if (id.startsWith(prefix))
			return id.substring(prefix.length)
}
ui.hit_match = hit_match

function hover(id) {
	if (!id) return
	let m = hit_state_maps.get(id)
	if (!m) {
		m = hit_state_map_freelist.alloc()
		hit_state_maps.set(id, m)
	}
	return m
}
ui.hover = hover
]]

function hit_layer(layer, recs)
	--[[global]] current_layer = layer
	--iterate layer's cointainers in reverse order.
	local indexes = layer.indexes
	for k = #indexes-3, 1, -3 do
		reset_canvas()
		local rec_i = indexes[k]
		local i     = indexes[k+1]
		local a = recs[rec_i]
		local hit_f = hittest[a[i-1]]
		if hit_f and not a.nohit_set[i] and hit_f(a, i, recs) then
			return true
		end
	end
end

function hit_layers(layers, recs)
	--iterate layers in reverse order.
	for j = #layers, 1, -1 do
		local layer = layers[j]
		if layer.layers and #layer.layers > 0 then
			if hit_layers(layer.layers, recs) then
				return true
			end
		end
		if hit_layer(layer, recs) then
			return true
		end
	end
end

function hit_frame(recs, layers)

	hit_state_maps = {}

	if not ui.mx then
		return
	end

	hit_layers(layers, recs)
	current_layer = nil

end

--imgui loop -----------------------------------------------------------------

local want_relayout

ui.relayout = function()
	want_relayout = true
end

function layout_rec(a, x, y, w, h)
	reset_canvas()

	-- x-axis
	measure_rec(a, 0)
	ct_stack_check()
	position_rec(a, 0, w)

	-- y-axis
	measure_rec(a, 1)
	ct_stack_check()
	position_rec(a, 1, h)

	translate_rec(a, x, y)
end

function frame_end_check()
	ct_stack_check()
	layer_stack_check()
	scope_stack_check()
	rec_stack_check()
end

ui.frame_changed = noop

ui.focusables = {}

local function redraw()

	wrf'\27[0m' --reset all styles

	bg_color, bg_bright = hsl_to_color(0, 0, 0)
	fg_color, fg_bright = hsl_to_color(0, 0, 1)

	--[[
	if key then
		wrf('key: %s\r\n', key)
	elseif scroll or mstate then
		if mx then gotoxy(mx, my) end
		wrf('mouse: %d,%d %s\r\n', mx, my,
			scroll == -1 and 'scroll-up' or scroll == 1 and 'scroll-down'
			or mstate)
	end
	]]

	local relayout_count = 0
	while 1 do

		want_relayout = false

		hit_frame(recs, layers)

		if key == 'tab' then
			local i = indexof(ui.focusables, ui.focused_id)
			if i then
				--TODO
				--local next_i = (i + (shift ? -1 : 1)) % ui.focusables.length
				local id = ui.focusables[next_i]
				ui.focus(id, true)
			end
		end
		ui.focusables = {}

		--measure_req_all()

		clear_layers()
		free_recs()

		t0 = clock()

		reset_canvas()

		begin_rec()
		local i = ui.stack()
			begin_layer(layer_base, i)
			assert(rec_i == 0)
			ui.main()
		ui.end_stack()
		end_layer()
		frame_end_check()

		local a = end_rec()
		layout_rec(a, 0, 0, screen_w, screen_h)

		id_state_gc()

		if not want_relayout then
			t0 = clock()

			wr'\27[2J' --clear screen

			draw_frame(recs, layers)

			ui.frame_changed()
		end

		reset_canvas()

		if ui.clickup then
			ui.captured_id = nil
			capture_state = {}
		end

		reset_pointer_state()

		key = nil
		focusing_id = nil

		if not want_relayout then
			break
		end
		relayout_count = relayout_count + 1
		if relayout_count > 2 then
			wr'relayout loop detected\r\n'
			break
		end
	end

end

--main -----------------------------------------------------------------------

tc_set_raw_mode()
assert(tc_get_raw_mode(), 'could not put terminal in raw mode')

wr'\027[?1000h' --enable mouse tracking
wr'\027[?1003h' --enable mouse move tracking
wr'\027[?1006h' --enable SGR mouse tracking
wr'\27[?25l' --hide cursor

screen_w, screen_h = tc_get_window_size()

--signals thread to capture Ctrl+C and terminal window resize events.
resume(thread(function()
	signal_block'SIGWINCH SIGINT'
	local sigf = signal_file('SIGWINCH SIGINT', true)
	while 1 do
		local si = sigf:read_signal()
		if si.signo == SIGWINCH then
			screen_w, screen_h = tc_get_window_size()
			redraw()
		elseif si.signo == SIGINT then
			stop()
			break
		end
	end
end))

--input thread
resume(thread(function()
	while 1 do
		read_input()
		--redraw()
		key = nil
		scroll = nil
	end
end))

start() --start the epoll loop (stopped by ctrl+C or a call to stop()).

wr'\027[?1006l' --stop SGR mouse events
wr'\027[?1003l' --stop mouse move events
wr'\027[?1000l' --stop mouse events
wr'\27[?25h' --show cursor

tc_reset() --reset terminal
