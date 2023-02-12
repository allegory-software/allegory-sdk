--[=[

	Math for 2D rectangles defined as (x, y, w, h) where w > 0 and h > 0.
	Written by Cosmin Apreutesei. Public Domain.

DEFINITIONS

	A "1D segment" is defined as (x1, x2); a "side" is defined as (x1, x2, y)
	so it's a segment + an altitude. the corners are (x1, y1, x2, y2), where
	(x1, y1) is the top-left corner and (x2, y2) is the bottom-right corner.

PROCEDURAL API

	rect_normalize(x, y, w, h) -> x, y, w, h
	rect_align(w, h, halign, valign, bx, by, bw, bh) -> x, y, w, h
	rect_vsplit(i, sh, x, y, w, h) -> x, y, w, h
	rect_hsplit(i, sw, x, y, w, h) -> x, y, w, h
	rect_nsplit(i, n, direction, x, y, w, h) -> x, y, w, h
	rect_offset(d, x, y, w, h) -> x, y, w, h
	rect_fit(w, h, bw, bh) -> w, h
	rect_hit(x0, y0, x, y, w, h) -> t|f
	rect_hit_edges(x0, y0, d, x, y, w, h) -> hit, left, top, right, bottom
	rect_overlapping(x1, y1, w1, h1, x2, y2, w2, h2) -> t|f
	rect_clip(x, y, w, h, x0, y0, w0, h0) -> x1, y1, w1, h1
	rect_bounding_box(x1, y1, w1, h1, x2, y2, w2, h2) -> x, y, w, h
	rect_scroll_to_view(x, y, w, h, pw, ph, sx, sy) -> sx, sy

]=]

local min, max, abs = math.min, math.max, math.abs

--normalization

local function normalize_seg(x1, x2) --make a 1D vector positive
	return min(x1, x2), max(x1, x2)
end

function rect_normalize(x, y, w, h) --make a box have positive size
	local x1, x2 = normalize_seg(x, x+w)
	local y1, y2 = normalize_seg(y, y+h)
	return x1, x2-x1, y1, y2-y1
end

--layouting

function rect_align(w, h, halign, valign, bx, by, bw, bh) --align a box in another box
	local x =
		halign == 'center' and (2 * bx + bw - w) / 2 or
		halign == 'left' and bx or
		halign == 'right' and bx + bw - w
	local y =
		valign == 'center' and (2 * by + bh - h) / 2 or
		valign == 'top' and by or
		valign == 'bottom' and by + bh - h
	return x, y, w, h
end

--slice a box horizontally at a certain height and return the i'th box.
--if sh is negative, slicing is done from the bottom side.
function rect_vsplit(i, sh, x, y, w, h)
	if sh < 0 then
		sh = h + sh
		i = 3 - i
	end
	if i == 1 then
		return x, y, w, sh
	else
		return x, y + sh, w, h - sh
	end
end

--slice a box vertically at a certain width and return the i'th box.
--if sw is negative, slicing is done from the right side.
function rect_hsplit(i, sw, x, y, w, h)
	if sw < 0 then
		sw = w + sw
		i = 3 - i
	end
	if i == 1 then
		return x, y, sw, h
	else
		return x + sw, y, w - sw, h
	end
end

--slice a box in n equal slices, vertically or horizontally, and return the i'th box.
function rect_nsplit(i, n, direction, x, y, w, h) --direction = 'v' or 'h'
	assert(direction == 'v' or direction == 'h', 'invalid direction')
	if direction == 'v' then
		return x, y + (i - 1) * h / n, w, h / n
	else
		return x + (i - 1) * w / n, y, w / n, h
	end
end

function rect_offset(d, x, y, w, h) --offset a rectangle by d (outward if d is positive)
	return x - d, y - d, w + 2*d, h + 2*d
end

--fit box (w, h) into (bw, bh) preserving aspect ratio. use align() to position the box.
function rect_fit(w, h, bw, bh)
	if w / h > bw / bh then
		return bw, bw * h / w
	else
		return bh * w / h, bh
	end
end

--hit testing

function rect_hit(x0, y0, x, y, w, h) --check if a point (x0, y0) is inside rect (x, y, w, h)
	return x0 >= x and x0 <= x + w and y0 >= y and y0 <= y + h
end

local hit = rect_hit
function rect_hit_edges(x0, y0, d, x, y, w, h) --returns hit, left, top, right, bottom
	if hit(x0, y0, offset(d, x, y, 0, 0)) then
		return true, true, true, false, false
	elseif hit(x0, y0, offset(d, x + w, y, 0, 0)) then
		return true, false, true, true, false
	elseif hit(x0, y0, offset(d, x, y + h, 0, 0)) then
		return true, true, false, false, true
	elseif hit(x0, y0, offset(d, x + w, y + h, 0, 0)) then
		return true, false, false, true, true
	elseif hit(x0, y0, offset(d, x, y, w, 0)) then
		return true, false, true, false, false
	elseif hit(x0, y0, offset(d, x, y + h, w, 0)) then
		return true, false, false, false, true
	elseif hit(x0, y0, offset(d, x, y, 0, h)) then
		return true, true, false, false, false
	elseif hit(x0, y0, offset(d, x + w, y, 0, h)) then
		return true, false, false, true, false
	end
	return false, false, false, false, false
end

--box overlapping test

local function overlap_seg(ax1, ax2, bx1, bx2) --two 1D segments overlap
	return not (ax2 < bx1 or bx2 < ax1)
end

function rect_overlapping(x1, y1, w1, h1, x2, y2, w2, h2)
	return
		overlap_seg(x1, x1+w1, x2, x2+w2) and
		overlap_seg(y1, y1+h1, y2, y2+h2)
end

--box intersection

--intersect two positive 1D segments
local function intersect_segs(ax1, ax2, bx1, bx2)
	return max(ax1, bx1), min(ax2, bx2)
end

function rect_clip(x1, y1, w1, h1, x2, y2, w2, h2)
	--intersect on each dimension
	local x1, x2 = intersect_segs(x1, x1+w1, x2, x2+w2)
	local y1, y2 = intersect_segs(y1, y1+h1, y2, y2+h2)
	--clamp size
	local w = max(x2-x1, 0)
	local h = max(y2-y1, 0)
	return x1, y1, w, h
end

--box bounding box

function rect_bounding_box(x1, y1, w1, h1, x3, y3, w2, h2)
	if w1 == 0 or h1 == 0 then
		return x3, y3, w2, h2
	elseif w2 == 0 or h2 == 0 then
		return x1, y1, w1, h1
	end
	local x2 = x1 + w1
	local y2 = y1 + h1
	local x4 = x3 + w2
	local y4 = y3 + h2
	return rect(
		min(x1, x2, x3, x4),
		min(y1, y2, y3, y4),
		max(x1, x2, x3, x4),
		max(y1, y2, y3, y4))
end

--move box from (sx, sy) inside (pw, ph) so that it becomes fully visible.
function rect_scroll_to_view(x, y, w, h, pw, ph, sx, sy)
	local min_sx = -x
	local min_sy = -y
	local max_sx = -(x + w - pw)
	local max_sy = -(y + h - ph)
	return
		min(max(sx, min_sx), max_sx),
		min(max(sy, min_sy), max_sy)
end
