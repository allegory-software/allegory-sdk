--[=[

	Math for 2D rectangles defined as (x, y, w, h) where w > 0 and h > 0.
	Written by Cosmin Apreutesei. Public Domain.

DEFINITIONS

	A "1D segment" is defined as (x1, x2); a "side" is defined as (x1, x2, y)
	so it's a segment + an altitude. the corners are (x1, y1, x2, y2), where
	(x1, y1) is the top-left corner and (x2, y2) is the bottom-right corner.

PROCEDURAL API

	box2d.corners(x, y, w, h) -> x1, y1, x2, y2
	box2d.rect(x1, y1, x2, y2) -> x, y, w, h
	box2d.normalize(x, y, w, h) -> x, y, w, h
	box2d.align(w, h, halign, valign, bx, by, bw, bh) -> x, y, w, h
	box2d.vsplit(i, sh, x, y, w, h) -> x, y, w, h
	box2d.hsplit(i, sw, x, y, w, h) -> x, y, w, h
	box2d.nsplit(i, n, direction, x, y, w, h) -> x, y, w, h
	box2d.translate(dx, dy, x, y, w, h) -> x, y, w, h
	box2d.offset(d, x, y, w, h) -> x, y, w, h
	box2d.fit(w, h, bw, bh) -> w, h
	box2d.hit(x0, y0, x, y, w, h) -> t|f
	box2d.hit_edges(x0, y0, d, x, y, w, h) -> hit, left, top, right, bottom
	box2d.snap_edges(d, x, y, w, h, rectangles[, opaque]) -> x, y, w, h
	box2d.snap_pos(d, x, y, w, h, rectangles[, opaque]) -> x, y, w, h
	box2d.snapped_edges(d, x1, y1, w1, h1, x2, y2, w2, h2[, opaque]) -> snapped, left, top, right, bottom
	box2d.overlapping(x1, y1, w1, h1, x2, y2, w2, h2) -> t|f
	box2d.clip(x, y, w, h, x0, y0, w0, h0) -> x1, y1, w1, h1
	box2d.bounding_box(x1, y1, w1, h1, x2, y2, w2, h2) -> x, y, w, h
	box2d.scroll_to_view(x, y, w, h, pw, ph, sx, sy) -> sx, sy

OOP API

	box2d(x, y, w, h) -> box               create a new box object
	box.x, box.y, box.w, box.h             get box coordinates (for reading and writing)
	box:rect() -> x, y, w, h               get coordinates unpacked
	box() -> x, y, w, h                    get coordinates unpacked
	box:corners() -> x1, y1, x2, y2        left,top and right,bottom corners
	box:align(halign, valign, parent_box) -> box   align box
	box:vsplit(i, sh) -> box               split box vertically
	box:hsplit(i, sw) -> box               split box horizontally
	box:nsplit(i, n, direction) -> box     split box in equal parts
	box:translate(dx, dy) -> box           move box by (dx, dy)
	box:offset(d) -> box                   offset by d (outward if d is positive)
	box:fit(parent_box, halign, valign) -> box     enlarge/shrink-to-fit and align
	box:hit(x0, y0) -> t|f                 hit test
	box:hit_edges(x0, y0, d) -> hit, left, top, right, bottom   hit test for edges
	box:snap_edges(d, boxes) -> box        snap the edges to a list of boxes
	box:snap_pos(d, boxes) -> box          snap the position
	box:snapped_edges(d) -> ...            snap edges at distance d
	box:overlapping(box) -> t|f            overlapping test
	box:clip(box) -> box                   clip box to fit inside another box
	box:join(box)                          make box the bounding box of itself and another box

]=]

local min, max, abs = math.min, math.max, math.abs

--representation forms

local function corners(x, y, w, h)
	return x, y, x + w, y + h
end

local function rect(x1, y1, x2, y2)
	return x1, y1, x2 - x1, y2 - y1
end

--normalization

local function normalize_seg(x1, x2) --make a 1D vector positive
	return min(x1, x2), max(x1, x2)
end

function normalize(x, y, w, h) --make a box have positive size
	local x1, x2 = normalize_seg(x, x+w)
	local y1, y2 = normalize_seg(y, y+h)
	return x1, x2-x1, y1, y2-y1
end

--layouting

local function align(w, h, halign, valign, bx, by, bw, bh) --align a box in another box
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
local function vsplit(i, sh, x, y, w, h)
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
local function hsplit(i, sw, x, y, w, h)
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
local function nsplit(i, n, direction, x, y, w, h) --direction = 'v' or 'h'
	assert(direction == 'v' or direction == 'h', 'invalid direction')
	if direction == 'v' then
		return x, y + (i - 1) * h / n, w, h / n
	else
		return x + (i - 1) * w / n, y, w / n, h
	end
end

local function translate(dx, dy, x, y, w, h) --move a box
	return x + dx, y + dy, w, h
end

local function offset(d, x, y, w, h) --offset a rectangle by d (outward if d is positive)
	return x - d, y - d, w + 2*d, h + 2*d
end

--fit box (w, h) into (bw, bh) preserving aspect ratio. use align() to position the box.
local function fit(w, h, bw, bh)
	if w / h > bw / bh then
		return bw, bw * h / w
	else
		return bh * w / h, bh
	end
end

--hit testing

local function hit(x0, y0, x, y, w, h) --check if a point (x0, y0) is inside rect (x, y, w, h)
	return x0 >= x and x0 <= x + w and y0 >= y and y0 <= y + h
end

local function hit_edges(x0, y0, d, x, y, w, h) --returns hit, left, top, right, bottom
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

local function overlapping(x1, y1, w1, h1, x2, y2, w2, h2)
	return
		overlap_seg(x1, x1+w1, x2, x2+w2) and
		overlap_seg(y1, y1+h1, y2, y2+h2)
end

--box intersection

local function clip(x1, y1, w1, h1, x2, y2, w2, h2)
	--intersect on each dimension
	local x1, x2 = intersect_segs(x1, x1+w1, x2, x2+w2)
	local y1, y2 = intersect_segs(y1, y1+h1, y2, y2+h2)
	--clamp size
	local w = max(x2-x1, 0)
	local h = max(y2-y1, 0)
	return x1, y1, w, h
end

--box bounding box

local function bounding_box(x1, y1, w1, h1, x3, y3, w2, h2)
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
local function scroll_to_view(x, y, w, h, pw, ph, sx, sy)
	local min_sx = -x
	local min_sy = -y
	local max_sx = -(x + w - pw)
	local max_sy = -(y + h - ph)
	return
		min(max(sx, min_sx), max_sx),
		min(max(sy, min_sy), max_sy)
end

--box class ------------------------------------------------------------------

local box = {}
local box_mt = {__index = box}

local function new(x, y, w, h)
	return setmetatable({x = x, y = y, w = w, h = h}, box_mt)
end

function box:rect()
	return self.x, self.y, self.w, self.h
end

box_mt.__call = box.rect

function box:corners()
	return corners(self())
end

function box:align(halign, valign, parent_box)
	return new(align(r.w, r.h, halign, valign, parent_box()))
end

function box:vsplit(i, sh)
	return new(vsplit(i, sh, self()))
end

function box:hsplit(i, sw)
	return new(hsplit(i, sw, self()))
end

function box:nsplit(i, n, direction)
	return new(nsplit(i, n, direction, self()))
end

function box:translate(dx, dy)
	return new(translate(dx, dy, self()))
end

function box:offset(d) --offset a rectangle by d (outward if d is positive)
	return new(offset(d, self()))
end

function box:fit(parent_box, halign, valign)
	local w, h = fit(r.w, r.h, parent_box.w, parent_box.h)
	local x, y = align(w, h, halign or 'center', valign or 'center', parent_box())
	return new(x, y, w, h)
end

function box:hit(x0, y0)
	return hit(x0, y0, self())
end

function box:hit_edges(x0, y0, d)
	return hit_edges(x0, y0, d, self())
end

function box:snap_edges(d, rectangles)
	local x, y, w, h = self()
	return new(snap_edges(d, x, y, w, h, rectangles))
end

function box:snap_pos(d, rectangles)
	local x, y, w, h = self()
	return new(snap_pos(d, x, y, w, h, rectangles))
end

function box:snapped_edges(d)
	return snapped_edges(d, self())
end

function box:overlapping(box)
	return overlapping(self.x, self.y, self.w, self.h, box:rect())
end

function box:clip(box)
	return new(clip(self.x, self.y, self.w, self.h, box:rect()))
end

function box:join(box)
	self.x, self.y, self.w, self.h =
		bounding_box(self.x, self.y, self.w, self.h, box:rect())
end

local box_module = {
	--representation forms
	corners = corners,
	rect = rect,
	--normalization
	normalize = normalize,
	--layouting
	align = align,
	vsplit = vsplit,
	hsplit = hsplit,
	nsplit = nsplit,
	translate = translate,
	offset = offset,
	fit = fit,
	--hit testing
	hit = hit,
	hit_edges = hit_edges,
	--snapping
	snap_edges = snap_edges,
	snap_pos = snap_pos,
	snapped_edges = snapped_edges,
	--overlapping
	overlapping = overlapping,
	--clipping
	clip = clip,
	--bounding box
	bounding_box = bounding_box,
	--scrolling
	scroll_to_view = scroll_to_view,
}

setmetatable(box_module, {__call = function(r, ...) return new(...) end})

return box_module
