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
local charls = require'charls'
local libjpeg = require'libjpeg'

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

local function first(t)
	return t and t[1]
end

function M.open(file, opt)
	return fpcall(function(finally, onerror)

		opt = opt or empty
		local verbose = opt.verbose

		local f = assert(fs.open(file))
		onerror(function() f:close() end)

		local file_offset = 0

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
			file_offset = file_offset + n
		end

		local function seek(offset)
			buf:reset()
			assert(f:seek('set', offset))
			file_offset = offset
		end

		local function str(n)
			need(n)
			file_offset = file_offset + n
			return buf:get(n):gsub('%z+$', ''):trim()
		end

		local function strbuf(n)
			need(n)
			local b = u8a(n)
			ffi.copy(b, buf:ref(), n)
			buf:skip(n)
			return b
		end

		local function tobuf(dbuf, n)
			need(n)
			dbuf:reset():reserve(n)
			ffi.copy(dbuf:ref(), buf:ref(), n)
			dbuf:commit(n)
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
			for i,s in ipairs(strlist(len, t)) do
				local age = tonumber(s:sub(1, 3))
				local unit = s:sub(-1)
				t[i] = age and {age, unit} or s
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
			local file_offset0 = file_offset
			while seq_len > 0 and next_u16() == 0xFFFE do
				local g, e, vr, len = next_tag_implicit()
				if vr == 'item' then
					local item = {}
					add(t, item)
					local item_len = len or 1/0
					local file_offset0 = file_offset
					while item_len > 0 and next_u16() ~= 0xFFFE do
						add_tag(item, next_tag())
						item_len = item_len - (file_offset - file_offset0)
					end
					if not len then
						local g, e, vr, len = next_tag_implicit()
						assert(vr == 'itemdelim')
					end
				elseif vr == 'seqdelim' then
					break
				end
				seq_len = seq_len - (file_offset - file_offset0)
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

		local image = {}
		image.__index = image

		local decode --f(frame, buf, len)
		local bot = buffer.new() --Basic Offset Table: u32[].
		local function image_decode_encap(self)
			assert(decode)
			seek(self.file_offset)
			local num_frames
			local base_offset = file_offset + 8 --first byte of first fragment
			local next_frame_offset = base_offset
			local left_len = self.items_len
			while left_len > 0 do
				local item_offset = file_offset
				need(8)
				local g, e, item_len = u16(), u16(), u32()
				assert(g == 0xFFFE)
				assert(e == 0xE000)
				assert(item_len)
				left_len = left_len - (8 + item_len)
				if not num_frames then --first item is the Basic Offset Table.
					if item_len > 0 then --first offset is redundant and optional.
						assert(item_len % 4 == 0)
						num_frames = item_len / 4
						assert(num_frames == floor(num_frames))
						bot:reset()
						tobuf(bot, item_len)
					else
						num_frames = 1
					end
				else
					if item_offset == next_frame_offset then
						if #self > 0 then
							decode(self[#self]) --finish up decoding.
						end
						assert(#self < num_frames)
						local frame = {}
						add(self, frame)
						--compute next frame's offset.
						local offsets = #bot / 4
						if #self >= num_frames then --last frame
							next_frame_offset = base_offset + self.items_len - next_frame_offset
						else
							next_frame_offset = base_offset + cast(u32p, bot:ref())[#self]
						end
					end
					assert(file_offset < next_frame_offset)
					need(item_len)
					decode(self[#self], buf:ref(), item_len)
					skip(item_len)
				end
			end
		end

		local function image_decode_native(self)
			local t = self.seq
			local spp    = first(t[0x00280002]) --1 or 3
			local bps    = first(t[0x00280100]) --1 or 8N (bits allocated)
			local bps_st = first(t[0x00280101]) --anything: bits stored
			local planar = first(t[0x00280006]) == 1
			local rows   = first(t[0x00280010])
			local cols   = first(t[0x00280011])
			pr(spp, bps, bps_st, planar, rows, cols)
		end

		parse[0x7fe00010] = function(len, t, vr, seq) --pixel data
			t.file_offset = file_offset
			if not len then --no length: skip one item at a time.
				len = 0
				while next_u16() == 0xFFFE do
					local g, e, item_len = u16(), u16(), u32()
					if e == 0xE000 then --item with defined len
						assert(item_len)
						skip(item_len)
						len = len + (8 + item_len)
					elseif e == 0xE0DD then --sequence delimiter
						assert(item_len == 0)
						break
					else
						error'(FFFE,E000) or (FFFE,E0DD) expected'
					end
				end
				t.decode = image_decode_encap
				t.items_len = len --length sum of all items, including their headers.
			else
				skip(len)
				t.decode = image_decode_native
				t.len = len
				t.vr = vr
			end
			t.seq = seq
			setmetatable(t, image)
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
			if t then --ignore duplicate tags like DCMTK.
				if len then
					skip(len)
				else
					parse(len, {}, vr, seq)
				end
				return nil, 'duplicate tag'
			end
			t = {type = types[vr]}
			seq[ge] = t
			parse(len, t, vr, seq)
			return t, g, e
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

		--[[local]] next_tag = next_tag_explicit

		local function set_implicit()
			next_tag = next_tag_implicit
		end

		local seq = {} --root sequence for top-level tags.

		local function decode_uncompressed(frame, buf, sz)
			print'uncompressed NYI'
		end

		local function decode_rle(frame, buf, sz)
			print'RLE NYI'
		end

		--[[

		JPEG STANDARDS
		[*]=SUPPORTED [x]=NOT-SUPPORTED [-]=NOT-USED [C]=COMMON [R]=RARE
		------------------------------------------------------------------------
		C* ISO-10918-1:1994 JPEG-1-1 original: baseline JPEG, 8bpp, no alpha:
			- impl: libjpeg-turbo standard build, thorfdbg/libjpeg.
		Rx ISO-10918-1:1994 JPEG-1-4 original: baseline JPEG, 12bpp, no alpha:
			- impl: libjpeg-turbo built with `-DWITH_12BIT=1`, thorfdbg/libjpeg.
		Cx ISO-10918-1:1994 JPEG-1-14 original lossless, 8bpp, 16bpp, no alpha:
			- impl: DCMJP2K, thorfdbg/libjpeg.
		R* ISO-14495-1:1999 JPEG-LS Part-1: 8bpp, 16bpp:
			- impl: CharLS, thorfdbg/libjpeg.
			- perf: better/faster than both JPEG-1-14 and JPEG-2000-1.
		- ISO-14495-1:2003 JPEG-LS Part-2: multi-component transforms, arith. coding:
			- impl: thorfdbg/libjpeg?
		R* ISO-15444-1 JPEG-2000-1 Part-1 (jp2):
			- impl: OpenJPEG (very slow decoder).
		Rx ISO-15444-1 JPEG-2000-2 Part-2 Annex-J multi-component transforms (jpx):
			- impl: FFmpeg, DCMJP2K (not free). not in GDCM.
			- perf: 2-3 times better compression ration on lossy (20% on lossless).
		- ISO-18477-8 JPEG-XT lossless and near-lossless:
			- impl: thorfdbg/libjpeg.
			- perf: similar to PNG.

		CONCLUSIONS:
		1. All 3 JPEG lossless algorithms (original, LS, 2000) are a joke:
		all you get is 60% size and very slow decoders. But we must read them all.
		2. For the smallest number of libs to integrate to get complete coverage
		of the standards you need: thorfdbg/libjpeg (C++, GPL) + OpenJPEG (clunky).
		That, or: CharLS (nice) + a build of libjpeg-turbo with 12bpp (easy)
		+ own JPEG-1-14 (hard) + OpenJPEG (clunky). Oh, and find something for
		JPEG-2000-MCT (eg. Daikon has jpx.js from PDF.js).

		]]

		local function decode_jpeg1(frame, buf, sz)
			print'JPEG-1 is NYI'
		end

		local function decode_jpeg1_12bit(frame, buf, sz)
			--TODO: build libjpeg-turbo with `-DWITH_12BIT=1` and change the binding.
			print'JPEG-1 12bit is Not Supported'
		end

		local function decode_jpeg1_lossless(frame, buf, sz)
			--TODO: find an implementation.
			print'JPEG-1 Original Lossless is Not Supported'
		end

		local function decode_jpeg_ls(frame, buf, sz)
			print'JPEG-LS is NYI'
		end

		local function decode_jpeg_2000(frame, buf, sz)
			print'JPEG-2000 is NYI'
		end

		local function decode_jpeg_2000_mct(frame, buf, sz)
			print'JPEG-2000 Multi-Component Transformations Extension is Not Supported'
		end

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
							local t, g, e = add_tag(seq, next_tag_explicit())
							if t and e == 0x0010 then --transfer syntax
								local v = t[1]
								if     v == '1.2.840.10008.1.2' then --implicit little-endian
									set_implicit()
								elseif v == '1.2.840.10008.1.2.1' then --explicit little-endian
									--this is the default
								elseif v == '1.2.840.10008.1.2.2' then --explicit big-endian
									set_be = true
								elseif v == '1.2.840.10008.1.2.1.98' then --encapped uncompressed
									decode = decode_uncompressed
								elseif v == '1.2.840.10008.1.2.1.99' then --deflate
									set_deflate = true
								elseif v == '1.2.840.10008.1.2.4.50' then --JPEG-1-1 baseline 8bit
									decode = decode_jpeg1
								elseif v == '1.2.840.10008.1.2.4.51' then --JPEG-1-4 baseline 12bit
									decode = decode_jpeg1_12bit
								elseif v == '1.2.840.10008.1.2.4.57' then --JPEG-1-14 lossless
									decode = decode_jpeg1_lossless
								elseif v == '1.2.840.10008.1.2.4.70' then --JPEG-1-14 lossless sel=1
									decode = decode_jpeg1_lossless
								elseif v == '1.2.840.10008.1.2.4.80' then --JPEG-LS lossless
									decode = decode_jpeg_ls
								elseif v == '1.2.840.10008.1.2.4.81' then --JPEG-LS lossy
									decode = decode_jpeg_ls
								elseif v == '1.2.840.10008.1.2.4.90' then --JPEG-2000-1 lossless
									decode = decode_jpeg_2000
								elseif v == '1.2.840.10008.1.2.4.91' then --JPEG-2000-1
									decode = decode_jpeg_2000
								elseif v == '1.2.840.10008.1.2.4.92' then --JPEG-2000-2 multicomp lossless
									decode = decode_jpeg_2000_mct
								elseif v == '1.2.840.10008.1.2.4.93' then --JPEG-2000-2 multicomp
									decode = decode_jpeg_2000_mct
								elseif v == '1.2.840.10008.1.2.5' then --RLE (lossless)
									decode = decode_rle
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

		function df:image(seq)
			return self.tags[0x7fe00010]
		end

		function df:tagdef(ge) --name, vr, vm
			local g, e = shr(ge, 16), band(ge, 0xffff)
			local t = dict[g] and dict[g][e]
			return t[3], t[1], t[2]
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
	local f = '0002.DCM'
	--local f = '2_skull_ct/DICOMDIR'
	local f = 'encapsulated_uncompressed.dcm'
	local f = 'img2.dcm'
	local df = assert(M.open('x:/dicom/_sample_files/'..f, {
		--
	}))
	df:dump()

	df:image():decode()

	--pr(df.tags)

	df:close()

end

function M.ge_arg(ge)
	return shr(ge, 16), band(ge, 0xffff)
end

function M.ge(g, e)
	return g * 0x10000 + e
end

function M.ge_format(g, e)
	return _('(%04x,%04x)', g, e)
end

return M

