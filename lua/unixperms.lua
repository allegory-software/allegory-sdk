--[=[

	UNIX permissions string parser and formatter.
	Written by Cosmin Apreutesei. Public Domain.

	unixperms_parse(s[, base]) -> mode, is_relative

		Parse a unix permissions string and return its binary value. The string
		can be an octal number beginning with a `'0'`, or a specification of form
		`'[ugo]*[-+=]?[rwxsStT]+ ...'`. `is_relative` is `true` if the permissions
		do not modify the entire mask of the `base`, eg. `'+x'` (i.e. `'ugo+x'`) says
		"add the execute bit for all" and it's thus a relative spec, while `'rx'`
		(i.e. `'ugo=rx'`) says "set the read and execute bits for all" and it's thus
		an absolute spec. `base` defaults to `0`. If `s` is not a string, `s, false`
		is returned.

	unixperms_format(mode[, opt]) -> s

		Format a unix permissions binary value to a string. `opt` can be `'l[ong]'`
		(which turns `0555` into `'r-xr-xr-x'`) or `'o[ctal]'` (which turns `0555`
		into `'0555'`). default is `'o'`.

]=]

if not ... then require'unixperms_test'; return end

local bit = require'bit'

local bor  = bit.bor
local band = bit.band
local bnot = bit.bnot
local shr  = bit.rshift

local format = string.format

local function oct(s)
	return tonumber(s, 8)
end

local function octs(n)
	return format('%05o', n)
end

local bitmasks = {
	ox = 2^0,
	ow = 2^1,
   ['or'] = 2^2,
	gx = 2^3,
	gw = 2^4,
	gr = 2^5,
	ux = 2^6,
	uw = 2^7,
	ur = 2^8,
	ot = 2^9 + 2^0,
	oT = 2^9,
	gs = 2^10 + 2^3,
	gS = 2^10,
	us = 2^11 + 2^6,
	uS = 2^11,
}

local masks = {o = oct'01007', g = oct'02070', u = oct'04700'}
local function bits(who, what)
	local bits, mask = 0, 0
	for c1 in who:gmatch'.' do
		for c2 in what:gmatch'.' do
			bits = bor(bits, bitmasks[c1..c2] or 0)
		end
		mask = bor(mask, masks[c1])
	end
	return bits, mask
end

--set one or more bits of a value without affecting other bits.
local function setbits(over, mask, bits)
	return bor(bits, band(over, bnot(mask)))
end

local all = oct'07777'
local function string_parser(s)
	if s:find'^0[0-7]+$' then --octal, don't compose
		local n = oct(s)
		return function(base)
			return n, false
		end
	end
	assert(not s:find'[^-+=ugorwxstST0, ]', 'invalid permissions string')
	local t, push = {}, table.insert
	s:gsub('([ugo]*)([-+=]?)([rwxstST0]+)', function(who, how, what)
		if who == '' then
			if what:find'[rwx0]'
				or (what:find'[sS]' and what:find'[tT]')
			then
				who = 'ugo'
			elseif what:find'[sS]' then
				who = 'ug'
			elseif what:find'[tT]' then
				who = 'o'
			else
				assert(false)
			end
		end
		local bits1, mask1 = bits(who, what)
		if how == '' or how == '=' then
			push(t, function(mode, mask)
				mode = setbits(mode, mask1, bits1)
				mask = bor(mask1, mask)
				return mode, mask
			end)
		elseif how == '-' then
			push(t, function(mode, mask)
				return band(bnot(bits1), mode), mask
			end)
		elseif how == '+' then
			push(t, function(mode, mask)
				return bor(bits1, mode), mask
			end)
		end
	end)
	return function(base)
		local mode, mask = base, 0
		for i=1,#t do
			local f = t[i]
			mode, mask = f(mode, mask)
		end
		return mode, mask ~= all
	end
end

local cache = {} -- {s -> parse(base)}

local function parse_string(s, base)
	local parse = cache[s]
	if not parse then
		parse = string_parser(s)
		cache[s] = parse
	end
	return parse(base)
end

function unixperms_parse(s, base)
	base = oct(base or 0)
	if type(s) == 'string' then
		return parse_string(s, base)
	else --number, pass-through
		return s, false
	end
end

local function s(b, suid, Suid)
	local x = band(b, 1) ~= 0
		and (suid or 'x')
		or (Suid or '-')
	local w = band(b, 2) ~= 0 and 'w' or '-'
	local r = band(b, 4) ~= 0 and 'r' or '-'
	return format('%s%s%s', r, w, x)
end
local function long(mode)
	local o  = band(shr(mode, 0), 7)
	local g  = band(shr(mode, 3), 7)
	local u  = band(shr(mode, 6), 7)
	local st = band(shr(mode, 9), 1) ~= 0
	local sg = band(shr(mode, 10), 1) ~= 0
	local su = band(shr(mode, 11), 1) ~= 0
	return format('%s%s%s',
		s(u, su and 's', su and 'S'),
		s(g, sg and 's', sg and 'S'),
		s(o, st and 't', st and 'T'))
end

function unixperms_format(mode, style)
	return
		(not style or style:find'^o') and octs(mode)
		or style:find'^l' and long(mode)
end
