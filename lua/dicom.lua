--[[

	DICOM file decoder.
	Written by Cosmin Apreutesei. Public Domain.

]]

local ffi = require'ffi'
local bit = require'bit'
local glue = require'glue'
glue.luapath(glue.bin)
local fs = require'fs'
local buffer = require'string.buffer'
local dict = require'dicom_dict'
local jpegls = require'jpegls'

local min = math.min
local max = math.max
local floor = math.floor

local _ = string.format
local byte = string.byte
local add = table.insert
local push = table.insert
local pop = table.remove

local band = bit.band
local shr = bit.rshift

local cast = ffi.cast

local empty = glue.empty
local index = glue.index
local fpcall = glue.fpcall
local repl = glue.repl
local sortedpairs = glue.sortedpairs
local assertf = glue.assert
local lpad = glue.lpad
local rpad = glue.rpad

local i16p = glue.i16p
local u16p = glue.u16p
local i32p = glue.i32p
local u32p = glue.u32p
local f32p = glue.f32p
local f64p = glue.f64p

assert(ffi.abi'le')

local M = {}

function M.open(file, opt)
	return fpcall(function(finally, onerror)

		opt = opt or empty
		local verbose = opt.verbose

		local f = assert(fs.open(file))
		onerror(function() f:close() end)

		local filesize = assert(f:size())
		local fileoffset = 0

		local df = {}

		function df:close()
			assert(f:close())
		end

		local MIN_SIZE = 65536
		local buf = buffer.new(MIN_SIZE)
		local function have(n)
			if n > #buf then
				local p, sz = buf:reserve(max(MIN_SIZE, n - #buf))
				local readsz = assert(f:read(p, sz))
				buf:commit(readsz)
			end
			return #buf >= n
		end
		local function need(n)
			assert(have(n), 'file too short')
		end

		local function skip(n)
			local from_buf = min(n, #buf)
			local from_file = n - from_buf
			buf:skip(from_buf)
			if from_file > 0 then
				assert(f:seek(from_file))
			end
			fileoffset = fileoffset + n
		end

		local function str(n)
			need(n)
			fileoffset = fileoffset + n
			return buf:get(n):trim()
		end

		local function strbuf(n)
			need(n)
			local b = u8a(n)
			ffi.copy(b, buf:ref(), n)
			buf:skip(n)
			return b
		end

		local function retp(p) return p end
		local rev2 = retp
		local rev4 = retp
		local rev8 = retp

		local function bn(n, rev, ct)
			need(n)
			local v = cast(ct, rev(buf:ref()))[0]
			skip(n)
			return v
		end
		local function u16() return bn(2, rev2, u16p) end
		local function u32() return bn(4, rev4, u32p) end

		local function next_u16()
			if not have(2) then return end
			local p = buf:ref()
			local v = cast(u16p, rev2(p))[0]
			rev2(p)
			return v
		end

		local function set_big_endian()
			function rev2(p)
				local a, b = p[0], p[1]
				p[0], p[1] = b, a
				return p
			end
			function rev4(p)
				local a, b, c, d = p[0], p[1], p[2], p[3]
				p[0], p[1], p[2], p[3] = d, c, b, a
				return p
			end
			function rev8(p)
				local a, b, c, d, e, f, g, h = p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7]
				p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7] = h, g, f, e, d, c, b, a
				return p
			end
		end

		local parse = {} --{VR->f(t, len)}

		local function str1(len, t)
			t[1] = str(len)
		end

		local function fixlistfunc(slen, rev, ct)
			return function(len, t)
				 local n = floor(len / slen)
				 local p = buf:ref()
				 for i = 1, n do
					add(t, tonumber(cast(ct, rev(p + (i-1) * slen))[0]))
				 end
				 skip(len)
			end
		end
		local i16list = fixlistfunc(2, rev2, i16p)
		local u16list = fixlistfunc(2, rev2, u16p)
		local i32list = fixlistfunc(4, rev4, i32p)
		local u32list = fixlistfunc(4, rev4, u32p)
		local f32list = fixlistfunc(4, rev4, f32p)
		local f64list = fixlistfunc(8, rev8, f64p)

		local function strlist(len, t)
			local s = str(len)
			for s in s:gmatch'[^\\]+' do
				s = s:trim()
				if s ~= '' then
					add(t, s)
				end
			end
			return t
		end

		local function dateonlylist(len, t)
			for i,s in ipairs(strlist(len, t)) do
				local y, m, d = s:match(dots and '(....)%.(..)%.(..)' or '(....)(..)(..)')
				if y then
					t[i] = {
						year = tonumber(y), month = tonumber(m), day = tonumber(d),
					}
				end
			end
			return st
		end

		local function datetimelist(len, t) --YYYYMMDDHHMMSS.FFFFFF&ZZXX
			for i,s0 in ipairs(strlist(len, t)) do
				local y, m, d, H, M, S, f, ss, zz, xx
				local s = s0
				s = s:gsub('^(....)(..)(..)', function(...) y, m, d = ... end)
				s = s:gsub('^(..)(..)(..)', function(...) H, M, S = ... end)
				s = s:gsub('^%.(......)', function(...) f = ... end)
				s = s:gsub('([%+%-])(..)(..)$', function(...) ss, zz, xx = ... end)
				if y then
					f = tonumber(f) or 0
					S = tonumber(S)
					zz = tonumber(zz)
					t[i] = {
						year = tonumber(y), month = tonumber(m), day = tonumber(d),
						hour = tonumber(H), min = tonumber(M),
						sec = S and S + f / 10^6,
						tz_hour = zz and zz * (ss == '-' and -1 or 1),
						tz_min = tonumber(xx),
					}
				end
			end
		end

		local function timelist(len, t) --HHMMSS.FFFFFF
			for i,s0 in ipairs(strlist(len, t)) do
				local H, M, S, f
				local s = s0
				s = s:gsub('^(..)(..)(..)', function(...) H, M, S = ... end)
				s = s:gsub('^%.(......)', function(...) f = ... end)
				if H then
					f = tonumber(f) or 0
					S = tonumber(S)
					t[i] = {
						hour = tonumber(H), min = tonumber(M),
						sec = S and S + f / 10^6,
					}
				end
			end
		end

		local function strnumlist(len, t)
			for _,s in ipairs(strlist(len, {})) do
				add(t, tonumber(s))
			end
		end

		local add_tag, next_tag, next_tag_implicit --fw. decl.

		--https://dicom.nema.org/dicom/2013/output/chtml/part05/sect_6.2.html#table_6.2-1
		parse.AE = strlist
		parse.AS = function(len, t) --nnn[D|W|M|Y]
			for i,s0 in ipairs(strlist(len, t)) do
				local age = tonumber(s:sub(1, 3))
				local unit = s:sub(-1)
				t[i] = age and {age, unit} or s0
			end
		end
		parse.AT = u16list
		parse.CS = strlist
		parse.DA = dateonlylist
		parse.DS = strnumlist
		parse.DT = datetimelist
		parse.FL = f32list
		parse.FD = f64list
		parse.FE = function(len) -- special Elscint double (see dictionary)
			local p = buf:ref()
			local r = u8a(8)
			ffi.copy(r, p, 8)
			skip(8)
			r[0] = p[3]
			r[1] = p[2]
			r[2] = p[1]
			r[3] = p[0]
			r[4] = p[7]
			r[5] = p[6]
			r[6] = p[5]
			r[7] = p[4]
			return cast(f64p, r)
		end
		parse.IS = strnumlist
		parse.LO = strlist
		parse.LT = str1
		parse.OB = str1
		parse.OD = f64list
		parse.OF = f32list
		parse.OW = u16list
		parse.PN = function(len, t)
			for i,s in ipairs(strlist(len, t)) do
				t[i] = s:gsub('%^', ' ')
			end
			return st
		end
		parse.SH = strlist
		parse.SL = i32list
		parse.SQ = function(len, t) --sequence items
			--https://dicom.nema.org/dicom/2013/output/chtml/part05/sect_7.5.html
			local seq_len = len or 1/0
			local fileoffset0 = fileoffset
			while seq_len > 0 and next_u16() == 0xFFFE do
				local g, e, vr, len = next_tag_implicit()
				if vr == 'item' then
					local item = {}
					add(t, item)
					local item_len = len or 1/0
					local fileoffset0 = fileoffset
					while item_len > 0 and next_u16() ~= 0xFFFE do
						add_tag(item, next_tag())
						item_len = item_len - (fileoffset - fileoffset0)
					end
					if not len then
						local g, e, vr, len = next_tag_implicit()
						assert(vr == 'itemdelim')
					end
				elseif vr == 'seqdelim' then
					break
				end
				seq_len = seq_len - (fileoffset - fileoffset0)
			end
			return sq
		end
		parse.SS = i16list
		parse.ST = str1
		parse.TM = timelist
		parse.UI = strlist
		parse.UL = u32list
		parse.UN = str1
		parse.US = u16list
		parse.UT = str1

		parse[0x7fe00010] = function(len, t) --pixel data
			if not len then --native: undefined-length SQ of fixed-length items.
				local offsets
				while next_u16() == 0xFFFE do
					local g, e, len = u16(), u16(), u32()
					if e == 0xE000 then --item
						if offsets == nil then
							offsets = len > 0 and strbuf(len)
						else
							skip(len)
						end
					elseif e == 0xE0DD then --sequence delimiter
						break
					else
						error'invalid tag'
					end
				end
			else --encapsulated
				pr('ENCAP PIXEL DATA', len)
			end
		end

		local types = {
			SQ = 'list',
		}
		--[[local]] function add_tag(seq, g, e, vr, len)
			if e == 0 then --group elements are deprecated and can be ignored.
				skip(len)
				return
			end
			local ge = g * 0x10000 + e
			local parse = assertf(parse[ge] or parse[vr], 'invalid VR: %s', vr)
			if len then
				need(len)
			end
			local t = seq[ge]
			if not t then
				t = {type = types[vr]}
				seq[ge] = t
				parse(len, t)
				return t
			else --ignore duplicate tags like DCMTK.
				if len then
					skip(len)
				else
					parse(len, {})
				end
				return nil, 'duplicate tag'
			end
		end

		local DATA_VRS = index{'OB', 'OW', 'OF', 'SQ', 'UT', 'UN'}

		local function next_tag_explicit()
			local g, e, vr, len = u16(), u16(), str(2), nil
			if DATA_VRS[vr] then
				skip(2) --reserved
				len = u32()
				if len == 0xffffffff then --undefined length
					len = nil
				end
			else
				len = u16()
			end
			return g, e, vr, len
		end

		--[[local]] function next_tag_implicit()
			local g, e, len = u16(), u16(), u32()
			local t = dict[g]
			local t = t and t[e]
			local vr = t and t[1] or e == 0 and 'UL' or 'OB'
			if len == 0xffffffff then --undefined length
				len = nil
				vr = vr or 'SQ'
			end
			return g, e, vr, len
		end

		--[[local]] next_tag = next_tag_implicit

		local function set_explicit()
			next_tag = next_tag_explicit
		end

		local seq = {} --root sequence for top-level tags.

		--https://dicom.nema.org/dicom/2013/output/chtml/part10/chapter_7.html#table_7.1-1
		local function init()
			if have(0x80 + 4 + 2) then --preamble + prefix + first tag's group
				if ffi.string(buf:ref()+0x80, 4) == 'DICM' then --valid prefix
					local group = cast(u16p, buf:ref()+0x84)[0]
					if group == 0x0002 or group == 0x0200 then --valid group 2 (LE or BE)
						if group == 0x0200 then --not-so-valid BE
							set_big_endian()
						end
						skip(0x84)
						local set_be, set_deflate
						while true do --file meta information group
							if next_u16() ~= 2 then break end
							local t = add_tag(seq, next_tag_explicit())
							if t and t.element == 0x0010 then --transfer syntax
								if v == '1.2.840.10008.1.2' then --implicit little-endian
									--this is the default
								elseif v == '1.2.840.10008.1.2.1' then --explicit little-endian
									set_explicit()
								elseif v == '1.2.840.10008.1.2.2' then --explicit big-endian
									set_be = true
								elseif v == '1.2.840.10008.1.2.1.99' then --deflate
									set_deflate = true
								elseif v == '1.2.840.10008.1.2.5' then --RLE
									print'RLE NYI'
								elseif v == '1.2.840.10008.1.2.4' then --JPEG
									print'JPEG NYI'
								elseif
									   v == '1.2.840.10008.1.2.4.57' --JPEG lossless
									or v == '1.2.840.10008.1.2.4.70' --JPEG lossless sel1
								then
									print'JPEG-lossless NYI'
								elseif
									   v == '1.2.840.10008.1.2.4.50' --JPEG baseline 8bit
									or v == '1.2.840.10008.1.2.4.51' --JPEG baseline 12bit
								then
									print'JPEG-BASELINE NYI'
								elseif
									   v == '1.2.840.10008.1.2.4.80' --JPEG-LS lossless
									or v == '1.2.840.10008.1.2.4.81' --JPEG-LS
								then
									print'JPEG-LS NYI'
								elseif
									   v == '1.2.840.10008.1.2.4.90' --JPEG2000 lossless
									or v == '1.2.840.10008.1.2.4.91' --JPEG2000
								then
									print'JPEG2000 NYI'
								else
									error('unknown transfer syntax '..v)
								end
							end
						end
						if set_be then
							set_big_endian()
						end
						if set_deflate then
							print'DEFLATE NYI'
						end
						return true
					end
				end
			end
			if have(8) then --no header, use heuristic from https://github.com/ivmartel/dwv/issues/188
				local p = cast(u32p, buf:ref())
				local group_elem = p[0]
				local vl = p[1]
				if group_elem == 0x00080018 or group_elem == 0x08001800 then
					if group_elem == 0x08001800 then
						set_big_endian()
					end
					if vl <= 0x100 then --sane VL, implicit TS.
						set_implicit()
						return true
					end
					local evr = ffi.string(buf:ref()+4, 2) --EVR, explicit TS.
					if evr == evr:upper() then
						return true
					end
				end
			end
		end
		assert(init(), 'invalid file')

		while have(2) do
			add_tag(seq, next_tag())
		end
		df.tags = seq

		function df:tag(g, e, seq1)
			local seq = seq1 or seq
			return seq[g * 0x10000 + e]
		end

		local function dump(item, level, i)
			local pp = require'pp'
			local indent = ('  '):rep(level)
			if i then
				print(indent..i)
			end
			for ge, t in sortedpairs(item) do
				local s
				if t.type == 'list' then
					s = ':'
				else
					s = pp.format(t, false)
					if #indent + 13 + #s > 78 then
						s = pp.format(v)
					end
				end
				local g, e = shr(ge, 16), band(ge, 0xffff)
				local ds = dict[g] and dict[g][e] and dict[g][e][3] or ''
				local ds = lpad(ds, #ds + 6 - #indent)
				local ds = rpad(ds, 40 - #indent)
				print(_('%s(%04x,%04x) %s %s', indent, g, e, ds, s))
				if t.type == 'list' then
					for i,item in ipairs(t) do
						dump(item, level+1, i)
					end
				end
			end
		end
		function df:dump()
			dump(seq, 0)
		end

		return df
	end)
end


if not ... then
	--require'$'
	--for _, in dir()
	local f = 'x:/dicom/_sample_files/0002.DCM'
	local f = 'x:/dicom/_sample_files/2_skull_ct/DICOMDIR'
	local df = assert(M.open(f, {
		--
	}))
	df:dump()

	--pr(df:tags())

	df:close()

end

return daikon
