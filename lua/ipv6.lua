--[=[

	IPv6 conversion routines.
	Written by Cosmin Apreutesei. Public Domain.

	ipv6_normalize(s, [compressed], [zeroes]) -> s
	ipv6_tobin(s) -> s
	ipv6_tostring(s, [compressed], [zeroes]) -> s

]=]

local function hex4(s) return ('%04x'):format(tonumber(s, 16)) end
local function hex4c(s) return ('%x'):format(tonumber(s, 16)) end

function ipv6_normalize(s, compressed, zeroes)
	if s:find'[^:0-9a-fA-F]' then return nil end --invalid
	if s:find'^:[^:]' then return nil end --invalid
	if s:find'[^:]:$' then return nil end --invalid
	local s, n = s:gsub('[^:]+', zeroes and hex4 or hex4c)
	if n > 8 then return nil end --invalid
	if n == 7 then return nil end --invalid
	local i = s:find('::', 1, true)
	if (n < 8 and not i) or (n == 8 and i) then return nil end --invalid
	if i then --decompress
		if s:find('::', i+1, true) then return nil end --invalid
		if i == 1 then
			s = s:gsub('^::',      (zeroes and '0000:' or '0:'):rep(8-n), 1)
		elseif i == #s-1 then
			s = s:gsub('::$',      (zeroes and ':0000' or ':0'):rep(8-n), 1)
		else
			s = s:gsub('::' , ':'..(zeroes and '0000:' or '0:'):rep(8-n), 1)
		end
	end
	if compressed then
		--remove the first longest sequence of all-zeroes blocks.
		local sp = ':'..s..':' --pad temporarily
		local n, i, j = 0
		for i1, s1, j1 in sp:gmatch('():([0:]+)():') do
			local _,n1 = s1:gsub('0+', '')
			if n1 > n then
				n, i, j = n1, i1, j1
			end
		end
		if n >= 2 then
			s = sp:sub(i == 1 and 1 or 2, i)..sp:sub(j, j == #sp and -1 or -2)
		end
	end
	return s
end

local char = string.char
local function bin1(s) return char(tonumber(s, 16)) end

function ipv6_tobin(s)
	s = ipv6_normalize(s, false, true)
	return s and s:gsub(':', ''):gsub('[^:][^:]', bin1)
end

local byte = string.byte
local function hex2(s) return ('%02x'):format(byte(s)) end

function ipv6_tostring(s, compressed, zeroes)
	if #s ~= 16 then return nil end --invalid
	s = s:gsub('.', hex2):gsub('....', '%0:'):gsub(':$', '')
	if compressed or not zeroes then
		s = ipv6_normalize(s, compressed, zeroes)
	end
	return s
end

if not ... then
	assert(ipv6_normalize('2::5:7', false) == '2:0:0:0:0:0:5:7') --decompress
	assert(ipv6_normalize('1:2:3:0:3:4:0:4', true) == '1:2:3:0:3:4:0:4') --just one zero
	assert(ipv6_normalize('1:2:0:0:3:0:0:4', true) == '1:2::3:0:0:4') --first
	assert(ipv6_normalize('1:0:0:2:0:0:0:3', true) == '1:0:0:2::3') --largest
	assert(ipv6_normalize('0:0:1:2:3:0:0:4', true) == '::1:2:3:0:0:4') --leftmost
	assert(ipv6_normalize('1:2:0:0:3:0:0:0', true) == '1:2:0:0:3::') --rightmost
	assert(ipv6_tostring'ABCDEFGHIJKLMNOP' == '4142:4344:4546:4748:494a:4b4c:4d4e:4f50')
	assert(ipv6_tobin'4142:4344:4546:4748:494a:4b4c:4d4e:4f50' == 'ABCDEFGHIJKLMNOP')
end
